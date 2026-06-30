import type { Span } from "@opentelemetry/api";
import {
  captureRobotRockOtelHandle,
  endRobotRockHumanWaitSpan,
  startRobotRockHumanWaitSpan,
  type RobotRockOtelHandle,
} from "./record-handled-to-otel.js";

export type RobotRockPlatformOtelFields = {
  /**
   * Record human handle result on the active OTel span (Trigger / Workflow).
   * Defaults to `ROBOTROCK_OTEL_RECORD_HANDLED` env (`true` / `1`).
   */
  recordOtel?: boolean;
  /** Include truncated action feedback data on OTel spans (off by default). */
  otelIncludeActionData?: boolean;
};

export function shouldRecordRobotRockOtel(recordOtel?: boolean): boolean {
  if (recordOtel === true) {
    return true;
  }
  if (recordOtel === false) {
    return false;
  }
  const env = process.env.ROBOTROCK_OTEL_RECORD_HANDLED;
  return env === "true" || env === "1";
}

export function stripPlatformOtelFields<
  T extends RobotRockPlatformOtelFields & Record<string, unknown>,
>(payload: T): Omit<T, "recordOtel" | "otelIncludeActionData"> {
  const { recordOtel: _recordOtel, otelIncludeActionData: _otelIncludeActionData, ...rest } =
    payload;
  return rest;
}

export type RobotRockCreatedTask = {
  taskId: string;
  threadId?: string;
  submittedAt?: string;
};

export type RobotRockHumanWaitOtelSession = {
  recordOtel: boolean;
  handle?: RobotRockOtelHandle;
  waitSpan?: Span;
  includeActionData?: boolean;
};

export function beginRobotRockHumanWaitOtel(
  task: RobotRockCreatedTask,
  options: Pick<RobotRockPlatformOtelFields, "recordOtel" | "otelIncludeActionData"> = {}
): RobotRockHumanWaitOtelSession {
  const recordOtel = shouldRecordRobotRockOtel(options.recordOtel);
  if (!recordOtel) {
    return { recordOtel: false };
  }

  const handle = captureRobotRockOtelHandle(task);
  const waitSpan = startRobotRockHumanWaitSpan(handle);

  return {
    recordOtel: true,
    handle,
    waitSpan,
    includeActionData: options.otelIncludeActionData,
  };
}

export function finishRobotRockHumanWaitOtel(
  session: RobotRockHumanWaitOtelSession,
  handled: Parameters<typeof endRobotRockHumanWaitSpan>[1],
  outcome: "handled" | "timeout" | "error"
): void {
  if (!session.recordOtel) {
    return;
  }

  endRobotRockHumanWaitSpan(session.waitSpan, handled, {
    handle: session.handle,
    outcome,
    includeActionData: session.includeActionData,
  });
}
