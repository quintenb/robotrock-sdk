import type { RobotRock, SendToHumanActionInput } from "../client.js";
import {
  buildApproveByHumanToolDefinition,
  type ApproveByHumanToolDurableOptions,
  type ApproveByHumanToolOptions,
} from "./approve-by-human-tool-core.js";
import {
  buildSendToHumanToolDefinition,
  type CreateSendToHumanToolDurableOptions,
  type CreateSendToHumanToolOptions,
} from "./create-send-to-human-tool-core.js";
import {
  buildSendUpdateToolDefinition,
  type CreateSendUpdateToolDurableOptions,
  type CreateSendUpdateToolOptions,
} from "./create-send-update-tool-core.js";
import type { RobotRockAiWorkflowContext } from "./context.js";

/**
 * Workflow-safe approve/decline tool for `generateText`, `DurableAgent`, and similar.
 * Returns a plain `{ description, inputSchema, execute }` object — no AI SDK `tool()` helper.
 */
export function approveByHumanTool(
  clientOrContext: RobotRock | ApproveByHumanToolDurableOptions,
  maybeOptions: ApproveByHumanToolOptions = {}
) {
  return buildApproveByHumanToolDefinition(clientOrContext, maybeOptions);
}

/**
 * Workflow-safe send-to-human tool. See {@link approveByHumanTool} for usage notes.
 */
export function createSendToHumanTool<
  A extends readonly SendToHumanActionInput[] = readonly SendToHumanActionInput[],
>(
  clientOrOptions: RobotRock | CreateSendToHumanToolDurableOptions<A>,
  maybeOptions?: CreateSendToHumanToolOptions<A>
) {
  return buildSendToHumanToolDefinition(clientOrOptions, maybeOptions);
}

/**
 * Workflow-safe send-update tool. See {@link approveByHumanTool} for usage notes.
 */
export function createSendUpdateTool(
  clientOrOptions: RobotRock | CreateSendUpdateToolDurableOptions,
  maybeOptions: CreateSendUpdateToolOptions = {}
) {
  return buildSendUpdateToolDefinition(clientOrOptions, maybeOptions);
}

export type CreateRobotRockAiWorkflowToolsOptions = {
  app?: string;
  threadId?: string;
};

export function createRobotRockAiTools(options: CreateRobotRockAiWorkflowToolsOptions = {}) {
  const context: RobotRockAiWorkflowContext = { mode: "workflow", app: options.app };

  return {
    context,
    approveByHuman: (toolOptions?: ApproveByHumanToolOptions) =>
      buildApproveByHumanToolDefinition({ ...context, ...toolOptions }),
    sendToHuman: <A extends readonly SendToHumanActionInput[]>(
      toolOptions: CreateSendToHumanToolOptions<A>
    ) =>
      buildSendToHumanToolDefinition({
        ...context,
        ...(options.threadId ? { threadId: options.threadId } : {}),
        ...toolOptions,
      }),
    sendUpdate: (toolOptions: CreateSendUpdateToolOptions = {}) =>
      buildSendUpdateToolDefinition({
        ...context,
        ...(options.threadId ? { threadId: options.threadId } : {}),
        ...toolOptions,
      }),
  };
}
