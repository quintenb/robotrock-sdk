import { createWebhook, sleep } from "workflow";
import type {
  DiscriminatedApprovalResult,
  ThreadUpdate,
  ThreadUpdateStatus,
} from "../schemas/index.js";
import {
  createClient,
  type SendToHumanActionInput,
  type SendToHumanInput,
} from "../client.js";
import { resolveRobotRockConfig } from "../env.js";
import { toDiscriminatedApprovalResult } from "../approval-result.js";
import {
  isRobotRockHandlerWebhookPayload,
  type RobotRockHandlerWebhookPayload,
} from "../handler-webhook.js";
import { parseValidUntilMs, resolveWaitTiming } from "../wait-timing.js";
import {
  beginRobotRockHumanWaitOtel,
  finishRobotRockHumanWaitOtel,
  stripPlatformOtelFields,
  type RobotRockPlatformOtelFields,
} from "../otel-platform.js";

export type SendToHumanWorkflowPayload<
  A extends readonly SendToHumanActionInput[] = readonly SendToHumanActionInput[],
> = SendToHumanInput<A> &
  RobotRockPlatformOtelFields & {
    /** Inbox app bucket. Overrides `ROBOTROCK_APP` when set. */
    app?: string;
  };

export type ApproveByHumanWorkflowPayload = Omit<SendToHumanWorkflowPayload, "actions">;

type Expand<T> = T extends unknown ? { [K in keyof T]: T[K] } : never;

const APPROVE_BY_HUMAN_ACTIONS = [
  { id: "approve", title: "Approve" },
  { id: "decline", title: "Decline" },
] as const;

type CreateTaskStepInput = {
  webhookUrl: string;
  app?: string;
  validUntil: Date | string;
  taskInput: Omit<SendToHumanWorkflowPayload, "validUntil" | "app" | "recordOtel" | "otelIncludeActionData">;
};

/**
 * Creates the RobotRock inbox task with the workflow webhook URL as the handler.
 * Marked as a step so API calls run in full Node.js with retries.
 */
async function createRobotRockTaskForWebhook(input: CreateTaskStepInput) {
  "use step";

  const baseConfig = resolveRobotRockConfig();
  const client = createClient({
    apiKey: baseConfig.apiKey,
    baseUrl: baseConfig.baseUrl,
    ...((input.app ?? baseConfig.app) ? { app: input.app ?? baseConfig.app } : {}),
    ...(baseConfig.version ? { version: baseConfig.version } : {}),
    ...(baseConfig.advanced ? { advanced: baseConfig.advanced } : {}),
    webhook: { url: input.webhookUrl },
  });

  return client.sendToHuman({
    ...input.taskInput,
    validUntil: input.validUntil,
  });
}

async function parseRobotRockWebhookRequest(request: Request) {
  "use step";

  const body: unknown = await request.json();
  if (!isRobotRockHandlerWebhookPayload(body)) {
    throw new Error(
      "Workflow webhook completed with unexpected payload; expected RobotRock handler body (taskId, action.id, action.data)."
    );
  }

  return body;
}

/**
 * Durable human-in-the-loop wait for Vercel Workflow.
 *
 * Call from a function with `"use workflow"` as its first statement. Creates a
 * {@link createWebhook} URL, registers it as the RobotRock task webhook, and
 * suspends until a human handles an action or `validUntil` passes.
 */
export async function sendToHumanInWorkflow<
  const A extends readonly SendToHumanActionInput[],
