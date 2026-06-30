import { tool, type Tool } from "ai";
import type { z } from "zod";
import type { RobotRock } from "../client.js";
import {
  APPROVE_BY_HUMAN_ACTIONS,
  approveByHumanInputSchema,
  buildApproveByHumanToolDefinition,
  type ApproveByHumanToolDurableOptions,
  type ApproveByHumanToolOptions,
} from "./approve-by-human-tool-core.js";
import type { HumanToolResult } from "./types.js";

/**
 * AI SDK tool with fixed approve/decline actions; blocks until a human decides.
 *
 * - `approveByHumanTool(robotrock)` — polling via `client.sendToHuman()` (default).
 * - `approveByHumanTool({ mode: "trigger", app?: "my-agent" })` — durable wait via Trigger.dev.
 * - `approveByHumanTool({ mode: "workflow", app?: "my-agent" })` — durable wait via Vercel Workflow.
 *
 * In Vercel Workflow functions, import from `robotrock/ai/workflow` instead — it returns a
 * plain tool definition compatible with `generateText` and DurableAgent without the AI SDK `tool()` helper.
 */
export function approveByHumanTool(
  clientOrContext: RobotRock | ApproveByHumanToolDurableOptions,
  maybeOptions: ApproveByHumanToolOptions = {}
): Tool<z.infer<typeof approveByHumanInputSchema>, HumanToolResult> {
  return tool(buildApproveByHumanToolDefinition(clientOrContext, maybeOptions));
}

export { APPROVE_BY_HUMAN_ACTIONS, approveByHumanInputSchema };
export type { ApproveByHumanToolDurableOptions, ApproveByHumanToolOptions };
