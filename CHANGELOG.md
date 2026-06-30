# @robotrock/sdk

## 0.9.0

### Major Changes

- **Focus on human feedback:** removed send-time OTel snapshots (`agent.otel`, `agent.info`, `toolCalls`, `cost`) from the wire schema and feedback analysis.
- Removed `robotrock/otel` export, `agentTelemetryFromOtel()`, and `toolCallsFromOtelSpans()`.
- **`createClient({ version })` is now agent release** (`string`), not task context format (`2`). Use `advanced.contextVersion` for the wire format (default `2`).
- **`sendToHuman({ version? })`** maps to wire `agent.version` (replaces `sendToHuman({ agent })` on the SDK surface).
- Wire/API context format field renamed **`version` → `contextVersion`** (legacy `version: 2` still accepted on ingest).

### Minor Changes

- Kept handle-time OTel on Trigger.dev / Vercel Workflow (`recordOtel`, `robotrock.wait_for_human` span, `robotrock.task_handled` event).
- MCP `send_to_human` accepts top-level `version` (agent release).

## 0.8.5

### Minor Changes

- Export platform terminal action ids and helpers: `PLATFORM_MARK_DONE_ACTION_ID`, `PLATFORM_REJECT_REQUEST_ACTION_ID`, `isPlatformTerminalAction`, `parseHandledOutcome`, `assertNotPlatformRejectRequest`, `PlatformRejectRequestError`, and related types.
- Document that agents must stop when a handled task uses `robotrock:mark-done` or `robotrock:reject-request`.

## 0.8.5

### Minor Changes

- Trigger.dev and Vercel Workflow: optional OTel recording when humans handle tasks (`recordOtel` / `ROBOTROCK_OTEL_RECORD_HANDLED`).
- Adds `robotrock.wait_for_human` child span plus `robotrock.task_handled` event and attributes (`robotrock.action.id`, `robotrock.human_wait_ms`, etc.).
- Auto-fills `agent` telemetry at platform task create when OTel recording is enabled.
- New exports: `captureRobotRockOtelHandle`, `recordRobotRockHandledToOtel`, `beginRobotRockHumanWaitOtel`, `finishRobotRockHumanWaitOtel`.

## 0.8.4

### Minor Changes

- Add `agent.otel` structured OpenTelemetry snapshot on `sendToHuman` (traceId, rootDurationMs, span summaries).
- Add `agentTelemetryFromOtel()` and `toolCallsFromOtelSpans()` helpers (`robotrock` and `robotrock/otel` exports).
- Optional peer dependency `@opentelemetry/api`.

## 0.8.3

### Patch Changes

- Bundle `@robotrock/core` into the published package so npm install no longer requires the private workspace package.

## 0.8.2

### Patch Changes

- Add `agent.toolCalls` on `sendToHuman` — per-tool invocation counts keyed by tool name (e.g. `{ readFile: 3, grep: 2 }`). `toolCallCount` is derived from the sum when omitted.

## 0.8.1

### Patch Changes

- No API changes.

## 0.8.0

### Minor Changes

- Add optional `agent` telemetry on `sendToHuman` (version, cost, tool calls) via `agentTelemetrySchema` and `AgentTelemetry` types.

## 0.7.0

### Minor Changes

- Add Vercel AI SDK 7 compatibility: explicit `Tool` return types on AI tool factories, export `RobotRockAiTools`, and peer support for `ai@^7`.

## 0.2.0

### Minor Changes

- 3feffff: Explicit client-only SDK API
  - Remove `configureRobotRock`, standalone `createTask`, and module-level default client
  - Rename client `createTask` → `sendToHuman` and `CreateTask*` types → `SendToHuman*`
  - Add `app` to `createClient` / `RobotRockConfig` (client-level inbox routing only)
  - Document shared `lib/robotrock.ts` pattern with `robotrock.sendToHuman()`
