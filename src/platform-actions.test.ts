import { describe, expect, it } from "vitest";
import {
  PLATFORM_MARK_DONE_ACTION_ID,
  PLATFORM_REJECT_REQUEST_ACTION_ID,
  PlatformRejectRequestError,
  assertNotPlatformRejectRequest,
  isPlatformTerminalAction,
  parseHandledOutcome,
  parsePlatformRejectRequestData,
  shouldStopAgentForHandledAction,
} from "./platform-actions.js";

describe("platform-actions", () => {
  it("identifies platform terminal action ids", () => {
    expect(isPlatformTerminalAction(PLATFORM_MARK_DONE_ACTION_ID)).toBe(true);
    expect(isPlatformTerminalAction(PLATFORM_REJECT_REQUEST_ACTION_ID)).toBe(true);
    expect(isPlatformTerminalAction("approve")).toBe(false);
    expect(shouldStopAgentForHandledAction(PLATFORM_REJECT_REQUEST_ACTION_ID)).toBe(
      true
    );
  });

  it("parses reject feedback", () => {
    expect(parsePlatformRejectRequestData({ feedback: "  loop  " })).toEqual({
      feedback: "loop",
    });
    expect(parsePlatformRejectRequestData({ feedback: "" })).toBeNull();
    expect(parsePlatformRejectRequestData(null)).toBeNull();
  });

  it("classifies handled outcomes", () => {
    expect(
      parseHandledOutcome({
        actionId: PLATFORM_MARK_DONE_ACTION_ID,
        handledAt: 1,
      })
    ).toMatchObject({ source: "platform", kind: "mark-done" });

    expect(
      parseHandledOutcome({
        actionId: PLATFORM_REJECT_REQUEST_ACTION_ID,
        data: { feedback: "bad task" },
      })
    ).toMatchObject({
      source: "platform",
      kind: "reject-request",
      data: { feedback: "bad task" },
    });

    expect(
      parseHandledOutcome({ actionId: "approve", data: { ok: true } })
    ).toMatchObject({ source: "task", actionId: "approve" });
  });

  it("throws PlatformRejectRequestError for platform reject", () => {
    expect(() =>
      assertNotPlatformRejectRequest(PLATFORM_REJECT_REQUEST_ACTION_ID, {
        feedback: "stuck in a loop",
      })
    ).toThrow(PlatformRejectRequestError);

    expect(() => assertNotPlatformRejectRequest("approve", {})).not.toThrow();
  });
});
