import {
  context,
  trace,
  SpanStatusCode,
  type Span,
} from "@opentelemetry/api";
import type { ApprovalResult, DiscriminatedApprovalResult } from "./schemas/index.js";
import type { RobotRockHandlerWebhookPayload } from "./handler-webhook.js";

/** Minimal span surface used by handle-time OTel recording. */
export type OtelSpanLike = Pick<Span, "spanContext" | "setAttribute" | "addEvent" | "setStatus" | "end">;

const TRACER_NAME = "robotrock";
const WAIT_SPAN_NAME = "robotrock.wait_for_human";
const HANDLED_EVENT_NAME = "robotrock.task_handled";

const INVALID_TRACE_ID = "00000000000000000000000000000000";

export type RobotRockOtelHandle = {
  traceId: string;
  spanId: string;
  taskId: string;
  taskCreatedAt: number;
  threadId?: string;
};

export type RobotRockOtelRecordOptions = {
  handle?: RobotRockOtelHandle;
  span?: OtelSpanLike | Span | null;
  includeActionData?: boolean;
  tracerName?: string;
};

export type RobotRockHandledOtelInput = {
  taskId: string;
  threadId?: string;
  action: { id: string; title?: string; data: unknown };
  handledBy?: string;
  handledAt: string | number | Date;
};

function isValidTraceId(traceId: string | undefined): traceId is string {
  return (
    typeof traceId === "string" &&
    traceId.length > 0 &&
    traceId !== INVALID_TRACE_ID
  );
}

function resolveSpanContext(
  span?: OtelSpanLike | Span | null
): { traceId: string; spanId: string } | undefined {
  const active = span ?? trace.getActiveSpan();
  const ctx = active?.spanContext();
  if (!ctx || !isValidTraceId(ctx.traceId)) {
    return undefined;
  }
  return { traceId: ctx.traceId, spanId: ctx.spanId };
}

