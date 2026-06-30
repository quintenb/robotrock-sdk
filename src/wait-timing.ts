/** Default wait when `validUntil` is omitted. */
export const DEFAULT_WAIT_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export function resolveWaitTiming(validUntilInput?: Date | string): {
  validUntil: Date | string;
  timeout: string;
} {
  const validUntilMs =
    validUntilInput !== undefined
      ? parseValidUntilMs(validUntilInput)
      : Date.now() + DEFAULT_WAIT_DURATION_MS;

  const durationMs = validUntilMs - Date.now();
  if (durationMs <= 0) {
    throw new Error("validUntil must be in the future");
  }

  return {
    validUntil: validUntilInput ?? new Date(validUntilMs),
    timeout: durationMsToTimeout(durationMs),
  };
}

export function parseValidUntilMs(value: Date | string): number {
  if (value instanceof Date) {
    const ms = value.getTime();
    if (Number.isNaN(ms)) {
      throw new Error("Invalid validUntil: Date is invalid");
    }
    return ms;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error("Invalid validUntil: expected a parseable date string");
  }

  return parsed;
}

/** Duration string for Trigger.dev `wait.createToken` and Workflow `sleep`. */
export function durationMsToTimeout(durationMs: number): string {
  const seconds = Math.ceil(durationMs / 1000);
  if (seconds <= 0) {
    throw new Error("validUntil must be in the future");
  }

  if (seconds >= 86_400) {
    return `${Math.ceil(seconds / 86_400)}d`;
  }
  if (seconds >= 3_600) {
    return `${Math.ceil(seconds / 3_600)}h`;
  }
  if (seconds >= 60) {
    return `${Math.ceil(seconds / 60)}m`;
  }

  return `${seconds}s`;
}
