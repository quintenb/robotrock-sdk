import { describe, expect, it } from "vitest";
import { normalizeRobotRockAiContext } from "./context.js";
import type { RobotRock } from "../client.js";

describe("normalizeRobotRockAiContext", () => {
  it("wraps a RobotRock client as polling mode", () => {
    const client = { sendToHuman: async () => ({}) } as unknown as RobotRock;
    expect(normalizeRobotRockAiContext(client)).toEqual({ mode: "polling", client });
  });

  it("preserves trigger mode", () => {
    expect(normalizeRobotRockAiContext({ mode: "trigger", app: "my-app" })).toEqual({
      mode: "trigger",
      app: "my-app",
    });
  });

  it("preserves workflow mode", () => {
    expect(normalizeRobotRockAiContext({ mode: "workflow", app: "my-app" })).toEqual({
      mode: "workflow",
      app: "my-app",
    });
  });
});
