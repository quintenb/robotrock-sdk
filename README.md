# robotrock

Human-in-the-loop approval workflows for AI agents.

## Installation

```bash
npm install robotrock
# or
bun add robotrock
```

## Agent skill (Cursor, Claude Code, etc.)

Install the RobotRock agent skill from [skills.sh](https://skills.sh/quintenb/robotrock-skills/robotrock) to teach coding agents how to integrate the SDK:

```bash
npx skills add quintenb/robotrock-skills --skill robotrock
```

For Trigger.dev, also install `@trigger.dev/sdk`.

## Quick Start

Create a shared client in its own module (for example `lib/robotrock.ts`), then import it wherever you create tasks.

```typescript
// lib/robotrock.ts
import { createClient } from "robotrock";

export const robotrock = createClient({
  app: "budgeting-service",
  webhook: {
    url: "https://your-app.com/api/robotrock/webhook",
    headers: {
      // place your headers here
    },
  },
});
```

```typescript
import { robotrock } from "./lib/robotrock";

const response = await robotrock.sendToHuman({
  type: "budget-approval",
  name: "Q1 Budget Approval",
  description: "Please review and approve the Q1 budget",
  actions: [
    { id: "approve", title: "Approve" },
    { id: "reject", title: "Reject" },
  ],
  idempotencyKey: "budget-q1-approval-v1",
});

console.log("Task created:", response.task.taskId);
```

Set `ROBOTROCK_API_KEY` in your environment (create a named key in the RobotRock dashboard under Settings → API Keys). The client reads it when you omit `apiKey` on `createClient`.

## Inbox routing

Set `app` on `createClient` to control dashboard inbox grouping for every task from that client.

When `app` is omitted on the client, the API uses your API key **name** as the inbox bucket.

## Client webhook

Configure a single webhook on the client. It is applied to every action when you call `sendToHuman`:

```typescript
export const robotrock = createClient({
  webhook: {
    url: "https://your-app.com/api/robotrock/webhook",
    headers: {
      // place your headers here
    }, // optional, defaults to {}
  },
});
```

## Automatic fallback polling

When the client has no `webhook`, `sendToHuman` polls until a human handles the task or throws `TaskExpiredError` / `TaskTimeoutError`. Configure `polling` on `createClient` (not on `sendToHuman`). Polling stops at the earlier of `polling.timeoutMs` and the task's `validUntil`. You cannot set both `webhook` and `polling` on the same client.

```typescript
import { createClient, TaskExpiredError, TaskTimeoutError } from "robotrock";

const robotrock = createClient({
  app: "my-service",
  polling: {
    intervalMs: 2_000,
    timeoutMs: 5 * 60 * 1_000,
  },
});

const actions = [
  {
    id: "approve",
    title: "Approve",
    schema: {
      type: "object",
      required: ["ticket"],
      properties: {
        ticket: { type: "string" },
      },
    },
  },
  {
    id: "reject",
    title: "Reject",
    schema: {
      type: "object",
      required: ["reason"],
      properties: {
        reason: { type: "string" },
      },
    },
  },
] as const;

const result = await robotrock.sendToHuman({
  type: "approval",
  name: "Review change",
  actions,
});

if (result.mode === "created") {
  console.log("Task created:", result.task.taskId);
} else if (result.actionId === "approve") {
  console.log("Approved with ticket", result.data.ticket);
} else {
  console.log("Rejected because", result.data.reason);
}
```

## Thread updates

Send short status updates (1-2 sentences) to a thread. The newest update shows in a status bar at the top of the inbox task detail, with an icon and color from an optional `status`; every update is logged in an expandable history. Updates are scoped to a `threadId`.

```typescript
// Standalone update against an existing thread
const update = await robotrock.sendUpdate({
  threadId, // from response.task.threadId
  message: "Deployment started, running smoke tests.",
  status: "running", // optional, defaults to "info"
});

// Or log an initial update when creating the task
await robotrock.sendToHuman({
  type: "deploy-approval",
  name: "Approve production rollout",
  threadId: `deploy_${deploymentId}`,
  update: { message: "Build finished, awaiting approval.", status: "waiting" },
  actions: [{ id: "approve", title: "Approve" }],
});
```

`status` is optional and one of: `info` | `queued` | `running` | `waiting` | `succeeded` | `failed` | `cancelled`. The `update` field is top-level (like `threadId` and `assignTo`), not inside `context`.

Updates are fire-and-forget, so the integration packages expose them too:

```typescript
// Vercel Workflow: durable step, returns immediately (no suspend)
import { sendUpdateInWorkflow } from "robotrock/workflow";
await sendUpdateInWorkflow({ threadId, message: "Build started.", status: "running" });

// Vercel AI SDK: let an agent report progress on its thread
import { createSendUpdateTool } from "robotrock/ai";
const sendUpdate = createSendUpdateTool(robotrock, { threadId });

// Trigger.dev: no wrapper needed — call the SDK directly inside a task
await robotrock.sendUpdate({ threadId, message: "Job running.", status: "running" });
```

## Other client methods

```typescript
await robotrock.getTask("task_...");
await robotrock.cancelTask("task_...");
```

## Webhook verification helper

```typescript
import {
  verifyRobotRockWebhook,
  RobotRockWebhookError,
  isPlatformTerminalAction,
  isPlatformRejectRequestAction,
  parsePlatformRejectRequestData,
  type RobotRockWebhookPayload,
} from "robotrock";

export async function POST(request: Request) {
  try {
    const payload: RobotRockWebhookPayload = await verifyRobotRockWebhook(request);
    console.log(payload.action.id, payload.headers["x-request-id"]);

    // Always stop the agent for inbox platform actions (not your task's approve/reject ids)
    if (isPlatformRejectRequestAction(payload.action.id)) {
      const { feedback } = parsePlatformRejectRequestData(payload.action.data) ?? {
        feedback: "",
      };
      // log and abort — do not continue the workflow
      return Response.json({ ok: true, stopped: true, feedback });
    }
    if (isPlatformTerminalAction(payload.action.id)) {
      return Response.json({ ok: true, stopped: true });
    }

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof RobotRockWebhookError) {
      return Response.json({ error: error.code }, { status: 401 });
    }
    return Response.json({ error: "Unknown error" }, { status: 500 });
  }
}
```

## Platform terminal actions

Reviewers can close a task from the inbox **without** choosing one of your defined actions. These reserved `action.id` values arrive on webhooks, polling, and `getTask()` — **always stop your agent** when you see them:

| Constant | Action ID | Meaning |
|----------|-----------|---------|
| `PLATFORM_MARK_DONE_ACTION_ID` | `robotrock:mark-done` | Closed manually; `data` is `{}` |
| `PLATFORM_REJECT_REQUEST_ACTION_ID` | `robotrock:reject-request` | Bad request; `data.feedback` is required |

```typescript
import {
  isPlatformTerminalAction,
  parseHandledOutcome,
  assertNotPlatformRejectRequest,
  shouldStopAgentForHandledAction,
} from "robotrock";

const result = await robotrock.sendToHuman({ ... });

if (result.mode === "handled") {
  assertNotPlatformRejectRequest(result.actionId, result.data); // throws PlatformRejectRequestError

  if (shouldStopAgentForHandledAction(result.actionId)) {
    return; // mark-done or reject-request — do not continue
  }

  const outcome = parseHandledOutcome({
    actionId: result.actionId,
    data: result.data,
    handledBy: result.handledBy,
    handledAt: result.handledAt,
  });
  if (outcome.source === "platform") {
    return;
  }
}
```

See [Platform actions](https://docs.robotrock.io/webhooks#platform-action-ids) in the docs.

## Trigger.dev

Install `@trigger.dev/sdk`, re-export SDK tasks from your `trigger/` directory, and call them with `triggerAndWait()`:

```typescript
// trigger/robotrock.ts
export { sendToHumanTask, approveByHumanTask } from "robotrock/trigger";
```

```typescript
import { task } from "@trigger.dev/sdk";
import { approveByHumanTask } from "./robotrock";

export const gate = task({
  id: "gate",
  run: async () => {
    const waitResult = await approveByHumanTask.triggerAndWait({
      type: "release-gate",
      name: "Ship this release?",
    });

    if (!waitResult.ok) {
      throw waitResult.error;
    }

    return waitResult.output.actionId === "approve";
  },
});
```

Set `ROBOTROCK_API_KEY` (and optionally `ROBOTROCK_APP`) in your Trigger worker environment.

## Vercel AI SDK

Install `ai` and use the optional `robotrock/ai` entry:

```bash
npm install ai
```

```typescript
import { generateText, stepCountIs } from "ai";
import { createClient } from "robotrock";
import { approveByHumanTool, createSendToHumanTool } from "robotrock/ai";

const robotrock = createClient({
  app: "my-agent",
  polling: { timeoutMs: 30 * 60_000 },
});

const result = await generateText({
  model: "anthropic/claude-sonnet-4",
  tools: {
    approveByHuman: approveByHumanTool(robotrock),
  },
  stopWhen: stepCountIs(10),
  prompt: "Plan a release; get human approval before finalizing.",
});
```

For AI SDK tool execution approval (approve `deleteFile` before it runs), use `createRobotRockToolApproval`, `resolveToolApprovalsViaRobotRock`, and `runWithRobotRockApprovals` from `robotrock/ai`. See the [Vercel AI integration docs](https://docs.robotrock.io/integrations/vercel-ai).

Run long polls inside Trigger.dev or a worker — not short serverless HTTP handlers.

## Exports

| Import | Description |
|--------|-------------|
| `robotrock` | `createClient`, `RobotRock`, env helpers, types, schemas |
| `robotrock/trigger` | `sendToHumanTask`, `approveByHumanTask` for Trigger.dev |
| `robotrock/workflow` | `sendToHumanInWorkflow`, `approveByHumanInWorkflow`, `sendUpdateInWorkflow` for Vercel Workflow |
| `robotrock/ai` | Vercel AI SDK tools and `toolApproval` bridge (peer: `ai`) |
| `robotrock/ai/trigger` | Same API, documented for `mode: "trigger"` in Trigger.dev workers |
| `robotrock/ai/workflow` | Same API, documented for `mode: "workflow"` in Vercel Workflow |

## License

MIT
