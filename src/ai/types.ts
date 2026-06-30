import type { RobotRock } from "../client.js";
import type { SendToHumanInput } from "../client.js";
import type { RobotRockAiContext } from "./context.js";

export type HumanToolResult = {
  taskId: string;
  actionId: string;
  data: unknown;
  handledBy?: string;
  handledAt: string;
  /** Present when action ids are approve/decline (or approve/reject). */
  approved?: boolean;
};

export type RobotRockToolCallInfo = {
  toolName: string;
  toolCallId: string;
  input: unknown;
};

export type RobotRockToolApprovalConfig = {
  /** Tool names that require RobotRock inbox approval before execution. */
  tools?: readonly string[];
  /** Custom predicate when tool names alone are not enough. */
  when?: (toolCall: RobotRockToolCallInfo) => boolean;
};

export type FormatToolApprovalTaskOptions = {
  type?: string;
  approveActionId?: string;
  denyActionId?: string;
};

export type ResolveToolApprovalsOptions = {
  formatTask?: (toolCall: RobotRockToolCallInfo) => SendToHumanInput;
  approveActionId?: string;
  denyActionId?: string;
};

export type RunWithRobotRockApprovalsOptions<T> = {
  /** Polling mode (requires `client`). */
  client?: RobotRock;
  /** Polling or Trigger mode; use `{ mode: "trigger" }` inside Trigger.dev workers. */
  context?: RobotRockAiContext;
  /** Initial messages; updated across approval rounds. */
  messages?: unknown[];
  maxRounds?: number;
  resolveOptions?: ResolveToolApprovalsOptions;
  generate: (messages: unknown[]) => Promise<T>;
};

export type ToolApprovalRequestPart = {
  type: "tool-approval-request";
  approvalId: string;
  toolCallId?: string;
  toolCall?: RobotRockToolCallInfo;
  isAutomatic?: boolean;
};
