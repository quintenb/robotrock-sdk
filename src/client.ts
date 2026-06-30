import {
  type AssignToInput,
  type TaskContextInput,
  createTaskBodySchema,
  threadUpdateBodySchema,
  TASK_CONTEXT_FORMAT_VERSION,
} from "./schemas/index.js";
import {
  TaskExpiredError,
  TaskTimeoutError,
  toDiscriminatedApprovalResult,
} from "./approval-result.js";
import type {
  DiscriminatedApprovalResult,
  Task,
  TaskPriority,
  TaskResponse,
  ThreadUpdate,
  ThreadUpdateResponse,
  ThreadUpdateStatus,
  TaskContextFormatVersion,
} from "./schemas/index.js";

export type RobotRockWebhookConfig = {
  url: string;
  headers?: Record<string, string>;
};

export interface RobotRockPollingOptions {
  /** Poll interval when no webhook is configured (ms). @default 2000 */
  intervalMs?: number;
  /**
   * Max time to poll when no webhook is configured (ms).
   * Polling also stops when the task's `validUntil` passes, whichever is sooner.
   * @default 86400000 (24h)
   */
  timeoutMs?: number;
};

/** Advanced client settings rarely changed by integrators. */
export type RobotRockAdvancedConfig = {
  /** Task context wire format version sent on every request. @default 2 */
  contextVersion?: TaskContextFormatVersion;
};

type RobotRockClientBaseConfig = {
  /** Optional override for API key. Falls back to ROBOTROCK_API_KEY. */
  apiKey?: string;
  /**
   * Base URL for the RobotRock API
   * @default "https://api.robotrock.io/v1"
   */
  baseUrl?: string;
  /**
   * Default inbox app bucket for every task from this client.
   * When omitted, the API uses your API key name.
   */
  app?: string;
  /**
   * Agent release version (semver, git SHA, deploy tag).
   * Defaults to `AGENT_VERSION` or `ROBOTROCK_AGENT_VERSION` from env when omitted.
   */
  version?: string;
  /** Advanced settings (context wire format, etc.). */
  advanced?: RobotRockAdvancedConfig;
};

/** Client config with a webhook (mutually exclusive with `polling`). */
export type RobotRockWebhookClientConfig = RobotRockClientBaseConfig & {
  webhook: RobotRockWebhookConfig;
  polling?: never;
};

/** Client config without a webhook; optional `polling` controls the wait loop. */
export type RobotRockPollingClientConfig = RobotRockClientBaseConfig & {
  webhook?: never;
  polling?: RobotRockPollingOptions;
};

export type RobotRockConfig = RobotRockWebhookClientConfig | RobotRockPollingClientConfig;

export type SendToHumanActionInput = Omit<TaskContextInput["actions"][number], "handlers">;

export type SendToHumanValidUntil = Date | string;

export type SendToHumanInput<
  A extends readonly SendToHumanActionInput[] = readonly SendToHumanActionInput[],
> = Omit<TaskContextInput, "app" | "actions" | "contextVersion" | "version" | "validUntil"> & {
  actions: A;
  /** Task deadline; serialized to an ISO 8601 string on the wire. */
  validUntil?: SendToHumanValidUntil;
  /** Optional idempotency key to prevent duplicate tasks */
  idempotencyKey?: string;
  /** Assign to tenant users (email) and/or groups (slug). Narrows inbox visibility. */
  assignTo?: AssignToInput;
  /**
   * Groups related tasks together in the inbox. Omit to let the server generate
   * one (returned as `task.threadId`) and reuse it on later tasks in the thread.
   */
  threadId?: string;
  /**
   * Optional thread priority. When set, applies to the whole thread and
   * overwrites any previous priority. Omit on later tasks to leave unchanged.
   */
  priority?: TaskPriority;
  /**
   * Optional initial status update logged against the task's thread. Shows in
   * the inbox status bar and the thread update log.
   */
  update?: {
    /** A short status update (1-2 sentences). */
    message: string;
    /** Lifecycle status for the icon/color in the status bar. @default "info" */
    status?: ThreadUpdateStatus;
  };
  /**
   * Agent release version override. When omitted, uses the client `version`.
   * Used for statistics and feedback analysis.
   */
  version?: string;
};

