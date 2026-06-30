import type { DiscriminatedApprovalResult } from "../schemas/index.js";
import { task, wait } from "@trigger.dev/sdk";
import {
  beginRobotRockHumanWaitOtel,
  finishRobotRockHumanWaitOtel,
  stripPlatformOtelFields,
  type RobotRockPlatformOtelFields,
} from "../otel-platform.js";
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
import { resolveWaitTiming } from "../wait-timing.js";

export type { RobotRockHandlerWebhookPayload } from "../handler-webhook.js";
export type { RobotRockPlatformOtelFields } from "../otel-platform.js";

export type SendToHumanPayload<
  A extends readonly SendToHumanActionInput[] = readonly SendToHumanActionInput[],
> = SendToHumanInput<A> &
  RobotRockPlatformOtelFields & {
    /** Inbox app bucket. Overrides `ROBOTROCK_APP` when set. */
    app?: string;
  };

export type ApproveByHumanPayload = Omit<SendToHumanPayload, "actions">;

type Expand<T> = T extends unknown ? { [K in keyof T]: T[K] } : never;

const APPROVE_BY_HUMAN_ACTIONS = [
  { id: "approve", title: "Approve" },
  { id: "decline", title: "Decline" },
] as const;

async function runSendToHuman<const A extends readonly SendToHumanActionInput[]>(
  payload: SendToHumanPayload<A>
): Promise<Expand<DiscriminatedApprovalResult<A>>> {
  const { validUntil: validUntilInput, app, recordOtel, otelIncludeActionData, ...taskFields } =
    payload;
  const { validUntil, timeout } = resolveWaitTiming(validUntilInput);

  const token = await wait.createToken({ timeout });

  const baseConfig = resolveRobotRockConfig();
  const client = createClient({
    apiKey: baseConfig.apiKey,
    baseUrl: baseConfig.baseUrl,
    ...(baseConfig.app ? { app: baseConfig.app } : {}),
    ...(baseConfig.version ? { version: baseConfig.version } : {}),
    ...(baseConfig.advanced ? { advanced: baseConfig.advanced } : {}),
    webhook: { url: token.url },
  });

  const taskInput = stripPlatformOtelFields(taskFields);

  const sendResult = await client.sendToHuman({
    ...taskInput,
    validUntil,
    ...(app !== undefined ? { app } : {}),
  });

  const otelSession = beginRobotRockHumanWaitOtel(sendResult.task, {
    recordOtel,
    otelIncludeActionData,
  });

  let handledPayload: RobotRockHandlerWebhookPayload | null = null;
  let waitOutcome: "handled" | "timeout" | "error" | "pending" = "pending";

  try {
    const outcome = await wait.forToken<RobotRockHandlerWebhookPayload>(token.id);

    if (!outcome.ok) {
      waitOutcome = "timeout";
      throw new Error(`Human response timed out before validUntil (${timeout})`);
    }

    const output = outcome.output;
    if (!isRobotRockHandlerWebhookPayload(output)) {
      waitOutcome = "error";
      throw new Error(
        "Wait token completed with unexpected payload; expected RobotRock handler body (taskId, action.id, action.data)."
      );
    }

    handledPayload = output;
    waitOutcome = "handled";

    return toDiscriminatedApprovalResult(
      payload.actions,
      {
        id: output.taskId,
        createdAt: new Date(),
        status: "handled",
        context: sendResult.task.context,
        validUntil: Date.now(),
        handledAt: new Date(output.handledAt).getTime(),
        handled: {
          action: {
            id: output.action.id,
            data: output.action.data,
          },
          handledBy: output.handledBy,
        },
      }
    ) as unknown as Expand<DiscriminatedApprovalResult<A>>;
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
 * Durable human-in-the-loop task for Trigger.dev.
 * Re-export from your `trigger/` directory so Trigger.dev discovers it on deploy.
 */
export const sendToHumanTask = task({
  id: "robotrock/send-to-human",
  run: async (payload: SendToHumanPayload) => runSendToHuman(payload),
});

/**
 * Simple approve/decline human gate for Trigger.dev.
 * Re-export from your `trigger/` directory so Trigger.dev discovers it on deploy.
 */
export const approveByHumanTask = task({
  id: "robotrock/approve-by-human",
  run: async (payload: ApproveByHumanPayload) =>
    runSendToHuman({
      ...payload,
      actions: APPROVE_BY_HUMAN_ACTIONS,
    }),
});

export type {
  ApprovalResult,
  DiscriminatedApprovalResult,
  TaskContextInput,
  TaskResult,
} from "../schemas/index.js";