function parseTaskCreatedAt(submittedAt?: string): number {
  if (submittedAt) {
    const parsed = Date.parse(submittedAt);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

function parseHandledAtMs(handledAt: string | number | Date): number {
  if (handledAt instanceof Date) {
    return handledAt.getTime();
  }
  if (typeof handledAt === "number") {
    return handledAt;
  }
  const parsed = Date.parse(handledAt);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

export type RobotRockHandledRecordInput =
  | RobotRockHandlerWebhookPayload
  | ApprovalResult
  | DiscriminatedApprovalResult<readonly { id: string; schema?: unknown }[]>;

/** Normalize handled payloads from Trigger, Workflow, or polling. */
export function toRobotRockHandledOtelInput(
  handled: RobotRockHandledRecordInput
): RobotRockHandledOtelInput {
  if ("actionId" in handled) {
    return {
      taskId: handled.taskId,
      action: {
        id: handled.actionId,
        data: handled.data,
      },
      handledBy: handled.handledBy,
      handledAt: handled.handledAt,
    };
  }

  return {
    taskId: handled.taskId,
    action: {
      id: handled.action.id,
      title: handled.action.title,
      data: handled.action.data,
    },
    handledBy: handled.handledBy,
    handledAt: handled.handledAt,
  };
}

/**
 * Capture trace + task metadata after RobotRock task create (before human wait).
 * Used by Trigger.dev and Vercel Workflow durable integrations.
 */
export function captureRobotRockOtelHandle(
  task: { taskId: string; threadId?: string; submittedAt?: string },
  options?: { span?: OtelSpanLike | Span | null }
): RobotRockOtelHandle {
  const spanCtx = resolveSpanContext(options?.span);
  return {
    traceId: spanCtx?.traceId ?? "",
    spanId: spanCtx?.spanId ?? "",
    taskId: task.taskId,
    threadId: task.threadId,
    taskCreatedAt: parseTaskCreatedAt(task.submittedAt),
  };
}

/**
 * Start a child span for the human-wait phase on the active trace.
 */
export function startRobotRockHumanWaitSpan(
  handle: RobotRockOtelHandle,
  options?: { tracerName?: string; span?: OtelSpanLike | Span | null }
): Span | undefined {
  const parent = (options?.span ?? trace.getActiveSpan()) as Span | undefined;
  if (!parent) {
    return undefined;
  }

  const tracer = trace.getTracer(options?.tracerName ?? TRACER_NAME);
  const span = tracer.startSpan(
    WAIT_SPAN_NAME,
    {},
    trace.setSpan(context.active(), parent)
  );

  span.setAttribute("robotrock.task_id", handle.taskId);
  if (handle.threadId) {
    span.setAttribute("robotrock.thread_id", handle.threadId);
  }

  return span;
}

/**
 * Record human action attributes and a span event on the active or wait span.
 */
export function recordRobotRockHandledToOtel(
  handled: RobotRockHandledRecordInput,
  options: RobotRockOtelRecordOptions = {}
): void {
  const span = (options.span ?? trace.getActiveSpan()) as Span | undefined;
  if (!span) {
    return;
  }

  const input = toRobotRockHandledOtelInput(handled);
  const handledAtMs = parseHandledAtMs(input.handledAt);
  const handle = options.handle;
  const humanWaitMs =
    handle != null ? Math.max(0, handledAtMs - handle.taskCreatedAt) : undefined;

  span.setAttribute("robotrock.task_id", input.taskId);
  span.setAttribute("robotrock.action.id", input.action.id);
  if (input.action.title) {
    span.setAttribute("robotrock.action.title", input.action.title);
  }
  if (input.handledBy) {
    span.setAttribute("robotrock.handled_by", input.handledBy);
  }
  span.setAttribute("robotrock.handled_at", new Date(handledAtMs).toISOString());
  if (humanWaitMs != null) {
    span.setAttribute("robotrock.human_wait_ms", humanWaitMs);
  }
  if (input.threadId) {
    span.setAttribute("robotrock.thread_id", input.threadId);
  }

  const eventAttributes: Record<string, string | number | boolean> = {
    "robotrock.task_id": input.taskId,
    "robotrock.action.id": input.action.id,
  };
  if (input.handledBy) {
    eventAttributes["robotrock.handled_by"] = input.handledBy;
  }
  if (humanWaitMs != null) {
    eventAttributes["robotrock.human_wait_ms"] = humanWaitMs;
  }

  if (options.includeActionData && input.action.data != null) {
    const serialized = JSON.stringify(input.action.data);
    const truncated =
      serialized.length > 512 ? `${serialized.slice(0, 512)}…` : serialized;
    span.setAttribute("robotrock.action.data", truncated);
    eventAttributes["robotrock.action.data"] = truncated;
  }

  span.addEvent(HANDLED_EVENT_NAME, eventAttributes);
}

export type EndRobotRockHumanWaitSpanOptions = {
  handle?: RobotRockOtelHandle;
  outcome?: "handled" | "timeout" | "error";
  includeActionData?: boolean;
};

/**
 * End the human-wait child span, recording handled data or a timeout/error outcome.
 */
export function endRobotRockHumanWaitSpan(
  span: Span | undefined,
  handled: RobotRockHandledRecordInput | null,
  options: EndRobotRockHumanWaitSpanOptions = {}
): void {
  if (!span) {
    return;
  }

  const outcome = options.outcome ?? (handled ? "handled" : "timeout");

  if (handled && outcome === "handled") {
    recordRobotRockHandledToOtel(handled, {
      span,
      handle: options.handle,
      includeActionData: options.includeActionData,
    });
    span.setStatus({ code: SpanStatusCode.OK });
  } else {
    span.setAttribute("robotrock.outcome", outcome);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message:
        outcome === "timeout"
          ? "Human response timed out before validUntil"
          : "Human wait failed",
    });
  }

  span.end();
}
