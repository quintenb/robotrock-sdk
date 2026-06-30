import { z } from "zod";
import {
  isPublicHttpUrl,
  PUBLIC_HTTP_URL_ERROR,
} from "@robotrock/core/utils";
import { validateContextPublicUrls } from "@robotrock/core/schemas";

export interface JSONSchema7 {
  $id?: string;
  $ref?: string;
  $schema?: string;
  $comment?: string;
  type?: JSONSchema7TypeName | JSONSchema7TypeName[];
  enum?: unknown[];
  const?: unknown;
  multipleOf?: number;
  maximum?: number;
  exclusiveMaximum?: number;
  minimum?: number;
  exclusiveMinimum?: number;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  format?: string;
  items?: JSONSchema7 | JSONSchema7[];
  additionalItems?: JSONSchema7 | boolean;
  maxItems?: number;
  minItems?: number;
  uniqueItems?: boolean;
  contains?: JSONSchema7;
  maxProperties?: number;
  minProperties?: number;
  required?: string[];
  properties?: Record<string, JSONSchema7>;
  patternProperties?: Record<string, JSONSchema7>;
  additionalProperties?: JSONSchema7 | boolean;
  dependencies?: Record<string, JSONSchema7 | string[]>;
  propertyNames?: JSONSchema7;
  if?: JSONSchema7;
  then?: JSONSchema7;
  else?: JSONSchema7;
  allOf?: JSONSchema7[];
  anyOf?: JSONSchema7[];
  oneOf?: JSONSchema7[];
  not?: JSONSchema7;
  title?: string;
  description?: string;
  default?: unknown;
  readOnly?: boolean;
  writeOnly?: boolean;
  examples?: unknown[];
}

export type JSONSchema7TypeName =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null";

export type ExtendedJSONSchema7 = JSONSchema7 & {
  enumNames?: string[];
  [key: string]: unknown;
};

export type UiSchema = {
  "ui:widget"?: string;
  "ui:title"?: string;
  "ui:description"?: string;
  "ui:placeholder"?: string;
  "ui:options"?: Record<string, unknown>;
  [key: string]: unknown;
};

const safeUrlSchema = z.string().refine((url) => isPublicHttpUrl(url), {
  message: PUBLIC_HTTP_URL_ERROR,
});

const jsonSchema7Schema = z.custom<ExtendedJSONSchema7>(
  (val) => typeof val === "object" && val !== null,
  { message: "Must be a valid JSON Schema object" }
);

const uiSchemaSchema = z.custom<UiSchema>((val) => typeof val === "object" && val !== null, {
  message: "Must be a valid UiSchema object",
});

const webhookHandlerSchema = z.object({
  type: z.literal("webhook"),
  url: safeUrlSchema,
  headers: z.record(z.string(), z.string()),
});

const triggerHandlerSchema = webhookHandlerSchema.extend({
  type: z.literal("trigger"),
  tokenId: z.string().min(1),
});

const handlerSchema = z.discriminatedUnion("type", [webhookHandlerSchema, triggerHandlerSchema]);

const taskActionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  schema: jsonSchema7Schema.optional(),
  ui: uiSchemaSchema.optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  handlers: z.array(handlerSchema).min(1).optional(),
});

const uiFieldSchemaSchema: z.ZodType<Record<string, unknown>> = z
  .object({
    "ui:widget": z.string().optional(),
    "ui:title": z.string().optional(),
    "ui:description": z.string().optional(),
    "ui:options": z.record(z.string(), z.unknown()).optional(),
    items: z.lazy(() => z.record(z.string(), uiFieldSchemaSchema)).optional(),
  })
  .passthrough();

const contextUiSchema = z.record(z.string(), uiFieldSchemaSchema).optional();

const contextDataSchema = z
  .object({
    data: z.record(z.string(), z.unknown()),
    ui: contextUiSchema,
  })
  .optional();

/** Task context wire format version (always `2` today). */
export const TASK_CONTEXT_FORMAT_VERSION = 2 as const;
export type TaskContextFormatVersion = typeof TASK_CONTEXT_FORMAT_VERSION;

const taskContextObjectBaseSchema = z.object({
  app: z.string().min(1).optional(),
  type: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  validUntil: z.string().optional(),
  context: contextDataSchema,
  contextVersion: z.literal(2).optional(),
  /** @deprecated Use `contextVersion`. Accepted on ingest only. */
  version: z.literal(2).optional(),
  actions: z.array(taskActionSchema).min(1, "At least one action is required"),
});

