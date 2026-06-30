import { describe, expect, it, vi } from "vitest";
import type { RobotRock } from "../client.js";
import {
  applyRobotRockToolApprovalToTools,
  collectApprovalRequests,
  createRobotRockNeedsApproval,
  createRobotRockToolApproval,
  resolveToolApprovalsViaRobotRock,
} from "./tool-approval-bridge.js";
import { defaultFormatToolApprovalTask } from "./format-tool-approval-task.js";

describe("createRobotRockToolApproval", () => {
  it("returns user-approval for configured tool names", async () => {
    const toolApproval = createRobotRockToolApproval({ tools: ["deleteFile"] });

    await expect(
      toolApproval({
        toolCall: { toolName: "deleteFile", toolCallId: "c1", input: { path: "/tmp/x" } },
      })
    ).resolves.toBe("user-approval");

    await expect(
      toolApproval({
        toolCall: { toolName: "readFile", toolCallId: "c2", input: {} },
      })
    ).resolves.toBeUndefined();
  });
});

describe("createRobotRockNeedsApproval", () => {
  it("uses messages to resolve tool name", async () => {
    const needsApproval = createRobotRockNeedsApproval({ tools: ["runCommand"] });
    const messages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "tc-1",
            toolName: "runCommand",
            input: { cmd: "rm -rf /" },
          },
        ],
      },
    ];

    await expect(needsApproval({}, { toolCallId: "tc-1", messages })).resolves.toBe(true);
    await expect(needsApproval({}, { toolCallId: "other", messages })).resolves.toBe(false);
  });
});

describe("applyRobotRockToolApprovalToTools", () => {
  it("adds needsApproval to listed tools", () => {
    const tools = applyRobotRockToolApprovalToTools(
      {
        deleteFile: { execute: async () => ({ ok: true }) },
        readFile: { execute: async () => ({ ok: true }) },
      },
      { tools: ["deleteFile"] }
    );

    expect(tools.deleteFile).toHaveProperty("needsApproval");
    expect(tools.readFile).not.toHaveProperty("needsApproval");
  });
});

describe("collectApprovalRequests", () => {
  it("extracts manual approval requests from generateText-shaped content", () => {
    const requests = collectApprovalRequests({
      content: [
        {
          type: "tool-approval-request",
          approvalId: "a1",
          toolCall: {
            toolCallId: "tc-1",
            toolName: "deleteFile",
            input: { path: "/etc/passwd" },
          },
        },
        { type: "tool-approval-request", approvalId: "a2", isAutomatic: true },
      ],
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.approvalId).toBe("a1");
    expect(requests[0]?.toolCall?.toolName).toBe("deleteFile");
  });
});

describe("resolveToolApprovalsViaRobotRock", () => {
  it("maps approve/deny inbox actions to tool-approval-response", async () => {
    const sendToHuman = vi
      .fn()
      .mockResolvedValueOnce({
        mode: "handled",
        task: { taskId: "task_1" },
        actionId: "approve",
        data: {},
        handledAt: new Date("2026-01-01T00:00:00Z"),
        taskId: "task_1",
      })
      .mockResolvedValueOnce({
        mode: "handled",
        task: { taskId: "task_2" },
        actionId: "deny",
        data: { reason: "Too risky" },
        handledAt: new Date("2026-01-01T00:00:00Z"),
        taskId: "task_2",
      });

    const client = { sendToHuman } as unknown as RobotRock;

    const source = {
      content: [
        {
          type: "tool-approval-request",
          approvalId: "ap-1",
          toolCall: {
            toolCallId: "tc-1",
            toolName: "deleteFile",
            input: { path: "/tmp/a" },
          },
        },
        {
          type: "tool-approval-request",
          approvalId: "ap-2",
          toolCall: {
            toolCallId: "tc-2",
            toolName: "runCommand",
            input: { cmd: "shutdown" },
          },
        },
      ],
      messages: [],
    };

    const { responses } = await resolveToolApprovalsViaRobotRock(client, source, {
      formatTask: defaultFormatToolApprovalTask,
    });

    expect(sendToHuman).toHaveBeenCalledTimes(2);
    expect(responses).toEqual([
      {
        type: "tool-approval-response",
        approvalId: "ap-1",
        approved: true,
        reason: "Approved in RobotRock inbox",
      },
      {
        type: "tool-approval-response",
        approvalId: "ap-2",
        approved: false,
        reason: "Too risky",
      },
    ]);
  });
});
