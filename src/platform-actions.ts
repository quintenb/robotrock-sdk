/**
 * Reserved inbox actions that reviewers can take outside your task's defined actions.
 * Agents and integrations must treat these as terminal — stop the run and do not retry sendToHuman.
 */

export const PLATFORM_MARK_DONE_ACTION_ID = "robotrock:mark-done" as const;
export const PLATFORM_REJECT_REQUEST_ACTION_ID = "robotrock:reject-request" as const;

export const PLATFORM_MARK_DONE_ACTION_TITLE = "Mark as done";
export const PLATFORM_REJECT_REQUEST_ACTION_TITLE = "Reject request";

export const PLATFORM_TERMINAL_ACTION_IDS = [
  PLATFORM_MARK_DONE_ACTION_ID,
  PLATFORM_REJECT_REQUEST_ACTION_ID,
] as const;

export type PlatformTerminalActionId = (typeof PLATFORM_TERMINAL_ACTION_IDS)[number];

export type PlatformRejectRequestData = {
  feedback: string;
};

export type HandledActionInput = {
  actionId: string;
  data?: unknown;
  handledBy?: string;
  handledAt?: number | Date;
};

export type PlatformMarkDoneOutcome = {
  source: "platform";
  kind: "mark-done";
  actionId: typeof PLATFORM_MARK_DONE_ACTION_ID;
  data: Record<string, never>;
  handledBy?: string;
  handledAt?: Date;
};

export type PlatformRejectRequestOutcome = {
  source: "platform";
  kind: "reject-request";
  actionId: typeof PLATFORM_REJECT_REQUEST_ACTION_ID;
  data: PlatformRejectRequestData;
  handledBy?: string;
  handledAt?: Date;
};

export type TaskActionOutcome = {
  source: "task";
  actionId: string;
  data: unknown;
  handledBy?: string;
  handledAt?: Date;
};

export type HandledOutcome =
  | PlatformMarkDoneOutcome
  | PlatformRejectRequestOutcome
  | TaskActionOutcome;

export class PlatformRejectRequestError extends Error {
  readonly actionId = PLATFORM_REJECT_REQUEST_ACTION_ID;
  readonly feedback: string;

  constructor(feedback: string, message?: string) {
    super(message ?? `Human rejected the request: ${feedback}`);
    this.name = "PlatformRejectRequestError";
    this.feedback = feedback;
  }
}

export function isPlatformMarkDoneAction(
  actionId: string | undefined
): actionId is typeof PLATFORM_MARK_DONE_ACTION_ID {
  return actionId === PLATFORM_MARK_DONE_ACTION_ID;
}

export function isPlatformRejectRequestAction(
  actionId: string | undefined
): actionId is typeof PLATFORM_REJECT_REQUEST_ACTION_ID {
  return actionId === PLATFORM_REJECT_REQUEST_ACTION_ID;
}

export function isPlatformTerminalAction(
  actionId: string | undefined
): actionId is PlatformTerminalActionId {
  return (
    isPlatformMarkDoneAction(actionId) || isPlatformRejectRequestAction(actionId)
  );
}

export function parsePlatformRejectRequestData(
  data: unknown
): PlatformRejectRequestData | null {
  if (data == null || typeof data !== "object") {
    return null;
  }
  const feedback = (data as { feedback?: unknown }).feedback;
  if (typeof feedback !== "string") {
    return null;
  }
  const trimmed = feedback.trim();
  if (!trimmed) {
    return null;
  }
  return { feedback: trimmed };
}

function toHandledAt(value: number | Date | undefined): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value instanceof Date ? value : new Date(value);
}

/**
 * Classify a handled task action as a platform terminal outcome or a normal task action.
 */
export function parseHandledOutcome(input: HandledActionInput): HandledOutcome {
  const handledAt = toHandledAt(input.handledAt);
  const handledBy = input.handledBy;

  if (isPlatformMarkDoneAction(input.actionId)) {
    return {
      source: "platform",
      kind: "mark-done",
      actionId: PLATFORM_MARK_DONE_ACTION_ID,
      data: {},
      handledBy,
      handledAt,
    };
  }

  if (isPlatformRejectRequestAction(input.actionId)) {
    return {
      source: "platform",
      kind: "reject-request",
      actionId: PLATFORM_REJECT_REQUEST_ACTION_ID,
      data: parsePlatformRejectRequestData(input.data) ?? { feedback: "" },
      handledBy,
      handledAt,
    };
  }

  return {
    source: "task",
    actionId: input.actionId,
    data: input.data ?? {},
    handledBy,
    handledAt,
  };
}

/**
 * Throw when a human rejected the request from the inbox (not your task's reject action).
 * Use after polling, webhooks, or getTask when you want agents to stop immediately.
 */
export function assertNotPlatformRejectRequest(
  actionId: string,
  data?: unknown
): void {
  if (!isPlatformRejectRequestAction(actionId)) {
    return;
  }
  const parsed = parsePlatformRejectRequestData(data);
  throw new PlatformRejectRequestError(
    parsed?.feedback ?? "No feedback provided"
  );
}

/**
 * Returns true when the agent should stop — platform mark-done or reject-request.
 */
export function shouldStopAgentForHandledAction(actionId: string | undefined): boolean {
  return isPlatformTerminalAction(actionId);
}
