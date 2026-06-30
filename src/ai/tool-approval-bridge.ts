import type { ToolApprovalResponse } from "ai";
import type { RobotRock } from "../client.js";
import {
  normalizeRobotRockAiContext,
  sendToHumanForAi,
  type RobotRockAiContext,
} from "./context.js";
import { defaultFormatToolApprovalTask } from "./format-tool-approval-task.js";
import type {
  ResolveToolApprovalsOptions,
  RobotRockToolApprovalConfig,
  RobotRockToolCallInfo,
  RunWithRobotRockApprovalsOptions,
  ToolApprovalRequestPart,
} from "./types.js";

export type RobotRockToolApprovalDecision = "user-approval" | undefined;

function buildToolMatcher(config: RobotRockToolApprovalConfig) {
  const names = config.tools ? new Set(config.tools) : null;

  return (toolCall: RobotRockToolCallInfo): boolean => {
    if (config.when?.(toolCall)) {
      return true;
    }
    if (names && names.has(toolCall.toolName)) {
      return true;
    }
    return false;
  };
}

/**
 * AI SDK 7+: pass the return value to `toolApproval` on `generateText`, `streamText`, or `ToolLoopAgent`.
 * Returns `'user-approval'` for configured tools so execution pauses until a human responds via RobotRock.
 */
export function createRobotRockToolApproval(config: RobotRockToolApprovalConfig) {
  const matches = buildToolMatcher(config);

  const toolApproval = async (options: {
    toolCall: RobotRockToolCallInfo;
  }): Promise<RobotRockToolApprovalDecision> => {
    return matches(options.toolCall) ? "user-approval" : undefined;
  };

  return toolApproval;
}

/**
 * AI SDK 5–6: use as `needsApproval` on tool definitions (or via {@link applyRobotRockToolApprovalToTools}).
 */
export function createRobotRockNeedsApproval(config: RobotRockToolApprovalConfig) {
  const matches = buildToolMatcher(config);

  return async (
    _input: unknown,
    options: { toolCallId: string; messages?: unknown[] }
  ): Promise<boolean> => {
    const toolCall = findToolCallInMessages(options.messages, options.toolCallId);
    if (!toolCall) {
      return false;
    }
    return matches(toolCall);
  };
}

/**
 * AI SDK 5–6: merge `needsApproval` into each matching tool in a tools object.
 */
export function applyRobotRockToolApprovalToTools<T extends Record<string, object>>(
  tools: T,
  config: RobotRockToolApprovalConfig
): T {
  const names = config.tools ? new Set(config.tools) : null;
  const needsApproval = createRobotRockNeedsApproval(config);

  const next = { ...tools } as T;

  for (const key of Object.keys(tools) as Array<keyof T>) {
    const name = String(key);
    const shouldApply =
      (names && names.has(name)) || (names === null && config.when !== undefined);

    if (!shouldApply) {
      continue;
    }

    const existing = tools[key];
    next[key] = {
      ...existing,
      needsApproval,
    } as T[keyof T];
  }

  return next;
}

function findToolCallInMessages(
  messages: unknown[] | undefined,
  toolCallId: string
): RobotRockToolCallInfo | undefined {
  if (!messages) {
    return undefined;
  }

  for (const message of messages) {
    if (typeof message !== "object" || message === null) {
      continue;
    }
    const role = (message as { role?: string }).role;
    if (role !== "assistant") {
      continue;
    }
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      if (typeof part !== "object" || part === null) {
        continue;
      }
      const p = part as Record<string, unknown>;
      if (p.type === "tool-call" && p.toolCallId === toolCallId) {
        return {
          toolName: String(p.toolName ?? ""),
          toolCallId,
          input: p.input,
        };
      }
    }
  }

  return undefined;
}

