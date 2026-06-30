import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { RobotRockWebhookError, verifyRobotRockWebhook } from "./webhook.js";

function signedRequest(
  body: Record<string, unknown>,
  secret: string
): Request {
  const rawBody = JSON.stringify(body);
  const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return new Request("https://example.com/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-robotrock-signature": signature,
    },
    body: rawBody,
  });
}

describe("verifyRobotRockWebhook", () => {
  it("verifies with resolveSecret using tenant task id", async () => {
    const tenantSecret = "rrwhsec_tenant_example";
    const body = {
      taskId: "task_abc",
      action: { id: "approve", title: "Approve", data: {} },
      handledBy: "alice@acme.com",
      handledAt: "2026-06-07T12:00:00.000Z",
      handlerType: "webhook",
    };

    const resolveSecret = vi.fn().mockResolvedValue(tenantSecret);

    const payload = await verifyRobotRockWebhook(signedRequest(body, tenantSecret), {
      resolveSecret,
    });

    expect(resolveSecret).toHaveBeenCalledWith("task_abc");
    expect(payload.taskId).toBe("task_abc");
    expect(payload.action.id).toBe("approve");
  });

  it("throws MISSING_WEBHOOK_SECRET when resolveSecret returns undefined", async () => {
    const body = {
      taskId: "task_missing",
      action: { id: "approve", title: "Approve", data: {} },
      handledAt: "2026-06-07T12:00:00.000Z",
      handlerType: "webhook",
    };

    await expect(
      verifyRobotRockWebhook(signedRequest(body, "rrwhsec_tenant_example"), {
        resolveSecret: vi.fn().mockResolvedValue(undefined),
      })
    ).rejects.toMatchObject({
      code: "MISSING_WEBHOOK_SECRET",
    } satisfies Partial<RobotRockWebhookError>);
  });
});