>(
  payload: SendToHumanWorkflowPayload<A>
): Promise<Expand<DiscriminatedApprovalResult<A>>> {
  const { validUntil: validUntilInput, app, recordOtel, otelIncludeActionData, ...taskFields } =
    payload;
  const { validUntil, timeout } = resolveWaitTiming(validUntilInput);
  const timeoutMs = parseValidUntilMs(validUntil) - Date.now();

  using webhook = createWebhook();

  const sendResult = await createRobotRockTaskForWebhook({
    webhookUrl: webhook.url,
    app,
    validUntil,
    taskInput: stripPlatformOtelFields(taskFields),
  });

  const otelSession = beginRobotRockHumanWaitOtel(sendResult.task, {
    recordOtel,
    otelIncludeActionData,
  });

  let handledPayload: RobotRockHandlerWebhookPayload | null = null;
  let waitOutcome: "handled" | "timeout" | "error" | "pending" = "pending";

  try {
    const outcome = await Promise.race([
      webhook.then((request) => parseRobotRockWebhookRequest(request)),
      sleep(timeoutMs).then(() => ({ timedOut: true }) as const),
    ]);

    if ("timedOut" in outcome) {
      waitOutcome = "timeout";
      throw new Error(`Human response timed out before validUntil (${timeout})`);
    }

    handledPayload = outcome;
    waitOutcome = "handled";

    return toDiscriminatedApprovalResult(payload.actions, {
      id: outcome.taskId,
      createdAt: new Date(),
      status: "handled",
      context: sendResult.task.context,
      validUntil: Date.now(),
      handledAt: new Date(outcome.handledAt).getTime(),
      handled: {
        action: {
          id: outcome.action.id,
          data: outcome.action.data,
        },
        handledBy: outcome.handledBy,
      },
    }) as unknown as Expand<DiscriminatedApprovalResult<A>>;
  } catch (error) {
    if (waitOutcome === "pending") {
      waitOutcome = "error";
    }
    throw error;
  } finally {
    if (waitOutcome !== "pending") {
      finishRobotRockHumanWaitOtel(
        otelSession,
        handledPayload,
        waitOutcome === "handled" ? "handled" : waitOutcome
      );
    }
  }
}

/**
 * Approve / decline gate for Vercel Workflow (`sendToHumanInWorkflow` with fixed actions).
 */
export async function approveByHumanInWorkflow(
  payload: ApproveByHumanWorkflowPayload
): Promise<Expand<DiscriminatedApprovalResult<typeof APPROVE_BY_HUMAN_ACTIONS>>> {
  return sendToHumanInWorkflow({
    ...payload,
    actions: APPROVE_BY_HUMAN_ACTIONS,
  });
}

export type SendUpdateWorkflowPayload = {
  /** Thread to log the update against (from a prior task's `threadId`). */
  threadId: string;
  /** Short status update (1-2 sentences) shown in the inbox status bar. */
  message: string;
  /** Lifecycle status driving the status-bar icon/color. @default "info" */
  status?: ThreadUpdateStatus;
  /** Inbox app bucket. Overrides `ROBOTROCK_APP` when set. */
  app?: string;
};

/**
 * Posts a thread update via `client.sendUpdate()`. Marked as a step so the API
 * call runs in full Node.js with retries and is recorded in the workflow run.
 */
async function sendRobotRockUpdate(payload: SendUpdateWorkflowPayload): Promise<ThreadUpdate> {
  "use step";

  const { app, ...update } = payload;
  const baseConfig = resolveRobotRockConfig();
  const client = createClient({
    apiKey: baseConfig.apiKey,
    baseUrl: baseConfig.baseUrl,
    ...((app ?? baseConfig.app) ? { app: app ?? baseConfig.app } : {}),
    ...(baseConfig.version ? { version: baseConfig.version } : {}),
    ...(baseConfig.advanced ? { advanced: baseConfig.advanced } : {}),
  });

  return client.sendUpdate(update);
}

/**
 * Durable thread update for Vercel Workflow.
 *
 * Wraps {@link createClient}'s `sendUpdate` in a `"use step"` so progress
 * reports are retried and recorded in the run. Fire-and-forget: returns the
 * created update without suspending the workflow (no human wait involved).
 *
 * Call from a function with `"use workflow"` as its first statement.
 */
export async function sendUpdateInWorkflow(
  payload: SendUpdateWorkflowPayload
): Promise<ThreadUpdate> {
  return sendRobotRockUpdate(payload);
}

export type { RobotRockHandlerWebhookPayload } from "../handler-webhook.js";
export type { RobotRockPlatformOtelFields } from "../otel-platform.js";
export type {
  ApprovalResult,
  DiscriminatedApprovalResult,
  TaskContextInput,
  TaskResult,
  ThreadUpdate,
  ThreadUpdateStatus,
} from "../schemas/index.js";
