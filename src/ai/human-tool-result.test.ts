import { describe, expect, it, vi } from "vitest";
import type { RobotRock } from "../client.js";
import { approveByHumanTool } from "./approve-by-human-tool.js";
import { createSendToHumanTool } from "./create-send-to-human-tool.js";
import { toHumanToolResult } from "./human-tool-result.js";

/** AI SDK 7+ requires `context` on tool execute options. */
const toolExecuteOptions = (toolCallId: string) => ({
  toolCallId,
  messages: [],
  context: {},
});

describe("toHumanToolResult", () => {
  it("sets approved flag for approve/decline actions", () => {
    expect(
      toHumanToolResult({
        taskId: "t1",
        actionId: "approve",
        data: {},
        handledAt: new Date(),
      }).approved
    ).toBe(true);

    expect(
      toHumanToolResult({
        taskId: "t1",
        actionId: "decline",
        data: {},
        handledAt: new Date(),
      }).approved
    ).toBe(false);
  });
});

describe("approveByHumanTool", () => {
  it("returns human tool result when sendToHuman is handled", async () => {
    const sendToHuman = vi.fn().mockResolvedValue({
      mode: "handled",
      task: { taskId: "task_abc" },
      actionId: "approve",
      data: {},
      handledBy: "user_1",
      handledAt: new Date("2026-06-04T12:00:00Z"),
      taskId: "task_abc",
    });

    const client = { sendToHuman } as unknown as RobotRock;
    const t = approveByHumanTool(client);

    const result = await t.execute!(
      {
        name: "Ship release",
        description: "Deploy v2 to production",
      },
      toolExecuteOptions("x")
    );

    expect(sendToHuman).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ai-approval",
        name: "Ship release",
        actions: [
          { id: "approve", title: "Approve" },
          { id: "decline", title: "Decline" },
        ],
      })
    );
    expect(result).toMatchObject({
      taskId: "task_abc",
      actionId: "approve",
      approved: true,
      handledBy: "user_1",
    });
  });
});

describe("createSendToHumanTool", () => {
  it("uses factory actions and default type", async () => {
    const sendToHuman = vi.fn().mockResolvedValue({
      mode: "handled",
      task: { taskId: "task_xyz" },
      actionId: "pick-a",
      data: { choice: "a" },
      handledAt: new Date(),
      taskId: "task_xyz",
    });

    const client = { sendToHuman } as unknown as RobotRock;
    const t = createSendToHumanTool(client, {
      defaultType: "picker",
      actions: [
        { id: "pick-a", title: "Option A" },
        { id: "pick-b", title: "Option B" },
      ] as const,
    });

    const result = await t.execute!(
      { name: "Choose", type: "picker" },
      toolExecuteOptions("y")
    );

    expect(result).toMatchObject({ actionId: "pick-a" });
    expect(sendToHuman).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "picker",
        actions: [
          { id: "pick-a", title: "Option A" },
          { id: "pick-b", title: "Option B" },
        ],
      })
    );
  });
});