type SendToHumanWithAppInput<
  A extends readonly SendToHumanActionInput[] = readonly SendToHumanActionInput[],
> = (SendToHumanInput<A> | Readonly<SendToHumanInput<A>>) & {
  /** Inbox app bucket. Overrides the client `app` when set. */
  app?: string;
};

export type SendUpdateInput = {
  /** The thread to log the update against (from `task.threadId`). */
  threadId: string;
  /** A short status update (1-2 sentences). */
  message: string;
  /** Lifecycle status for the icon/color in the status bar. @default "info" */
  status?: ThreadUpdateStatus;
};

export type SendToHumanResult<
  A extends readonly SendToHumanActionInput[] = readonly SendToHumanActionInput[],
> =
  | {
      mode: "created";
      task: TaskResponse["task"];
    }
  | ({
      mode: "handled";
      task: TaskResponse["task"];
    } & DiscriminatedApprovalResult<A>);

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 24 * 60 * 60 * 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveAgentVersionFromEnv(): string | undefined {
  const fromEnv =
    process.env.AGENT_VERSION?.trim() || process.env.ROBOTROCK_AGENT_VERSION?.trim();
  return fromEnv || undefined;
}

function parseValidUntilMs(value: string | number | Date | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? undefined : ms;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function serializeValidUntil(value: SendToHumanValidUntil): string {
  if (value instanceof Date) {
    const ms = value.getTime();
    if (Number.isNaN(ms)) {
      throw new RobotRockError("Invalid validUntil: Date is invalid", 400);
    }
    return value.toISOString();
  }

  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }

  throw new RobotRockError("Invalid validUntil: expected a Date or parseable date string", 400);
}

export class RobotRockError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly response?: unknown
  ) {
    super(message);
    this.name = "RobotRockError";
  }
}

/**
 * RobotRock API client for creating and querying human-in-the-loop tasks.
 */
export class RobotRock {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly app?: string;
  private readonly agentVersion?: string;
  private readonly contextVersion: TaskContextFormatVersion;
  private readonly webhook?: RobotRockWebhookConfig;
  private readonly polling: RobotRockPollingOptions;

  constructor(config: RobotRockConfig) {
    if (config.webhook && config.polling) {
      throw new Error(
        "RobotRock client cannot configure both webhook and polling. Use webhook for callbacks or polling to block until handled."
      );
    }

    const apiKey = config.apiKey ?? process.env.ROBOTROCK_API_KEY;
    if (!apiKey) {
      throw new Error(
        "RobotRock API key is required. Set ROBOTROCK_API_KEY or pass apiKey when creating the client."
      );
    }
    this.apiKey = apiKey;
    const rawBase = config.baseUrl ?? "https://api.robotrock.io/v1";
    this.baseUrl = rawBase.replace(/\/+$/, "");
    this.app = config.app;
    this.agentVersion = config.version ?? resolveAgentVersionFromEnv();
    this.contextVersion =
      config.advanced?.contextVersion ?? TASK_CONTEXT_FORMAT_VERSION;
    this.webhook = config.webhook;
    this.polling = config.polling ?? {};
  }

