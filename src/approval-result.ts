import type { DiscriminatedApprovalResult, Task } from "./schemas/index.js";

export class TaskTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskTimeoutError";
  }
}

export class TaskExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskExpiredError";
  }
}

/**
 * Map a handled API task to a discriminated approval result.
 * Runtime validation is minimal; TypeScript narrows via `task.actions` at the call site.
 */
export function toDiscriminatedApprovalResult<A extends readonly { id: string; schema?: unknown }[]>(
  actions: A,
  task: Task
): DiscriminatedApprovalResult<A> {
  void actions;

  if (!task.handled) {
    throw new Error("Task has no handled result");
  }

  return {
    actionId: task.handled.action.id,
    data: task.handled.action.data,
    handledBy: task.handled.handledBy,
    handledAt: new Date(task.handledAt ?? Date.now()),
    taskId: task.id,
  } as DiscriminatedApprovalResult<A>;
}
