import { z } from "zod";
import { threadUpdateStatusSchema } from "../schemas/index.js";
import { RobotRockError, type RobotRock } from "../client.js";
import type { ThreadUpdate } from "../schemas/index.js";
import {
  normalizeRobotRockAiContext,
  sendUpdateForAi,
  type RobotRockAiContext,
} from "./context.js";

/**
 * Result returned to the model by {@link createSendUpdateTool}.
 *
 * Updates are fire-and-forget, so a missing thread (no task created yet) is
 * reported as `{ posted: false }` instead of throwing — that way an agent loop
 * is never aborted by a non-critical progress update. Genuine failures (auth,
 * validation, server errors) still throw.
 */
export type SendUpdateToolResult =
  | { posted: true; threadId: string; update: ThreadUpdate }
  | {
      posted: false;
      threadId: string;
      reason: "thread_not_found";
      message: string;
    };

export const sendUpdateToolInputSchema = z.object({
  threadId: z
    .string()
    .optional()
    .describe(
      "Thread to post the update to. Use the `threadId` returned by a prior send-to-human task. Omit only when a session threadId is configured on the tool."
    ),
  message: z
    .string()
    .describe("Short progress update (1-2 sentences) shown in the inbox status bar"),
  status: threadUpdateStatusSchema
    .optional()
    .describe(
      "Lifecycle status driving the status-bar icon/color: info, queued, running, waiting, succeeded, failed, cancelled"
    ),
});

export type SendUpdateToolInput = z.infer<typeof sendUpdateToolInputSchema>;

export type CreateSendUpdateToolOptions = {
  /**
   * Session thread to post updates to when the model does not supply `threadId`.
   * Pass the same value to {@link createSendToHumanTool} to auto-thread tasks
   * and updates together.
   */
  threadId?: string;
  description?: string;
};

export type CreateSendUpdateToolDurableOptions = CreateSendUpdateToolOptions &
  RobotRockAiContext & { mode: "trigger" | "workflow" };

export type SendUpdateToolDefinition = {
  description: string;
  inputSchema: typeof sendUpdateToolInputSchema;
  execute: (input: SendUpdateToolInput) => Promise<SendUpdateToolResult>;
};

function resolveSendUpdateToolConfig(
  clientOrOptions: RobotRock | CreateSendUpdateToolDurableOptions,
  maybeOptions: CreateSendUpdateToolOptions = {}
): {
  aiContext: RobotRockAiContext;
  options: CreateSendUpdateToolOptions;
} {
  const isDurable =
    typeof clientOrOptions === "object" &&
    clientOrOptions !== null &&
    "mode" in clientOrOptions &&
    (clientOrOptions.mode === "trigger" || clientOrOptions.mode === "workflow");

  const aiContext = normalizeRobotRockAiContext(
    isDurable
      ? {
          mode: (clientOrOptions as CreateSendUpdateToolDurableOptions).mode,
          app: (clientOrOptions as CreateSendUpdateToolDurableOptions).app,
        }
      : (clientOrOptions as RobotRock)
  );
  const options = isDurable
    ? (clientOrOptions as CreateSendUpdateToolDurableOptions)
    : maybeOptions;

  return { aiContext, options };
}

/**
 * Plain tool definition for Vercel Workflow and DurableAgent (no `tool()` from the AI SDK).
 */
export function buildSendUpdateToolDefinition(
  clientOrOptions: RobotRock | CreateSendUpdateToolDurableOptions,
  maybeOptions: CreateSendUpdateToolOptions = {}
): SendUpdateToolDefinition {
  const { aiContext, options } = resolveSendUpdateToolConfig(clientOrOptions, maybeOptions);
  const description =
    options.description ??
    "Post a short progress update to the RobotRock thread you are working on. Use to report status changes (running, succeeded, failed) so humans can follow along in the inbox.";

  return {
    description,
    inputSchema: sendUpdateToolInputSchema,
    execute: async (input: SendUpdateToolInput): Promise<SendUpdateToolResult> => {
      const threadId = input.threadId ?? options.threadId;
      if (!threadId) {
        throw new Error(
          "createSendUpdateTool: no threadId. Pass `threadId` from a prior send-to-human result, or configure a session `threadId` in the tool options."
        );
      }

      try {
        const update = await sendUpdateForAi(aiContext, {
          threadId,
          message: input.message,
          status: input.status,
        });
        return { posted: true, threadId, update };
      } catch (error) {
        if (error instanceof RobotRockError && error.statusCode === 404) {
          return {
            posted: false,
            threadId,
            reason: "thread_not_found",
            message: `No task exists for thread "${threadId}" yet, so the update was not posted. Create a task on this thread with send-to-human before reporting progress.`,
          };
        }
        throw error;
      }
    },
  };
}
