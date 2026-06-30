/**
 * JSON body posted when a RobotRock action handler runs (webhook or Trigger wait token).
 */
export interface RobotRockHandlerWebhookPayload {
  taskId: string;
  action: {
    id: string;
    title: string;
    data: unknown;
  };
  handledBy?: string;
  handledAt: string;
  handlerType: string;
}

export function isRobotRockHandlerWebhookPayload(
  value: unknown
): value is RobotRockHandlerWebhookPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  if (typeof v.taskId !== "string" || typeof v.handledAt !== "string") {
    return false;
  }
  const action = v.action;
  if (typeof action !== "object" || action === null) {
    return false;
  }
  const a = action as Record<string, unknown>;
  return typeof a.id === "string" && "data" in a;
}
