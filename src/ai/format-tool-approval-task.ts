import type { SendToHumanInput } from "../client.js";
import type { FormatToolApprovalTaskOptions, RobotRockToolCallInfo } from "./types.js";

const DEFAULT_APPROVE_ACTIONS = [
  { id: "approve", title: "Approve execution" },
  { id: "deny", title: "Deny" },
] as const;

/**
 * Build a RobotRock task payload for an AI SDK tool approval request.
 */
export function defaultFormatToolApprovalTask(
  toolCall: RobotRockToolCallInfo,
  options: FormatToolApprovalTaskOptions = {}
): SendToHumanInput {
  const approveId = options.approveActionId ?? "approve";
  const denyId = options.denyActionId ?? "deny";

  return {
    type: options.type ?? "ai-tool-approval",
    name: `Approve: ${toolCall.toolName}`,
    description: `Review the proposed \`${toolCall.toolName}\` tool call before it runs.`,
    context: {
      data: {
        toolName: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        input: toolCall.input,
      },
      ui: {
        toolName: { "ui:widget": "text" },
        toolCallId: { "ui:widget": "text" },
        input: { "ui:widget": "textarea" },
      },
    },
    actions: [
      { id: approveId, title: "Approve execution" },
      { id: denyId, title: "Deny" },
    ],
  };
}

export { DEFAULT_APPROVE_ACTIONS };
