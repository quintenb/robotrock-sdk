/**
 * Vercel AI SDK helpers preconfigured for Trigger.dev workers (`mode: "trigger"`).
 *
 * Re-export `sendToHumanTask` and `approveByHumanTask` from your `trigger/` directory
 * so Trigger.dev discovers them on deploy (same as `robotrock/trigger`).
 */
export { approveByHumanTool } from "./approve-by-human-tool.js";
export { createSendToHumanTool } from "./create-send-to-human-tool.js";
export { createSendUpdateTool } from "./create-send-update-tool.js";
export {
  applyRobotRockToolApprovalToTools,
  createRobotRockNeedsApproval,
  createRobotRockToolApproval,
  resolveToolApprovalsViaRobotRock,
  runWithRobotRockApprovals,
} from "./tool-approval-bridge.js";
export {
  createRobotRockAiTools,
  createRobotRockAiTriggerContext,
} from "./create-ai-tools.js";
export type {
  RobotRockAiContext,
  RobotRockAiMode,
  RobotRockAiPollingContext,
  RobotRockAiTriggerContext,
} from "./context.js";
