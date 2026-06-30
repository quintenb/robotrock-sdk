import { z } from "zod";
import type { RobotRock } from "../client.js";
import {
  approveByHumanForAi,
  normalizeRobotRockAiContext,
  type RobotRockAiContext,
} from "./context.js";
import { toHumanToolResult } from "./human-tool-result.js";
import type { HumanToolResult } from "./types.js";

export const APPROVE_BY_HUMAN_ACTIONS = [
  { id: "approve", title: "Approve" },
  { id: "decline", title: "Decline" },
] as const;

export const approveByHumanInputSchema = z.object({
  type: z
    .string()
    .optional()
    .describe("Task type slug; defaults to ai-approval"),
  name: z.string().describe("Short title for the approval request"),
  description: z
    .string()
    .describe("What needs approval and the consequences of approving or declining"),
  contextSummary: z
    .string()
    .optional()
    .describe("Optional markdown summary shown to the reviewer"),
});

export type ApproveByHumanToolInput = z.infer<typeof approveByHumanInputSchema>;

export type ApproveByHumanToolOptions = {
  defaultType?: string;
  description?: string;
  toolName?: string;
};

export type ApproveByHumanToolDurableOptions = ApproveByHumanToolOptions &
  RobotRockAiContext & { mode: "trigger" | "workflow" };

export type ApproveByHumanToolDefinition = {
  description: string;
  inputSchema: typeof approveByHumanInputSchema;
  execute: (input: ApproveByHumanToolInput) => Promise<HumanToolResult>;
};

function resolveApproveByHumanToolConfig(
  clientOrContext: RobotRock | ApproveByHumanToolDurableOptions,
  maybeOptions: ApproveByHumanToolOptions = {}
): {
  aiContext: RobotRockAiContext;
  options: ApproveByHumanToolOptions;
} {
  const isDurable =
    typeof clientOrContext === "object" &&
    clientOrContext !== null &&
    "mode" in clientOrContext &&
    (clientOrContext.mode === "trigger" || clientOrContext.mode === "workflow");

  const aiContext = normalizeRobotRockAiContext(
    isDurable
      ? {
          mode: (clientOrContext as ApproveByHumanToolDurableOptions).mode,
          app: (clientOrContext as ApproveByHumanToolDurableOptions).app,
        }
      : (clientOrContext as RobotRock)
  );
  const options = isDurable
    ? (clientOrContext as ApproveByHumanToolDurableOptions)
    : maybeOptions;

  return { aiContext, options };
}

/**
 * Plain tool definition for Vercel Workflow and DurableAgent (no `tool()` from the AI SDK).
 */
export function buildApproveByHumanToolDefinition(
  clientOrContext: RobotRock | ApproveByHumanToolDurableOptions,
  maybeOptions: ApproveByHumanToolOptions = {}
): ApproveByHumanToolDefinition {
  const { aiContext, options } = resolveApproveByHumanToolConfig(
    clientOrContext,
    maybeOptions
  );
  const description =
    options.description ??
    "Request explicit human approval before a sensitive or irreversible step. Returns whether the human approved or declined.";

  return {
    description,
    inputSchema: approveByHumanInputSchema,
    execute: async (input: ApproveByHumanToolInput): Promise<HumanToolResult> => {
      const taskContext =
        input.contextSummary !== undefined
          ? {
              data: { summary: input.contextSummary },
              ui: {
                summary: { "ui:widget": "textarea", "ui:options": { rows: 6 } },
              },
            }
          : undefined;

      const result = await approveByHumanForAi(aiContext, {
        type: input.type ?? options.defaultType ?? "ai-approval",
        name: input.name,
        description: input.description,
        context: taskContext,
      });

      return toHumanToolResult(result);
    },
  };
}