  /**
   * Create a task via POST /v1 without waiting for a human response.
   */
  async createTask<const A extends readonly SendToHumanActionInput[]>(
    task: SendToHumanWithAppInput<A>
  ): Promise<TaskResponse["task"]> {
    const normalizedTask = normalizeSendToHumanInput(task, {
      webhook: this.webhook,
      app: this.app,
      contextVersion: this.contextVersion,
      agentVersion: this.agentVersion,
    });
    const agentVersion = task.version ?? this.agentVersion;
    const bodyPayload = {
      ...normalizedTask,
      ...(task.assignTo !== undefined ? { assignTo: task.assignTo } : {}),
      ...(task.threadId !== undefined ? { threadId: task.threadId } : {}),
      ...(task.priority !== undefined ? { priority: task.priority } : {}),
      ...(task.update !== undefined ? { update: task.update } : {}),
      ...(agentVersion !== undefined ? { agent: { version: agentVersion } } : {}),
    };
    const validation = createTaskBodySchema.safeParse(bodyPayload);
    if (!validation.success) {
      throw new RobotRockError(
        `Invalid task: ${validation.error.issues[0]?.message}`,
        400,
        validation.error.issues
      );
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Api-Key": this.apiKey,
    };

    if (task.idempotencyKey) {
      headers["Idempotency-Key"] = task.idempotencyKey;
    }

    const response = await fetch(`${this.baseUrl}/`, {
      method: "POST",
      headers,
      body: JSON.stringify(validation.data),
    });

    const data = await parseResponseBody(response);

    if (!response.ok) {
      throw new RobotRockError(
        getErrorMessage(data, "Failed to create task"),
        response.status,
        data
      );
    }

    return (data as unknown as TaskResponse).task;
  }

  async sendToHuman<const A extends readonly SendToHumanActionInput[]>(
    task: SendToHumanWithAppInput<A>
  ): Promise<SendToHumanResult<A>> {
    const normalizedTask = normalizeSendToHumanInput(task, {
      webhook: this.webhook,
      app: this.app,
      contextVersion: this.contextVersion,
      agentVersion: this.agentVersion,
    });
    const createdTaskTask = await this.createTask(task);
    const hasHandlers = normalizedTask.actions.some(
      (action) => Array.isArray(action.handlers) && action.handlers.length > 0
    );

    if (hasHandlers) {
      return {
        mode: "created",
        task: createdTaskTask,
      };
    }

    const timeoutMs = this.polling.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const pollIntervalMs = this.polling.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const pollingDeadline = Date.now() + timeoutMs;
    const validUntilMs = parseValidUntilMs(createdTaskTask.validUntil);
    const deadline =
      validUntilMs !== undefined ? Math.min(pollingDeadline, validUntilMs) : pollingDeadline;
    const taskId = createdTaskTask.taskId;

    while (Date.now() < deadline) {
      const existing = await this.getTask(taskId);

      if (existing?.status === "handled" && existing.handled) {
        return {
          mode: "handled",
          task: createdTaskTask,
          ...(toDiscriminatedApprovalResult(
            normalizedTask.actions as unknown as A,
            existing
          ) as DiscriminatedApprovalResult<A>),
        };
      }

      if (existing?.status === "expired" || (existing && Date.now() >= existing.validUntil)) {
        throw new TaskExpiredError("Task reached validUntil before a human completed it");
      }

      const remainingMs = deadline - Date.now();
      await sleep(Math.min(pollIntervalMs, Math.max(0, remainingMs)));
    }

    if (validUntilMs !== undefined && Date.now() >= validUntilMs) {
      throw new TaskExpiredError("Task reached validUntil before a human completed it");
    }

    throw new TaskTimeoutError(`No human response within ${timeoutMs}ms`);
  }

  /**
   * Get a task by public task id (returned as `task.taskId` from {@link sendToHuman}).
   */
  async getTask(taskId: string): Promise<Task | null> {
    const response = await fetch(`${this.baseUrl}/tasks/${taskId}`, {
      method: "GET",
      headers: {
        "X-Api-Key": this.apiKey,
      },
    });

    if (response.status === 404) {
      return null;
    }

    const data = await parseResponseBody(response);

    if (!response.ok) {
      throw new RobotRockError(
        getErrorMessage(data, "Failed to get task"),
        response.status,
        data
      );
    }

    return data as unknown as Task;
  }

