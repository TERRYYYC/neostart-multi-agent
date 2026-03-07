# Source Map

Every file in `src/`, what it does, key exports, and important dependencies.

Last updated: Phase 1 complete, Phase 2 ready.

---

## src/shared/ — Domain types & utilities (shared by server and client)

### src/shared/types.ts

**Purpose**: Single source of truth for all domain types. Mirrors architecture §5–§8.

**Key exports**:

- Scalar unions: `Visibility`, `ThreadStatus`, `InvocationState`, `SessionStatus`, `MessageRole`, `AuthorType`, `EventType`
- Interfaces: `Thread`, `Message`, `AgentProfile`, `AgentSession`, `AgentInvocation`, `EventLog`, `WorkspaceBinding`

**Dependencies**: none

**Notes**: `Visibility` is restricted to `'public' | 'private' | 'system-summary'`. Do not add new values without updating the architecture doc. `InvocationState` machine: `queued → running → completed/failed`, `queued → cancelled`.

### src/shared/id.ts

**Purpose**: ID generation utility.

**Key exports**: `generateId(length?: number): string` — wraps nanoid, default length 21.

**Dependencies**: `nanoid`

### src/shared/index.ts

**Purpose**: Barrel re-export of types.ts and id.ts.

---

## src/server/persistence/ — JSON file-based storage

### src/server/persistence/json-file-store.ts

**Purpose**: Generic persistence layer. Abstracts file I/O behind a `Store<T>` interface.

**Key exports**:

- `Store<T>` interface: `getAll()`, `getById()`, `findBy()`, `create()`, `update()`, `delete()`
- `JsonFileStore<T>` class: in-memory cache, atomic write (tmp → rename), auto-creates empty file

**Dependencies**: Node.js `fs/promises`, `path`

**Notes**: `create()` throws on duplicate ID. `update()` throws on not-found. `id` field is immutable across updates. Designed for easy swap to SQLite/Postgres later.

### src/server/persistence/index.ts

**Purpose**: Instantiates 7 concrete stores, one per entity type.

**Key exports**:

- `threadStore`, `messageStore`, `agentProfileStore`, `agentSessionStore`, `invocationStore`, `eventLogStore`, `workspaceBindingStore`
- re-exports `Store` type

**Configuration**: Data directory defaults to `./data` (relative to cwd), overridable via `DATA_DIR` env var.

**Data files**: `threads.json`, `messages.json`, `agent-profiles.json`, `agent-sessions.json`, `invocations.json`, `event-logs.json`, `workspace-bindings.json`

### src/server/persistence/seed.ts

**Purpose**: Seeds 3 default cat profiles on first bootstrap.

**Key exports**: `seedAgentProfiles(): Promise<void>`, `DEFAULT_CATS: AgentProfile[]`

**Cats**:

- Maine (cat-maine) — claude-sonnet-4-6, methodical
- Siamese (cat-siamese) — claude-haiku-4-5-20251001, concise
- Persian (cat-persian) — claude-opus-4-6, meticulous

**Notes**: Idempotent — skips profiles that already exist by id.

---

## src/server/registry/ — Agent mention resolution

### src/server/registry/agent-registry.ts

**Purpose**: Loads agent profiles from persistence, resolves @mentions to profiles.

**Key exports**:

- `AgentRegistry` class: `load()`, `resolve(mention)`, `availableNames()`, `allProfiles()`
- `ResolutionResult = { ok: true; profile } | { ok: false; reason }`
- `parseMentions(content: string): string[]` — regex `/@(\w+)/g`, deduplicates, returns lowercase
- `agentRegistry` — singleton instance

**Dependencies**: `agentProfileStore`

**Notes**: Resolution is case-insensitive. Only enabled profiles are loaded. If mention doesn't match any cat, returns `{ ok: false, reason: '...' }`.

---

## src/server/runtime/ — Invocation lifecycle engine

### src/server/runtime/event-emitter.ts

**Purpose**: Creates and persists `EventLog` records, then publishes to the event bus for SSE streaming.

**Key exports**: `emitEvent(params): Promise<EventLog>`

**Dependencies**: `eventLogStore`, `eventBus`

**Notes**: Default visibility is `'private'` per §7.1 Step 5. Every emitted event gets both persisted to disk AND published to the in-process event bus.

### src/server/runtime/session-manager.ts

**Purpose**: Finds or creates an `AgentSession` for a given thread + agent pair.

**Key exports**: `findOrCreateSession(threadId, agentId, invocationId): Promise<AgentSession>`

**Dependencies**: `agentSessionStore`, `emitEvent`

**Notes**: v1 rule — one active session per cat per thread. Emits `session.selected` (reuse) or `session.created` (new).

### src/server/runtime/runner.ts

**Purpose**: Defines the `Runner` interface and provides `StubRunner` for Phase 1.

**Key exports**:

- `Runner` interface: `run(params: RunParams): Promise<RunnerResult>`
- `RunParams`: invocationId, threadId, profile, taskText, `onTextDelta` callback
- `RunnerResult`: `{ ok, text?, errorCode?, errorMessage? }`
- `StubRunner` class: deterministic reply, simulates 3 streaming chunks
- `stubRunner` — default instance

**Phase 2 action**: Create `AnthropicRunner implements Runner` in a new file. The orchestrator accepts a runner via `ExecuteParams.runner`, defaulting to `stubRunner`. Change the default to the new real runner.

### src/server/runtime/orchestrator.ts

**Purpose**: Core 7-step invocation lifecycle coordinator (§7.1 Steps 2–7).

**Key exports**:

