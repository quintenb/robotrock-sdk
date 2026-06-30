import { describe, expect, it, vi, afterEach } from "vitest";
import { SpanStatusCode, type Span } from "@opentelemetry/api";
import {
  captureRobotRockOtelHandle,
  endRobotRockHumanWaitSpan,
  recordRobotRockHandledToOtel,
  toRobotRockHandledOtelInput,
} from "./record-handled-to-otel.js";
import { shouldRecordRobotRockOtel } from "./otel-platform.js";

function createMockSpan() {
  const attributes = new Map<string, string | number | boolean>();
  const events: Array<{ name: string; attributes?: Record<string, string | number | boolean> }> =
    [];
  let status: { code: SpanStatusCode; message?: string } | undefined;

  return {
    spanContext: () => ({
      traceId: "abc123def456789012345678901234ab",
      spanId: "span1234567890ab",
      traceFlags: 1,
    }),
    setAttribute: vi.fn((key: string, value: string | number | boolean) => {
      attributes.set(key, value);
    }),
    addEvent: vi.fn(
      (
        name: string,
        attrs?: Record<string, string | number | boolean>
      ) => {
        events.push({ name, attributes: attrs });
      }
    ),
    setStatus: vi.fn((next: { code: SpanStatusCode; message?: string }) => {
      status = next;
    }),
    end: vi.fn(),
    attributes,
    events,
    get status() {
      return status;
    },
  };
}

describe("shouldRecordRobotRockOtel", () => {
  const original = process.env.ROBOTROCK_OTEL_RECORD_HANDLED;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ROBOTROCK_OTEL_RECORD_HANDLED;
    } else {
      process.env.ROBOTROCK_OTEL_RECORD_HANDLED = original;
    }
  });

  it("respects explicit true/false", () => {
    expect(shouldRecordRobotRockOtel(true)).toBe(true);
    expect(shouldRecordRobotRockOtel(false)).toBe(false);
  });

  it("reads ROBOTROCK_OTEL_RECORD_HANDLED env", () => {
    process.env.ROBOTROCK_OTEL_RECORD_HANDLED = "true";
    expect(shouldRecordRobotRockOtel(undefined)).toBe(true);
  });
});

describe("toRobotRockHandledOtelInput", () => {
  it("normalizes webhook payload", () => {
    expect(
      toRobotRockHandledOtelInput({
        taskId: "task_1",
        action: { id: "approve", title: "Approve", data: { ok: true } },
        handledBy: "alice@acme.com",
        handledAt: "2026-06-01T12:00:00.000Z",
        handlerType: "webhook",
      })
    ).toMatchObject({
      taskId: "task_1",
      action: { id: "approve", title: "Approve" },
      handledBy: "alice@acme.com",
    });
  });
});

describe("recordRobotRockHandledToOtel", () => {
  it("sets attributes and event on the provided span", () => {
    const span = createMockSpan();
    const handle = captureRobotRockOtelHandle({
      taskId: "task_1",
      threadId: "thread_1",
      submittedAt: "2026-06-01T11:00:00.000Z",
    });

    recordRobotRockHandledToOtel(
      {
        taskId: "task_1",
        action: { id: "approve", title: "Approve", data: {} },
        handledBy: "alice@acme.com",
        handledAt: "2026-06-01T12:00:00.000Z",
        handlerType: "webhook",
      },
      { span: span as unknown as Span, handle }
    );

    expect(span.setAttribute).toHaveBeenCalledWith("robotrock.task_id", "task_1");
    expect(span.setAttribute).toHaveBeenCalledWith("robotrock.action.id", "approve");
    expect(span.setAttribute).toHaveBeenCalledWith(
      "robotrock.human_wait_ms",
      3_600_000
    );
    expect(span.events[0]?.name).toBe("robotrock.task_handled");
  });
});

describe("endRobotRockHumanWaitSpan", () => {
  it("marks timeout outcome on the wait span", () => {
    const span = createMockSpan();

    endRobotRockHumanWaitSpan(span as unknown as Span, null, { outcome: "timeout" });

    expect(span.setAttribute).toHaveBeenCalledWith("robotrock.outcome", "timeout");
    expect(span.status?.code).toBe(SpanStatusCode.ERROR);
    expect(span.end).toHaveBeenCalled();
  });
});