  /**
   * Log a status update against a thread. The update shows in the inbox status
   * bar and thread update log for every task in the thread.
   */
  async sendUpdate({ threadId, message, status }: SendUpdateInput): Promise<ThreadUpdate> {
    if (!threadId) {
      throw new RobotRockError("threadId is required to send an update", 400);
    }

    const validation = threadUpdateBodySchema.safeParse({ message, status });
    if (!validation.success) {
      throw new RobotRockError(
        `Invalid update: ${validation.error.issues[0]?.message}`,
        400,
        validation.error.issues
      );
    }

    const response = await fetch(
      `${this.baseUrl}/threads/${encodeURIComponent(threadId)}/updates`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": this.apiKey,
        },
        body: JSON.stringify(validation.data),
      }
    );

    const data = await parseResponseBody(response);

    if (!response.ok) {
      throw new RobotRockError(
        getErrorMessage(data, "Failed to send update"),
        response.status,
        data
      );
    }

    return (data as unknown as ThreadUpdateResponse).update;
  }

  async cancelTask(taskId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/tasks/${taskId}/cancel`, {
      method: "POST",
      headers: {
        "X-Api-Key": this.apiKey,
      },
    });

    if (!response.ok) {
      const data = await parseResponseBody(response);
      throw new RobotRockError(
        getErrorMessage(data, "Failed to cancel task"),
        response.status,
        data
      );
    }
  }
}

export function createClient(config: RobotRockConfig): RobotRock {
  return new RobotRock(config);
}

export function attachWebhookToActions(
  actions: readonly SendToHumanActionInput[],
  webhook: RobotRockWebhookConfig
): TaskContextInput["actions"] {
  return actions.map((action) => ({
    ...action,
    handlers: webhookToHandlers(webhook),
  }));
}

function webhookToHandlers(
  webhook: RobotRockWebhookConfig
): TaskContextInput["actions"][number]["handlers"] {
  return [
    {
      type: "webhook" as const,
      url: webhook.url,
      headers: webhook.headers ?? {},
    },
  ];
}

function normalizeSendToHumanInput<
  A extends readonly SendToHumanActionInput[] = readonly SendToHumanActionInput[],
>(
  task: SendToHumanWithAppInput<A>,
  clientDefaults: {
    webhook?: RobotRockWebhookConfig;
    app?: string;
    contextVersion: TaskContextFormatVersion;
    agentVersion?: string;
  }
): TaskContextInput {
  const {
    actions,
    idempotencyKey: _idempotencyKey,
    assignTo: _assignTo,
    threadId: _threadId,
    priority: _priority,
    update: _update,
    version: _version,
    validUntil,
    app: taskApp,
    ...rest
  } = task;

  const webhook = clientDefaults.webhook;
  const normalizedActions: TaskContextInput["actions"] = webhook
    ? attachWebhookToActions(actions, webhook)
    : (actions as unknown as TaskContextInput["actions"]);

  const app = taskApp ?? clientDefaults.app;

  return {
    ...rest,
    contextVersion: clientDefaults.contextVersion,
    ...(app ? { app } : {}),
    ...(validUntil !== undefined ? { validUntil: serializeValidUntil(validUntil) } : {}),
    actions: normalizedActions,
  };
}

type ParsedResponseBody = Record<string, unknown> | unknown[] | string | null;

async function parseResponseBody(response: Response): Promise<ParsedResponseBody> {
  const contentType = response.headers.get("content-type") ?? "";
  const bodyText = await response.text();

  if (!bodyText) {
    return null;
  }

  if (contentType.toLowerCase().includes("application/json")) {
    try {
      return JSON.parse(bodyText) as ParsedResponseBody;
    } catch {
      // Fall through and return text body below so error messages stay useful.
    }
  }

  try {
    return JSON.parse(bodyText) as ParsedResponseBody;
  } catch {
    return bodyText;
  }
}

function getErrorMessage(data: ParsedResponseBody, fallback: string): string {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const maybeMessage = (data as Record<string, unknown>).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim()) {
      return maybeMessage;
    }
  }

  if (typeof data === "string" && data.trim()) {
    const compact = data.replace(/\s+/g, " ").trim();
    const snippet = compact.length > 180 ? `${compact.slice(0, 180)}...` : compact;
    return `${fallback}. Server returned non-JSON response: ${snippet}`;
  }

  return fallback;
}
