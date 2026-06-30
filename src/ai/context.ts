import {
  createClient,
  type RobotRock,
  type SendToHumanActionInput,
  type SendToHumanInput,
  type SendUpdateInput,
} from "../client.js";
import { resolveRobotRockConfig } from "../env.js";
import type { DiscriminatedApprovalResult, ThreadUpdate } from "../schemas/index.js";
const APPROVE_BY_HUMAN_ACTIONS = [
  { id: "approve", title: "Approve" },
  { id: "decline", title: "Decline" },
] as const;

/** How RobotRock waits for a human inside AI SDK tool `execute`. */
export type RobotRockAiMode = "polling" | "trigger" | "workflow";

/**
 * Polling: `client.sendToHuman()` blocks until handled (scripts, API routes with long timeout).
 * Trigger: `sendToHumanTask.triggerAndWait()` uses wait tokens (Trigger.dev workers).
 * Workflow: `sendToHumanInWorkflow()` uses workflow webhooks (Vercel Workflow).
 */
export type RobotRockAiPollingContext = {
  mode?: "polling";
  client: RobotRock;
};

export type RobotRockAiTriggerContext = {
  mode: "trigger";
  /** Inbox app bucket; falls back to `ROBOTROCK_APP` in the Trigger worker. */
  app?: string;
};

export type RobotRockAiWorkflowContext = {
  mode: "workflow";
  /** Inbox app bucket; falls back to `ROBOTROCK_APP` in the workflow run. */
  app?: string;
};

export type RobotRockAiContext =
  | RobotRockAiPollingContext
  | RobotRockAiTriggerContext
  | RobotRockAiWorkflowContext;

/** Shorthand for `{ mode: "trigger", app }`. */
export function createRobotRockAiTriggerContext(
  options: Omit<RobotRockAiTriggerContext, "mode"> = {}
): RobotRockAiContext {
  return { mode: "trigger", ...options };
}

/** Shorthand for `{ mode: "workflow", app }`. */
export function createRobotRockAiWorkflowContext(
  options: Omit<RobotRockAiWorkflowContext, "mode"> = {}
): RobotRockAiContext {
  return { mode: "workflow", ...options };
}

export function isRobotRockClient(value: unknown): value is RobotRock {
  return (
    typeof value === "object" &&
    value !== null &&
    "sendToHuman" in value &&
    typeof (value as RobotRock).sendToHuman === "function"
  );
}

export function normalizeRobotRockAiContext(
  clientOrContext: RobotRock | RobotRockAiContext
): RobotRockAiContext {
  if (isRobotRockClient(clientOrContext)) {
    return { mode: "polling", client: clientOrContext };
  }

  if (clientOrContext.mode === "trigger" || clientOrContext.mode === "workflow") {
    return clientOrContext;
  }

  if (clientOrContext.mode === "polling" || clientOrContext.mode === undefined) {
    if (!("client" in clientOrContext) || !clientOrContext.client) {
      throw new Error('RobotRock AI polling mode requires `client` on the context object.');
    }
    return { mode: "polling", client: clientOrContext.client };
  }

  throw new Error(`Unknown RobotRock AI mode: ${String((clientOrContext as { mode?: string }).mode)}`);
}

export async function sendToHumanForAi<
  A extends readonly SendToHumanActionInput[] = readonly SendToHumanActionInput[],
>(
  context: RobotRockAiContext,
  payload: SendToHumanInput<A>
): Promise<DiscriminatedApprovalResult<A>> {
  if (context.mode === "trigger") {
    const { sendToHumanTask } = await import("../trigger/index.js");
    const waitResult = await sendToHumanTask.triggerAndWait({
      ...payload,
      ...(context.app ? { app: context.app } : {}),
    });

    if (!waitResult.ok) {
      throw waitResult.error;
    }

    return waitResult.output as DiscriminatedApprovalResult<A>;
  }

  if (context.mode === "workflow") {
    const { sendToHumanInWorkflow } = await import("../workflow/index.js");
    const result = await sendToHumanInWorkflow({
      ...payload,
      ...(context.app ? { app: context.app } : {}),
    });
    return result as unknown as DiscriminatedApprovalResult<A>;
  }

  const result = await context.client.sendToHuman(payload);

  if (result.mode !== "handled") {
    throw new Error(
      "RobotRock task was created but not handled. Configure client polling or webhook, or use mode: 'trigger' / 'workflow' for durable waits."
    );
  }

  return {
    actionId: result.actionId,
    data: result.data,
    handledBy: result.handledBy,
    handledAt: result.handledAt,
    taskId: result.taskId,
  } as DiscriminatedApprovalResult<A>;
}

/**
 * Posts a thread update for an AI tool, routing by execution mode.
 *
 * `sendUpdate` is fire-and-forget (no human wait), so only the workflow path
 * needs durability — it runs inside a `"use step"`. Trigger and polling modes
 * issue the request directly.
 */
export async function sendUpdateForAi(
  context: RobotRockAiContext,
  payload: SendUpdateInput
): Promise<ThreadUpdate> {
  if (context.mode === "workflow") {
    const { sendUpdateInWorkflow } = await import("../workflow/index.js");
    return sendUpdateInWorkflow({
      ...payload,
      ...(context.app ? { app: context.app } : {}),
    });
  }

  if (context.mode === "trigger") {
    const client = createClient(
      resolveRobotRockConfig(context.app ? { app: context.app } : undefined)
    );
    return client.sendUpdate(payload);
  }

  return context.client.sendUpdate(payload);
}

export async function approveByHumanForAi(
  context: RobotRockAiContext,
  payload: Omit<SendToHumanInput, "actions"> & { app?: string }
): Promise<DiscriminatedApprovalResult<typeof APPROVE_BY_HUMAN_ACTIONS>> {
  if (context.mode === "trigger") {
    const { approveByHumanTask } = await import("../trigger/index.js");
    const waitResult = await approveByHumanTask.triggerAndWait({
      ...payload,
      ...(context.app ? { app: context.app } : {}),
    });

    if (!waitResult.ok) {
      throw waitResult.error;
    }

    return waitResult.output;
  }

  if (context.mode === "workflow") {
    const { approveByHumanInWorkflow } = await import("../workflow/index.js");
    return await approveByHumanInWorkflow({
      ...payload,
      ...(context.app ? { app: context.app } : {}),
    });
  }

  const result = await context.client.sendToHuman({
    ...payload,
    actions: APPROVE_BY_HUMAN_ACTIONS,
  });

  if (result.mode !== "handled") {
    throw new Error(
      "RobotRock approval was not handled. Configure client polling or use mode: 'trigger' / 'workflow' for durable waits."
    );
  }

  return {
    actionId: result.actionId,
    data: result.data,
    handledBy: result.handledBy,
    handledAt: result.handledAt,
    taskId: result.taskId,
  } as DiscriminatedApprovalResult<typeof APPROVE_BY_HUMAN_ACTIONS>;
}