function collectApprovalRequests(source: unknown): ToolApprovalRequestPart[] {
  const requests: ToolApprovalRequestPart[] = [];

  const visit = (value: unknown) => {
    if (!value) {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    if (typeof value !== "object") {
      return;
    }

    const obj = value as Record<string, unknown>;

    if (obj.type === "tool-approval-request" && typeof obj.approvalId === "string") {
      if (obj.isAutomatic === true) {
        return;
      }

      const embedded = obj.toolCall as Record<string, unknown> | undefined;
      const toolCallId =
        typeof obj.toolCallId === "string"
          ? obj.toolCallId
          : typeof embedded?.toolCallId === "string"
            ? embedded.toolCallId
            : undefined;

      let toolCall: RobotRockToolCallInfo | undefined;
      if (embedded && typeof embedded.toolName === "string") {
        toolCall = {
          toolName: embedded.toolName,
          toolCallId: String(embedded.toolCallId ?? toolCallId ?? ""),
          input: embedded.input,
        };
      } else if (toolCallId) {
        toolCall = findToolCallInMessages(
          (source as { messages?: unknown[] }).messages,
          toolCallId
        );
      }

      requests.push({
        type: "tool-approval-request",
        approvalId: obj.approvalId,
        toolCallId,
        toolCall,
        isAutomatic: obj.isAutomatic === true,
      });
      return;
    }

    if (Array.isArray(obj.content)) {
      visit(obj.content);
    }
    if (Array.isArray(obj.steps)) {
      visit(obj.steps);
    }
    if (obj.response && typeof obj.response === "object") {
      visit((obj.response as { messages?: unknown[] }).messages);
    }
  };

  visit(source);

  if (typeof source === "object" && source !== null && Array.isArray((source as { content?: unknown[] }).content)) {
    visit((source as { content: unknown[] }).content);
  }

  const seen = new Set<string>();
  return requests.filter((r) => {
    if (seen.has(r.approvalId)) {
      return false;
    }
    seen.add(r.approvalId);
    return true;
  });
}

function resolveToolCallForRequest(
  request: ToolApprovalRequestPart,
  source: unknown,
  messages: unknown[]
): RobotRockToolCallInfo {
  if (request.toolCall) {
    return request.toolCall;
  }

  const toolCallId = request.toolCallId;
  if (toolCallId) {
    const fromMessages = findToolCallInMessages(messages, toolCallId);
    if (fromMessages) {
      return fromMessages;
    }
  }

  if (typeof source === "object" && source !== null && Array.isArray((source as { toolCalls?: unknown[] }).toolCalls)) {
    for (const call of (source as { toolCalls: Array<Record<string, unknown>> }).toolCalls) {
      if (call.toolCallId === toolCallId) {
        return {
          toolName: String(call.toolName ?? ""),
          toolCallId: String(call.toolCallId ?? ""),
          input: call.input,
        };
      }
    }
  }

  throw new Error(
    `Could not resolve tool call for approval ${request.approvalId}. Pass messages that include the assistant tool-call.`
  );
}

/**
 * Create RobotRock tasks for pending AI SDK tool approvals and return `tool-approval-response` parts.
 */
export async function resolveToolApprovalsViaRobotRock(
  clientOrContext: RobotRock | RobotRockAiContext,
  source: unknown,
  options: ResolveToolApprovalsOptions = {}
): Promise<{
  responses: ToolApprovalResponse[];
  messages: unknown[];
}> {
  const context = normalizeRobotRockAiContext(clientOrContext);
  const approveId = options.approveActionId ?? "approve";
  const denyId = options.denyActionId ?? "deny";
  const formatTask = options.formatTask ?? defaultFormatToolApprovalTask;

  const baseMessages =
    typeof source === "object" && source !== null && Array.isArray((source as { messages?: unknown[] }).messages)
      ? [...(source as { messages: unknown[] }).messages]
      : [];

  const requests = collectApprovalRequests(source);
  const responses: ToolApprovalResponse[] = [];

  for (const request of requests) {
    const toolCall = resolveToolCallForRequest(request, source, baseMessages);
    const taskInput = formatTask(toolCall, {
      approveActionId: approveId,
      denyActionId: denyId,
    });

    const result = await sendToHumanForAi(context, taskInput);

    const approved = result.actionId === approveId;
    const reason =
      typeof result.data === "object" &&
      result.data !== null &&
      "reason" in result.data &&
      typeof (result.data as { reason?: unknown }).reason === "string"
        ? (result.data as { reason: string }).reason
        : approved
          ? "Approved in RobotRock inbox"
          : "Denied in RobotRock inbox";

    responses.push({
      type: "tool-approval-response",
      approvalId: request.approvalId,
      approved,
      reason,
    });
  }

  const messages = [...baseMessages];
  if (responses.length > 0) {
    messages.push({ role: "tool", content: responses });
  }

  return { responses, messages };
}

/**
 * Run `generate` in a loop until manual tool approvals are resolved via RobotRock or `maxRounds` is reached.
 */
export async function runWithRobotRockApprovals<T>(
  options: RunWithRobotRockApprovalsOptions<T>
): Promise<T> {
  const clientOrContext =
    options.context ??
    (options.client
      ? options.client
      : (() => {
          throw new Error("runWithRobotRockApprovals requires `client` or `context`.");
        })());

  const maxRounds = options.maxRounds ?? 20;
  let messages = options.messages ? [...options.messages] : [];
  let lastResult: T | undefined;

  for (let round = 0; round < maxRounds; round++) {
    lastResult = await options.generate(messages);
    const { responses, messages: nextMessages } = await resolveToolApprovalsViaRobotRock(
      clientOrContext,
      { ...(lastResult as object), messages },
      options.resolveOptions
    );

    if (responses.length === 0) {
      return lastResult;
    }

    messages = nextMessages;
  }

  throw new Error(`RobotRock approval loop exceeded maxRounds (${maxRounds})`);
}

export { collectApprovalRequests };
