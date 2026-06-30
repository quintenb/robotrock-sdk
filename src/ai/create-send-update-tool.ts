import { tool, type Tool } from "ai";
import type { z } from "zod";
import type { RobotRock } from "../client.js";
import {
  buildSendUpdateToolDefinition,
  sendUpdateToolInputSchema,
  type CreateSendUpdateToolDurableOptions,
  type CreateSendUpdateToolOptions,
  type SendUpdateToolResult,
} from "./create-send-update-tool-core.js";

/**
 * AI SDK tool that posts a progress update to a RobotRock thread.
 *
 * Fire-and-forget (no human wait): the agent reports status as it works.
 *
 * - `createSendUpdateTool(robotrock, options?)` — polling client (default).
 * - `createSendUpdateTool({ mode: "trigger", app?: "my-agent" })` — Trigger.dev worker.
 * - `createSendUpdateTool({ mode: "workflow", app?: "my-agent" })` — Vercel Workflow (durable step).
 *
 * In Vercel Workflow functions, import from `robotrock/ai/workflow` instead.
 */
export function createSendUpdateTool(
  clientOrOptions: RobotRock | CreateSendUpdateToolDurableOptions,
  maybeOptions: CreateSendUpdateToolOptions = {}
): Tool<z.infer<typeof sendUpdateToolInputSchema>, SendUpdateToolResult> {
  return tool(buildSendUpdateToolDefinition(clientOrOptions, maybeOptions));
}

export { sendUpdateToolInputSchema };
export type { CreateSendUpdateToolDurableOptions, CreateSendUpdateToolOptions, SendUpdateToolResult };
