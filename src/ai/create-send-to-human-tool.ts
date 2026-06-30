import { tool, type Tool } from "ai";
import type { z } from "zod";
import type { RobotRock, SendToHumanActionInput } from "../client.js";
import {
  buildSendToHumanToolDefinition,
  sendToHumanToolInputSchema,
  type CreateSendToHumanToolDurableOptions,
  type CreateSendToHumanToolOptions,
} from "./create-send-to-human-tool-core.js";
import type { HumanToolResult } from "./types.js";

/**
 * AI SDK tool that blocks until a human handles a RobotRock task with developer-defined actions.
 *
 * - `createSendToHumanTool(robotrock, options)` — polling (default).
 * - `createSendToHumanTool({ mode: "trigger", actions: [...], app?: "my-agent" })` — Trigger.dev wait tokens.
 * - `createSendToHumanTool({ mode: "workflow", actions: [...], app?: "my-agent" })` — Vercel Workflow webhooks.
 *
 * In Vercel Workflow functions, import from `robotrock/ai/workflow` instead.
 */
export function createSendToHumanTool<
  A extends readonly SendToHumanActionInput[] = readonly SendToHumanActionInput[],
>(
  clientOrOptions: RobotRock | CreateSendToHumanToolDurableOptions<A>,
  maybeOptions?: CreateSendToHumanToolOptions<A>
): Tool<z.infer<typeof sendToHumanToolInputSchema>, HumanToolResult> {
  return tool(buildSendToHumanToolDefinition(clientOrOptions, maybeOptions));
}

export { sendToHumanToolInputSchema };
export type { CreateSendToHumanToolDurableOptions, CreateSendToHumanToolOptions };