- `executeInvocation(params: ExecuteParams): Promise<InvocationResult>` — main entry point
- `ExecuteParams`: threadId, sourceMessageId, mention, taskText, optional runner
- `InvocationResult = { ok: true; invocation; replyMessage } | { ok: false; reason }`
- `extractTaskText(content, mention): string` — strips @mention from message

**Lifecycle steps**: resolve agent → create invocation (queued) → find/create session → run (running + emit text.delta events) → assemble public reply Message → close invocation (completed/failed)

**Dependencies**: `agentRegistry`, `invocationStore`, `messageStore`, `emitEvent`, `findOrCreateSession`, `stubRunner`

**Architecture rule**: AgentInvocation record MUST exist before any agent output appears.

### src/server/runtime/index.ts

**Purpose**: Barrel re-export of all runtime modules.

---

## src/server/streaming/ — SSE event delivery

### src/server/streaming/event-bus.ts

**Purpose**: In-process pub/sub bridge between runtime events and SSE connections.

**Key exports**:

- `RuntimeEventBus` class: `publish(event)`, `subscribe(threadId, listener): () => void`
- `eventBus` — singleton instance

**Pattern**: Channel-based — `thread:${threadId}`. Subscribe returns an unsubscribe function.

**Dependencies**: Node.js `EventEmitter`

### src/server/streaming/sse-handler.ts

**Purpose**: Express request handler for SSE streaming with visibility filtering (§6.3).

**Key exports**: `sseHandler(req, res): void`

**Internal function**: `toSsePayload(event: EventLog): SsePayload | null` — transforms internal EventLog to safe SSE payload. Returns null for events that should be dropped.

**Forwarded events**: `invocation.created/started/completed/failed`, `text.delta` (chunk only), `session.created/selected`

**Hard rule**: NEVER pushes raw private log payload into the public stream. Only safe, minimal data fields are included.

**Dependencies**: `eventBus`

### src/server/streaming/index.ts

**Purpose**: Barrel re-export.

---

## src/server/api/ — REST endpoints

### src/server/api/threads.ts

**Purpose**: Thread CRUD routes.

**Routes**:

- `POST /api/threads` — create a new thread (accepts `{ title }`)
- `GET /api/threads` — list all threads
- `GET /api/threads/:id` — get one thread by id

**Dependencies**: `threadStore`

### src/server/api/messages.ts

**Purpose**: Message routes + automatic invocation trigger.

**Routes**:

- `GET /api/threads/:threadId/messages` — list public + system-summary messages (never private)
- `POST /api/threads/:threadId/messages` — submit user message; if @mentions found, triggers `executeInvocation()` for the first mention (v1: single-agent only)

**Dependencies**: `threadStore`, `messageStore`, `parseMentions`, `executeInvocation`, `extractTaskText`

**Notes**: Returns `{ userMessage, invocation }` on POST. Invocation is null if no mentions found.

### src/server/api/runtime.ts

**Purpose**: Runtime status and SSE streaming endpoints.

**Routes**:

- `GET /api/threads/:threadId/runtime` — most recent invocation snapshot
- `GET /api/threads/:threadId/stream` — SSE endpoint (delegates to sseHandler)

**Dependencies**: `invocationStore`, `sseHandler`

### src/server/api/index.ts

**Purpose**: Mounts all route groups under `/api`.

**Mounts**: `threadRouter` at `/threads`, `messageRouter` at `/threads/:threadId/messages`, `runtimeRouter` at `/threads/:threadId`

---

## src/server/ — Server entry & config

### src/server/app.ts

**Purpose**: Express application setup.

**Key exports**: `app` — configured Express instance

**Middleware**: CORS, JSON body parser

**Mount points**: `/api` → apiRouter, `/` → static files from `src/client/`, `/health` → health check

**Dependencies**: `express`, `cors`, `apiRouter`

### src/server/main.ts

**Purpose**: Server entry point. Bootstrap sequence.

**Bootstrap order**: `seedAgentProfiles()` → `agentRegistry.load()` → `app.listen(PORT)`

**Configuration**: `PORT` env var, default 3001.

---

## src/client/ — Frontend

### src/client/index.html

**Purpose**: Single-file React SPA (CDN React 18, no build step).

**Components**: App, ThreadList, MessageStream, MessageInput, RuntimePanel

**Layout**: Three-column (§4.1) — left: thread list, center: messages + input, right: runtime status

**SSE integration**: Opens EventSource to `/api/threads/:id/stream`. Handles `text.delta` → streaming buffer, `invocation.completed` → refresh messages, `invocation.started/failed` → update runtime panel.

**Styling**: Minimal inline CSS, no framework.

**Phase 2 note**: May need adjustments for real streaming latency (StubRunner is near-instant, real LLM will be slower). Consider adding a loading indicator.

---

## Dependency Graph (simplified)

```
main.ts
  ├── app.ts
  │     ├── api/index.ts
  │     │     ├── api/threads.ts    → persistence
  │     │     ├── api/messages.ts   → persistence, registry, runtime/orchestrator
  │     │     └── api/runtime.ts    → persistence, streaming/sse-handler
  │     └── static: client/index.html
  ├── persistence/seed.ts           → persistence/index.ts
  └── registry/agent-registry.ts    → persistence/index.ts

runtime/orchestrator.ts
  ├── registry/agent-registry.ts
  ├── persistence/index.ts
  ├── runtime/event-emitter.ts      → persistence, streaming/event-bus
  ├── runtime/session-manager.ts    → persistence, runtime/event-emitter
  └── runtime/runner.ts             (StubRunner, Phase 2: AnthropicRunner)

streaming/sse-handler.ts
  └── streaming/event-bus.ts        (receives events from runtime/event-emitter)
```
