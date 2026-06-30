import { z } from "zod";
import { assignToSchema } from "../schemas/index.js";
import type { RobotRock, SendToHumanActionInput, SendToHumanInput } from "../client.js";
import type { TaskContextInput } from "../schemas/index.js";
import {
  normalizeRobotRockAiContext,
  sendToHumanForAi,
  type RobotRockAiContext,
} from "./context.js";
import { toHumanToolResult } from "./human-tool-result.js";
import type { HumanToolResult } from "./types.js";

export const sendToHumanToolInputSchema = z.object({
  type: z.string().describe("Task type slug shown in the RobotRock inbox"),
  name: z.string().describe("Short title for the human reviewer"),
  description: z
    .string()
    .optional()
    .describe("What you need from the human and why you cannot proceed alone"),
  context: z
    .object({
      data: z.record(z.string(), z.unknown()).optional(),
      ui: z.record(z.string(), z.unknown()).optional(),
    })
    .optional()
    .describe("Optional structured context for the inbox UI"),
  validUntil: z
    .string()
    .datetime()
    .optional()
    .describe("Optional ISO deadline for the task"),
  assignTo: assignToSchema
    .optional()
    .describe(
      "Assign to tenant member emails and/or group slugs; narrows who sees the task in the inbox"
    ),
});

export type SendToHumanToolInput = z.infer<typeof sendToHumanToolInputSchema>;

export type CreateSendToHumanToolOptions<
  A extends readonly SendToHumanActionInput[] = readonly SendToHumanActionInput[],
> = {
  actions: A;
  defaultType?: string;
  description?: string;
  toolName?: string;
  /**
   * Group every task this tool creates onto a shared thread. Pass the same
   * value to {@link createSendUpdateTool} so updates land on the same thread.
   */
  threadId?: string;
};

export type CreateSendToHumanToolDurableOptions<
  A extends readonly SendToHumanActionInput[] = readonly SendToHumanActionInput[],
> = CreateSendToHumanToolOptions<A> & RobotRockAiContext & { mode: "trigger" | "workflow" };

export type SendToHumanToolDefinition = {
  description: string;
  inputSchema: typeof sendToHumanToolInputSchema;
  execute: (input: SendToHumanToolInput) => Promise<HumanToolResult>;
};

function resolveSendToHumanToolConfig<
  A extends readonly SendToHumanActionInput[] = readonly SendToHumanActionInput[],
>(
  clientOrOptions: RobotRock | CreateSendToHumanToolDurableOptions<A>,
  maybeOptions?: CreateSendToHumanToolOptions<A>
): {
  aiContext: RobotRockAiContext;
  options: CreateSendToHumanToolOptions<A>;
} {
  const isDurable =
    typeof clientOrOptions === "object" &&
    clientOrOptions !== null &&
    "mode" in clientOrOptions &&
    (clientOrOptions.mode === "trigger" || clientOrOptions.mode === "workflow");

  const aiContext = normalizeRobotRockAiContext(
    isDurable
      ? {
          mode: (clientOrOptions as CreateSendToHumanToolDurableOptions<A>).mode,
          app: (clientOrOptions as CreateSendToHumanToolDurableOptions<A>).app,
        }
      : (clientOrOptions as RobotRock)
  );
  const options = (isDurable ? clientOrOptions : maybeOptions!) as CreateSendToHumanToolOptions<A>;

  return { aiContext, options };
}

/**
 * Plain tool definition for Vercel Workflow and DurableAgent (no `tool()` from the AI SDK).
 */
export function buildSendToHumanToolDefinition<
  A extends readonly SendToHumanActionInput[] = readonly SendToHumanActionInput[],
>(
  clientOrOptions: RobotRock | CreateSendToHumanToolDurableOptions<A>,
  maybeOptions?: CreateSendToHumanToolOptions<A>
): SendToHumanToolDefinition {
  const { aiContext, options } = resolveSendToHumanToolConfig(clientOrOptions, maybeOptions);
  const description =
    options.description ??
    "Request structured input or a decision from a human in the RobotRock inbox. Use when you lack required information, need policy approval, or must confirm an irreversible step.";

  return {
    description,
    inputSchema: sendToHumanToolInputSchema,
    execute: async (input: SendToHumanToolInput): Promise<HumanToolResult> => {
      const taskContext: TaskContextInput["context"] | undefined = input.context
        ? ({
            data: input.context.data ?? {},
            ui: input.context.ui,
          } as TaskContextInput["context"])
        : undefined;

      const payload: SendToHumanInput<A> = {
        type: input.type ?? options.defaultType ?? "ai-human-input",
        name: input.name,
        description: input.description,
        context: taskContext,
        validUntil: input.validUntil,
        assignTo: input.assignTo,
        actions: options.actions,
        ...(options.threadId ? { threadId: options.threadId } : {}),
      };

      const result = await sendToHumanForAi(aiContext, payload);

      return toHumanToolResult(result);
    },
  };
}