function normalizeTaskContextVersion<T extends { contextVersion?: 2; version?: 2 }>(
  data: T
): Omit<T, "version" | "contextVersion"> & { contextVersion: 2 } {
  const { version: legacyVersion, contextVersion, ...rest } = data;
  return {
    ...rest,
    contextVersion: contextVersion ?? legacyVersion ?? TASK_CONTEXT_FORMAT_VERSION,
  };
}

const taskContextObjectSchema = taskContextObjectBaseSchema.transform(
  normalizeTaskContextVersion
);

function refineContextPublicUrls<T extends { context?: z.infer<typeof contextDataSchema> }>(
  data: T,
  ctx: z.RefinementCtx
) {
  const error = validateContextPublicUrls(data.context);
  if (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: error,
      path: ["context"],
    });
  }
}

export const taskContextSchema = taskContextObjectSchema.superRefine(
  refineContextPublicUrls
);

/**
 * Assignment targets at task create (not stored in task context JSON).
 * Unknown user emails are auto-provisioned as assignee memberships (count toward seat limits).
 */
export const assignToSchema = z
  .object({
    users: z.array(z.string().email()).optional(),
    groups: z.array(z.string().min(1)).optional(),
  })
  .refine(
    (data) => {
      const groups = data.groups ?? [];
      if (groups.includes("all") && groups.length > 1) {
        return false;
      }
      return true;
    },
    { message: 'Cannot combine "all" with other group slugs' }
  );

/** A short thread-scoped status update message (1-2 sentences). */
export const threadUpdateMessageSchema = z.string().min(1).max(500);

/**
 * Lifecycle status carried by a thread update. Drives the icon and color shown
 * in the inbox status bar. Defaults to `info` when omitted.
 */
