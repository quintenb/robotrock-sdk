/**
 * Vercel AI SDK helpers preconfigured for Vercel Workflow (`mode: "workflow"`).
 *
 * These exports return plain tool definitions (`{ description, inputSchema, execute }`)
 * so they can be used inside `"use workflow"` functions with `generateText` or
 * `DurableAgent` without pulling in the AI SDK `tool()` helper (which depends on Node.js modules).
 *
 * Tool `execute` functions must run in workflow context (not `"use step"` only) when they
 * call RobotRock durable helpers — see Workflow docs on workflow-level vs step-level tools.
 */
export {
  approveByHumanTool,
  createRobotRockAiTools,
  createSendToHumanTool,
  createSendUpdateTool,
} from "./workflow-tools.js";
export {
  applyRobotRockToolApprovalToTools,
  createRobotRockNeedsApproval,
  createRobotRockToolApproval,
  resolveToolApprovalsViaRobotRock,
  runWithRobotRockApprovals,
} from "./tool-approval-bridge.js";
export {
  createRobotRockAiWorkflowContext,
  type RobotRockAiContext,
  type RobotRockAiMode,
  type RobotRockAiPollingContext,
  type RobotRockAiTriggerContext,
  type RobotRockAiWorkflowContext,
} from "./context.js";
