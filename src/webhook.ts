import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const ROBOTROCK_SIGNATURE_HEADER = "x-robotrock-signature";

const robotRockWebhookPayloadBodySchema = z.object({
  taskId: z.string().min(1),
  action: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    data: z.unknown(),
  }),
  handledBy: z.string().min(1).optional(),
  handledAt: z.string().min(1),
  handlerType: z.string().min(1),
});

export type RobotRockWebhookPayload = z.infer<
  typeof robotRockWebhookPayloadBodySchema
> & {
  headers: Record<string, string>;
};

export type RobotRockWebhookErrorCode =
  | "MISSING_WEBHOOK_SECRET"
  | "MISSING_SIGNATURE"
  | "INVALID_SIGNATURE"
  | "INVALID_JSON"
  | "INVALID_PAYLOAD";

export class RobotRockWebhookError extends Error {
  constructor(
    message: string,
    public readonly code: RobotRockWebhookErrorCode,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "RobotRockWebhookError";
  }
}

export interface VerifyRobotRockWebhookOptions {
  /**
   * Override shared secret (defaults to ROBOTROCK_WEBHOOK_SECRET).
   * Keep undefined in production to enforce the canonical env var.
   */
  secret?: string;
  /**
   * Resolve the tenant signing secret by public task id (hosted MCP uses Convex).
   * Used when secret is not passed explicitly.
   */
  resolveSecret?: (taskId: string) => Promise<string | undefined>;
  /** Signature header to read. @default "x-robotrock-signature" */
  signatureHeader?: string;
}

/**
 * Verify a RobotRock webhook request and return a validated payload.
 * Throws RobotRockWebhookError with machine-readable `code` for audit logging.
 */
export async function verifyRobotRockWebhook(
  request: Request,
  options: VerifyRobotRockWebhookOptions = {}
): Promise<RobotRockWebhookPayload> {
  const signatureHeaderName = options.signatureHeader ?? ROBOTROCK_SIGNATURE_HEADER;
  const signature = request.headers.get(signatureHeaderName);

  if (!signature) {
    throw new RobotRockWebhookError(
      `Missing webhook signature header: ${signatureHeaderName}`,
      "MISSING_SIGNATURE"
    );
  }

  const rawBody = await request.text();
  const secret = await resolveWebhookSigningSecret(rawBody, options);

  if (!secret) {
    throw new RobotRockWebhookError(
      "Missing webhook signing secret for verification",
      "MISSING_WEBHOOK_SECRET"
    );
  }

  assertValidSignature(rawBody, signature, secret);

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch (error) {
    throw new RobotRockWebhookError("Webhook body is not valid JSON", "INVALID_JSON", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const payloadResult = robotRockWebhookPayloadBodySchema.safeParse(parsedBody);
  if (!payloadResult.success) {
    throw new RobotRockWebhookError(
      "Webhook payload schema validation failed",
      "INVALID_PAYLOAD",
      payloadResult.error.flatten()
    );
  }

  return {
    ...payloadResult.data,
    headers: normalizeHeaders(request.headers),
  };
}

async function resolveWebhookSigningSecret(
  rawBody: string,
  options: VerifyRobotRockWebhookOptions
): Promise<string | undefined> {
  if (options.secret) {
    return options.secret;
  }

  if (options.resolveSecret) {
    const taskId = peekWebhookTaskId(rawBody);
    if (taskId) {
      const resolved = await options.resolveSecret(taskId);
      if (resolved) {
        return resolved;
      }
    }
  }

  return process.env.ROBOTROCK_WEBHOOK_SECRET;
}

function peekWebhookTaskId(rawBody: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "taskId" in parsed &&
      typeof (parsed as { taskId: unknown }).taskId === "string"
    ) {
      return (parsed as { taskId: string }).taskId;
    }
  } catch {
    // fall through
  }
  return undefined;
}

function assertValidSignature(rawBody: string, signature: string, secret: string): void {
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signature);

  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    throw new RobotRockWebhookError("Webhook signature verification failed", "INVALID_SIGNATURE");
  }
}

function normalizeHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}