export const threadUpdateStatuses = [
  "info",
  "queued",
  "running",
  "waiting",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export const threadUpdateStatusSchema = z.enum(threadUpdateStatuses);

/** The default status applied when an update omits one. */
export const DEFAULT_THREAD_UPDATE_STATUS: ThreadUpdateStatus = "info";

/** Shared shape for a thread update (standalone and at task creation). */
export const threadUpdateInputSchema = z.object({
  message: threadUpdateMessageSchema,
  status: threadUpdateStatusSchema.optional(),
});

/** Thread priority levels for inbox ordering and display. */
export const taskPriorities = ["low", "normal", "high", "urgent"] as const;

export const taskPrioritySchema = z.enum(taskPriorities);

export type TaskPriority = (typeof taskPriorities)[number];

export const DEFAULT_TASK_PRIORITY: TaskPriority = "normal";

export const LOWEST_TASK_PRIORITY: TaskPriority = "low";

export const TASK_PRIORITY_RANK: Record<TaskPriority, number> = {
  low: 1,
  normal: 2,
  high: 3,
  urgent: 4,
};

export const agentTelemetrySchema = z.object({
  version: z.string().min(1),
});

export const createTaskBodySchema = taskContextObjectBaseSchema
  .extend({
    assignTo: assignToSchema.optional(),
    /**
     * Groups related tasks together. When omitted, the server generates one and
     * returns it so the caller can reuse it on later tasks in the same thread.
     */
    threadId: z.string().min(1).optional(),
    /**
     * Optional thread priority. When set, applies to the whole thread and
     * overwrites any previous priority. Omit on later tasks to leave unchanged.
     */
    priority: taskPrioritySchema.optional(),
    /**
     * Optional initial status update logged against the task's thread. Shows in
     * the inbox status bar and the thread update log.
     */
    update: threadUpdateInputSchema.optional(),
    agent: agentTelemetrySchema.optional(),
  })
  .transform(normalizeTaskContextVersion)
  .superRefine(refineContextPublicUrls);

/** POST /v1/threads/:threadId/updates body: a standalone thread update. */
export const threadUpdateBodySchema = threadUpdateInputSchema;

/** Where a thread update originated. */
export type ThreadUpdateSource = "api" | "task_create" | "dashboard";

/** Lifecycle status carried by a thread update. */
export type ThreadUpdateStatus = (typeof threadUpdateStatuses)[number];

/** A logged thread update as returned by the API. */
export interface ThreadUpdate {
  id: string;
  threadId: string;
  message: string;
  status: ThreadUpdateStatus;
  source: ThreadUpdateSource;
  createdAt: number;
}

export type AssignToInput = z.infer<typeof assignToSchema>;
export type CreateTaskBodyInput = z.input<typeof createTaskBodySchema>;
export type CreateTaskBody = z.output<typeof createTaskBodySchema>;
export type ThreadUpdateBodyInput = z.input<typeof threadUpdateBodySchema>;
export type ThreadUpdateBody = z.output<typeof threadUpdateBodySchema>;
export type ThreadUpdateInput = z.input<typeof threadUpdateInputSchema>;
export type TaskContextInput = z.input<typeof taskContextSchema>;
export type TaskContextOutput = z.output<typeof taskContextSchema>;
export type TaskContext = TaskContextOutput;
export type TaskAction = z.infer<typeof taskActionSchema>;
export type WebhookHandler = z.infer<typeof webhookHandlerSchema>;
export type TriggerHandler = z.infer<typeof triggerHandlerSchema>;
export type Handler = z.infer<typeof handlerSchema>;
export type AgentTelemetry = z.infer<typeof agentTelemetrySchema>;
export type AgentTelemetryInput = z.input<typeof agentTelemetrySchema>;

type InferObjectProperties<
  Props,
  Req extends PropertyKey,
> = Props extends Record<string, unknown>
  ? ({
      [K in keyof Props as K extends Req ? K : never]-?: InferJsonSchema7<Props[K]>;
    } & {
      [K in keyof Props as K extends Req ? never : K]?: InferJsonSchema7<Props[K]>;
    } extends infer O
      ? { [K in keyof O]: O[K] }
      : never)
  : Record<string, unknown>;

type RequiredKeys<S> =
  S extends { readonly required: readonly string[] } ? S["required"][number] : never;

export type InferJsonSchema7<S> = [S] extends [undefined]
  ? Record<string, never>
  : S extends { readonly const: infer C }
    ? C
    : S extends {
          readonly enum: readonly (infer E)[];
        }
      ? E
      : S extends {
            readonly type: "object";
            readonly properties?: infer Props;
          }
        ? InferObjectProperties<Props, RequiredKeys<S>>
        : S extends {
              readonly type: "object";
              readonly properties?: undefined;
            }
          ? Record<string, unknown>
          : S extends {
                readonly type: "array";
                readonly items?: infer Items;
              }
            ? Items extends readonly unknown[]
              ? InferJsonSchema7<Items[number]>[]
              : Items extends object
                ? InferJsonSchema7<Items>[]
                : unknown[]
            : S extends { readonly type: "string" }
              ? string
              : S extends { readonly type: "number" } | { readonly type: "integer" }
                ? number
                : S extends { readonly type: "boolean" }
                  ? boolean
                  : unknown;

export type TaskStatus = "pending" | "open" | "handled" | "expired";

export interface TaskResponse {
  success: boolean;
  task: {
    taskId: string;
    threadId: string;
    status: "pending" | "open";
    context: TaskContext;
    validUntil: string;
    submittedAt: string;
  };
  message: string;
}

export interface ThreadUpdateResponse {
  success: boolean;
  update: ThreadUpdate;
  message: string;
}

export interface Task {
  id: string;
  threadId?: string;
  createdAt: Date;
  status: TaskStatus;
  context: TaskContext;
  validUntil: number;
  handledAt?: number;
  handled?: {
    action: {
      id: string;
      data: unknown;
    };
    handledBy?: string;
    userId?: string;
    token?: string;
  };
}

export type InferActionData<T extends { schema?: unknown }> = [
  Exclude<T["schema"], undefined>,
] extends [
  never,
]
  ? Record<string, never>
  : Exclude<T["schema"], undefined> extends infer S
    ? InferJsonSchema7<S>
    : Record<string, never>;

export type TupleElementIndices<T extends readonly unknown[]> = T extends readonly [
  unknown,
  ...unknown[],
]
  ? Exclude<keyof T, keyof unknown[]>
  : number;

export interface TaskResult<T = Record<string, unknown>> {
  actionId: string;
  data: T;
  handledBy?: string;
  handledAt: Date;
}

export interface ApprovalResult<T = Record<string, unknown>> extends TaskResult<T> {
  taskId: string;
}

export type DiscriminatedApprovalResult<
  TActions extends readonly { id: string; schema?: unknown }[],
> = {
  [I in TupleElementIndices<TActions>]: TActions[I] extends { id: string; schema?: unknown }
    ? Omit<ApprovalResult<InferActionData<TActions[I]>>, "actionId" | "data"> & {
        actionId: TActions[I]["id"];
        data: InferActionData<TActions[I]>;
      }
    : never
}[TupleElementIndices<TActions>];
