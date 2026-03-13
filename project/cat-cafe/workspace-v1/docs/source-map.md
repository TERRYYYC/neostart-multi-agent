# Source Map

Every file in `src/`, what it does, key exports, and important dependencies.

Last updated: Phase 4 — Long-term Memory complete (Memory entity, CRUD API, relevance scoring, prompt injection, auto-extraction, MemoryPanel UI, SSE notifications).

---

## src/shared/ — Domain types & utilities (shared by server and client)

### src/shared/types.ts

**Purpose**: Single source of truth for all domain types. Mirrors architecture §5–§8.

**Key exports**:

- Scalar unions: `Visibility`, `ThreadStatus`, `InvocationState`, `SessionStatus`, `MessageRole`, `AuthorType`, `EventType`, `MemoryScope`, `MemoryCategory`, `MemorySource`
- Interfaces: `Thread`, `Message`, `AgentProfile`, `AgentSession`, `AgentInvocation`, `EventLog`, `WorkspaceBinding`, `Memory`

**Dependencies**: none

**Notes**: `Visibility` is restricted to `'public' | 'private' | 'system-summary'`. Do not add new values without updating the architecture doc. `InvocationState` machine: `queued → running → completed/failed`, `queued → cancelled`.

**Phase 3 additions**: `AgentProfile` gained optional `family?: string` (grouping key) and `displayName?: string` (variant label). `Thread` gained optional `selectedAgentIds?: string[]` (cats chosen at thread creation).

**Phase 4 additions**: `MemoryScope` (`'global' | 'thread' | 'agent'`), `MemoryCategory` (6 values), `MemorySource` (`'explicit' | 'auto-extracted'`), `Memory` interface (id, scope, threadId?, agentId?, category, key, value, source, confidence, visibility, tags, timestamps, accessCount). `EventType` gained `'memory.extracted'`.

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

**Purpose**: Instantiates 8 concrete stores, one per entity type.

**Key exports**:

- `threadStore`, `messageStore`, `agentProfileStore`, `agentSessionStore`, `invocationStore`, `eventLogStore`, `workspaceBindingStore`, `memoryStore`
- re-exports `Store` type

**Configuration**: Data directory defaults to `./data` (relative to cwd), overridable via `DATA_DIR` env var.

**Data files**: `threads.json`, `messages.json`, `agent-profiles.json`, `agent-sessions.json`, `invocations.json`, `event-logs.json`, `workspace-bindings.json`, `memories.json`

### src/server/persistence/seed.ts

**Purpose**: Seeds default cat profiles on first bootstrap; patches existing profiles missing new fields.

**Key exports**: `seedAgentProfiles(): Promise<void>`, `seedMemories(): Promise<void>`, `DEFAULT_CATS: AgentProfile[]`, `SEED_MEMORIES: Memory[]`

**Cats** (6 profiles, 5 families, 3 providers):

- Maine Sonnet (cat-maine) — anthropic/claude-sonnet-4-6, family: "maine", displayName: "Sonnet"
- Maine Opus (cat-maine-opus) — anthropic/claude-opus-4-6, family: "maine", displayName: "Opus"
- Siamese Haiku (cat-siamese) — anthropic/claude-haiku-4-5-20251001, family: "siamese", displayName: "Haiku"
- Persian Opus (cat-persian) — anthropic/claude-opus-4-6, family: "persian", displayName: "Opus"
- Ragdoll GPT-4o (cat-ragdoll) — openai/gpt-4o, family: "ragdoll", displayName: "GPT-4o"
- Birman Flash (cat-birman) — google/gemini-2.0-flash, family: "birman", displayName: "Flash"

**Notes**: Idempotent — skips profiles that already exist by id. Phase 3 Upgrade: also patches existing profiles missing `family` or `displayName` fields (seed migration). Phase 3 Multi-Provider: added OpenAI and Google cats. Phase 4: added `seedMemories()` which seeds 3 demo memories (user_name, response_style, project_language).

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

**Purpose**: Defines the `Runner` interface and provides `StubRunner` for testing.

**Key exports**:

- `Runner` interface: `run(params: RunParams): Promise<RunnerResult>`
- `RunParams`: invocationId, threadId, profile, taskText, `onTextDelta` callback
- `RunnerResult`: `{ ok, text?, errorCode?, errorMessage? }`
- `StubRunner` class: deterministic reply, simulates 3 streaming chunks
- `stubRunner` — default instance (used when `CLI_RUNNER=stub`)

### src/server/runtime/cli-runner.ts

**Purpose**: Real LLM execution via CLI subprocess. Adapted from fma project's cli-runner.ts.

**Key exports**:

- `CliRunner` class: implements `Runner`, spawns `claude` CLI as child process
- `cliRunner` — default instance (used by orchestrator in Phase 2+)
- `getActiveChildrenCount()` — monitoring/testing helper

**Features**:

- Spawns `claude -p --output-format stream-json --model <model> --system-prompt <persona>`
- Loads conversation history from `messageStore` (dual truncation: turn limit + per-message char limit)
- Heartbeat timeout kills hung CLI processes (default 120s, configurable via `CLI_HEARTBEAT_TIMEOUT`)
- stderr sliding window (2000 chars max, prevents memory leak)
- SIGTERM/SIGKILL cleanup prevents orphan processes on server shutdown
- Removes Claude nesting detection env vars to prevent CLI conflicts
- Phase 4: loads relevant memories via `findRelevantMemories()` and injects into prompt between predecessor summary and conversation history

**Dependencies**: `node:child_process`, `runner.ts` (interface), `messageStore`, `memory-loader.ts` (Phase 4)

**Env vars**: `CLAUDE_PATH`, `CLI_HEARTBEAT_TIMEOUT`, `MAX_HISTORY_MESSAGES`, `MAX_MESSAGE_CHARS`, `MAX_MEMORIES_IN_CONTEXT` (Phase 4), `MAX_MEMORY_CHARS` (Phase 4)

### src/server/runtime/openai-runner.ts (Phase 3 Multi-Provider)

**Purpose**: LLM execution via Codex CLI subprocess. Same architecture as cli-runner.ts.

**Key exports**:

- `OpenAiRunner` class: implements `Runner`, spawns `codex exec --json` as child process
- `openaiRunner` — singleton instance

**Features**:

- Spawns `codex exec --json "<prompt>"` for non-interactive NDJSON output
- NDJSON event parsing: `item.completed` + `agent_message` → extract `item.text`
- Persona prepended to prompt as `[System Instructions]`
- Dual truncation on conversation history (same as cli-runner)
- Heartbeat timeout, stderr sliding window, SIGTERM/SIGKILL cleanup
- Clean environment: strips Claude nesting detection env vars before spawn
- `--model` only from `CODEX_MODEL` env var (NOT from profile.model)
- Clear spawn error if `codex` CLI is not installed

**Dependencies**: `node:child_process`, `runner.ts` (interface), `messageStore`

**Env vars**: `CODEX_PATH`, `CODEX_MODEL`, `CLI_HEARTBEAT_TIMEOUT`, `MAX_HISTORY_MESSAGES`, `MAX_MESSAGE_CHARS`

### src/server/runtime/gemini-runner.ts (Phase 3 Multi-Provider)

**Purpose**: LLM execution via Gemini CLI subprocess. Same architecture as cli-runner.ts.

**Key exports**:

- `GeminiRunner` class: implements `Runner`, spawns `gemini -p --output-format stream-json` as child process
- `geminiRunner` — singleton instance
- `isHarmlessGeminiTelemetry(stderr)` — filters non-fatal ECONNRESET telemetry noise

**Features**:

- Spawns `gemini -p <prompt> --output-format stream-json` (prompt RIGHT AFTER `-p`)
- NDJSON event parsing: `message` events with `role === 'assistant'` → extract `content`
- ⚠️ Filters `role:"user"` messages (Gemini echoes user input back)
- Persona prepended to prompt as `[System Instructions]`
- Dual truncation on conversation history (same as cli-runner)
- Heartbeat timeout, stderr sliding window, SIGTERM/SIGKILL cleanup
- Clean environment: strips Claude nesting detection env vars before spawn
- `--model` only from `GEMINI_MODEL` env var (NOT from profile.model)
- `isHarmlessGeminiTelemetry()` filters benign ECONNRESET stderr noise
- Clear spawn error if `gemini` CLI is not installed

**Dependencies**: `node:child_process`, `runner.ts` (interface), `messageStore`

**Env vars**: `GEMINI_PATH`, `GEMINI_MODEL`, `CLI_HEARTBEAT_TIMEOUT`, `MAX_HISTORY_MESSAGES`, `MAX_MESSAGE_CHARS`

### src/server/runtime/provider-router.ts (Phase 3 Multi-Provider)

**Purpose**: Routes `AgentProfile.provider` to the correct Runner instance.

**Key exports**:

- `routeToRunner(profile: AgentProfile): Runner` — main routing function
- `KNOWN_PROVIDERS` — `['anthropic', 'openai', 'google']`
- `PROVIDER_MODEL_SUGGESTIONS` — suggested models per provider (for UI)
- `PROVIDER_MODEL_PREFIXES` — expected model prefixes per provider (for soft validation)
- `isKnownProvider(provider)` — type guard
- `validateModelForProvider(provider, model)` — returns warning or null

**Dependencies**: `cli-runner.ts`, `openai-runner.ts`, `gemini-runner.ts`

### src/server/runtime/orchestrator.ts

**Purpose**: Core 7-step invocation lifecycle coordinator (§7.1 Steps 2–7).

**Key exports**:

- `executeInvocation(params: ExecuteParams): Promise<InvocationResult>` — main entry point
- `ExecuteParams`: threadId, sourceMessageId, mention, taskText, optional runner
- `InvocationResult = { ok: true; invocation; replyMessage } | { ok: false; reason }`
- `extractTaskText(content, mention): string` — strips @mention from message

**Lifecycle steps**: resolve agent → create invocation (queued) → find/create session → **check session handoff (Step 3.5)** → route to provider runner (running + emit text.delta events) → assemble public reply Message → close invocation (completed/failed)

**Dependencies**: `agentRegistry`, `invocationStore`, `messageStore`, `emitEvent`, `findOrCreateSession`, `routeToRunner` (Phase 3), `stubRunner` (fallback via `CLI_RUNNER=stub`), `shouldSealSession`, `executeHandoff` (Phase 3 Session Chain), `parseMemoryMarkers`, `stripMemoryMarkers`, `createMemoriesFromExtraction` (Phase 4)

**Architecture rule**: AgentInvocation record MUST exist before any agent output appears.

**Phase 3 Session Chain**: Step 3.5 inserted between session selection and runner execution. If `shouldSealSession()` returns true, seals current session, generates context summary, creates new continuation session, and re-binds invocation.

**Phase 4 Memory Auto-extraction**: After successful invocation, scans reply text for `[MEMORY: ...]` markers. If found: parses markers, strips them from visible reply message, creates Memory entities via `createMemoriesFromExtraction()`, emits `memory.extracted` SSE events for each created memory.

### src/server/runtime/session-chain.ts (Phase 3 Session Chain)

**Purpose**: Automatic session sealing, context summarization, and handoff management.

**Key exports**:

- `shouldSealSession(threadId, agentId, session): Promise<SealCheck>` — checks message/token thresholds
- `sealSession(session): Promise<AgentSession>` — marks session as sealed
- `generateContextSummary(threadId, session, profile, strategy?): Promise<string>` — rule-based or LLM summary
- `executeHandoff(threadId, agentId, session, invocationId, profile, reason, strategy?): Promise<HandoffResult>` — full seal → summarize → create continuation
- `getSessionChain(threadId, agentId): Promise<AgentSession[]>` — ordered session history
- `getPredecessorSummary(sessionId): Promise<string | null>` — loads predecessor's context summary
- `SESSION_CHAIN_CONFIG` — current configuration values

**Dependencies**: `agentSessionStore`, `messageStore`, `sessionHandoffStore`, `emitEvent`, `routeToRunner`, `generateId`

**Env vars**: `SESSION_SEAL_MESSAGE_THRESHOLD` (30), `SESSION_SEAL_TOKEN_THRESHOLD` (20000), `SESSION_SUMMARY_STRATEGY` ('rule-based'), `SESSION_SUMMARY_MAX_CHARS` (1000)

### src/server/runtime/memory-loader.ts (Phase 4 Long-term Memory)

**Purpose**: Scores, selects, and formats memories for prompt injection. Also handles auto-extraction of `[MEMORY:]` markers from agent output.

**Key exports**:

- `scoreMemory(memory, taskText, recentMessages, agentId, threadId): number` — weighted relevance scoring (scope match + confidence + recency + frequency + keyword match + category boost). Returns -1 to skip wrong-scope memories.
- `findRelevantMemories(threadId, agentId, taskText, recentMessages): Promise<MemoryContext>` — loads candidate memories, scores, selects top N within char budget, updates access tracking
- `formatMemoriesForPrompt(memories): string` — formats as `[Learned Memory]:\n- [category] value (confidence: X%)`
- `parseMemoryMarkers(text): ExtractedMemory[]` — regex extraction of `[MEMORY: category=X, key=Y, value=Z]` markers
- `stripMemoryMarkers(text): string` — removes `[MEMORY:]` markers from text
- `createMemoriesFromExtraction(extracted, scope?, threadId?, agentId?): Promise<Memory[]>` — creates Memory entities with dedup (updates existing if key matches)

**Dependencies**: `memoryStore`, `generateId`

**Env vars**: `MAX_MEMORIES_IN_CONTEXT` (3), `MAX_MEMORY_CHARS` (500)

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

**Forwarded events**: `invocation.created/started/completed/failed`, `text.delta` (chunk only), `session.created/selected/sealed`, `session.handoff`, `memory.extracted` (Phase 4)

**Hard rule**: NEVER pushes raw private log payload into the public stream. Only safe, minimal data fields are included.

**Dependencies**: `eventBus`

### src/server/streaming/index.ts

**Purpose**: Barrel re-export.

---

## src/server/api/ — REST endpoints

### src/server/api/threads.ts

**Purpose**: Thread CRUD routes.

**Routes**:

- `POST /api/threads` — create a new thread (accepts `{ title, workspacePath?, selectedAgentIds? }`)
- `GET /api/threads` — list all threads (sorted by updatedAt desc)
- `GET /api/threads/:id` — get one thread by id

**Dependencies**: `threadStore`

**Phase 3 Upgrade**: POST accepts optional `selectedAgentIds` array for storing cat selection at thread creation.

### src/server/api/messages.ts

**Purpose**: Message routes + automatic invocation trigger.

**Routes**:

- `GET /api/threads/:threadId/messages` — list public + system-summary messages (never private)
- `POST /api/threads/:threadId/messages` — submit user message; if @mentions found, triggers `executeInvocation()` for the first mention (v1: single-agent only)

**Dependencies**: `threadStore`, `messageStore`, `parseMentions`, `executeInvocation`, `extractTaskText`

**Notes**: Returns `{ userMessage, invocationTriggered, triggeredMentions }` on POST. Phase 2: invocation is fire-and-forget (non-blocking); results stream via SSE. Phase 3 A2A: all @mentions trigger sequential invocations (not just the first).

### src/server/api/runtime.ts

**Purpose**: Runtime status and SSE streaming endpoints.

**Routes**:

- `GET /api/threads/:threadId/runtime` — most recent invocation snapshot
- `GET /api/threads/:threadId/stream` — SSE endpoint (delegates to sseHandler)
- `GET /api/threads/:threadId/audit-logs` — event logs with filtering (eventType, agentId, time range, pagination) (Phase 3 Audit)
- `GET /api/threads/:threadId/audit-stats` — aggregate statistics (invocation counts, avg duration, failures) (Phase 3 Audit)
- `GET /api/threads/:threadId/workspace-binding` — get workspace binding (Phase 3 Directory)
- `PUT /api/threads/:threadId/workspace-binding` — create/update workspace binding (Phase 3 Directory)
- `DELETE /api/threads/:threadId/workspace-binding` — remove workspace binding (Phase 3 Directory)

**Dependencies**: `invocationStore`, `eventLogStore`, `workspaceBindingStore`, `sseHandler`

### src/server/api/agents.ts

**Purpose**: Agent profile CRUD routes — Phase 3 Config Center + Multi-Provider.

**Routes**:

- `GET /api/agents/providers` — list known providers with model suggestions (Phase 3 Multi-Provider)
- `GET /api/agents` — list all agent profiles (enabled + disabled), sorted by name
- `GET /api/agents/:id` — get single agent profile
- `POST /api/agents` — create new profile (auto-generated id, validates required fields + provider validation, reloads registry)
- `PUT /api/agents/:id` — update profile (partial update, id immutable, provider validation, reloads registry)
- `DELETE /api/agents/:id` — delete profile (409 if active invocations exist, reloads registry)

**Dependencies**: `agentProfileStore`, `invocationStore`, `agentRegistry`, `generateId`, `provider-router` (Phase 3)

**Notes**: All mutating endpoints call `agentRegistry.load()` after success to hot-reload the mention resolver. Delete has a safety check against running/queued invocations. Phase 3: POST/PUT reject unknown providers (400) and include soft model-prefix warnings.

### src/server/api/memories.ts (Phase 4 Long-term Memory)

**Purpose**: Memory CRUD routes with filtering, pagination, stats, and uniqueness validation.

**Routes**:

- `GET /api/memories` — list memories with filters (scope, category, threadId, agentId, search keyword, limit/offset pagination)
- `GET /api/memories/stats` — aggregate stats (total, by scope, by category, recently accessed)
- `GET /api/memories/:id` — get single memory
- `POST /api/memories` — create memory (validates category, confidence 0-1, scope-dependent fields, key uniqueness)
- `PUT /api/memories/:id` — update memory (partial update: value, confidence, tags, category)
- `DELETE /api/memories/:id` — delete memory

**Dependencies**: `memoryStore`, `generateId`

**Notes**: Key+scope+threadId+agentId uniqueness enforced (409 on duplicate). Scope='thread' requires threadId, scope='agent' requires agentId.

### src/server/api/index.ts

**Purpose**: Mounts all route groups under `/api`.

**Mounts**: `agentRouter` at `/agents`, `threadRouter` at `/threads`, `messageRouter` at `/threads/:threadId/messages`, `runtimeRouter` at `/threads/:threadId`, `memoryRouter` at `/memories` (Phase 4)

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

**Bootstrap order**: `seedAgentProfiles()` → `seedMemories()` → `agentRegistry.load()` → `app.listen(PORT)`

**Configuration**: `PORT` env var, default 3001.

---

## src/client/ — Frontend

### src/client/index.html

**Purpose**: Single-file React SPA (CDN React 18, no build step).

**Components**: App, ThreadList, NewThreadDialog, MessageStream, MessageInput, RuntimePanel, ConfigCenter, AgentForm, AuditPanel (Phase 3), WorkspaceBindingBadge (Phase 3), MemoryPanel (Phase 4), MemoryForm (Phase 4)

**Layout**: Three-column (§4.1) — left: thread list, center: messages + input, right: runtime status OR Config Center (gear icon) OR MemoryPanel (brain icon)

**SSE integration**: Opens EventSource to `/api/threads/:id/stream`. Handles `text.delta` → streaming buffer, `invocation.completed` → refresh messages, `invocation.started/failed` → update runtime panel.

**Styling**: Minimal inline CSS, no framework.

**Phase 2 updates**: Thinking indicator, error banner, auto-scroll.

**Phase 3 — Config Center**: Gear icon in thread list header toggles right panel between RuntimePanel and ConfigCenter. ConfigCenter shows agent list grouped by `family` with provider color dots (purple=Anthropic, green=OpenAI, blue=Google), create/edit/delete actions, and AgentForm with family + displayName fields.

**Phase 3 — NewThreadDialog**: Modal dialog replaces instant thread creation. Shows title input, grouped cat selector with colored provider dots and checkboxes, project directory input, and create/cancel buttons. Posts with `selectedAgentIds`.

**Phase 3 — Multi-Provider Form**: AgentForm provider field upgraded from text input to `<select>` dropdown (anthropic/openai/google). Model field gains `<datalist>` suggestions that change based on selected provider. `MODEL_SUGGESTIONS` constant provides model options per provider.

**Utilities**: `getProviderColor(provider)` — color map for provider dots. `groupByFamily(agents)` — groups agents array by family field. `MODEL_SUGGESTIONS` — model suggestions per provider for datalist. `showMemoryToast(key, category)` — Phase 4 DOM toast notification for auto-extracted memories.

**Phase 4 — MemoryPanel**: Brain icon (🧠) in thread list header toggles MemoryPanel in right panel. Shows stats bar (total/global/thread/agent counts), scope filter tabs, category dropdown + search input, memory cards with confidence bars and edit/delete actions, add button for new memories via MemoryForm modal. SSE listener for `memory.extracted` events shows toast notification.

---

## Dependency Graph (simplified)

```
main.ts
  ├── app.ts
  │     ├── api/index.ts
  │     │     ├── api/threads.ts    → persistence
  │     │     ├── api/messages.ts   → persistence, registry, runtime/orchestrator
  │     │     ├── api/runtime.ts    → persistence, streaming/sse-handler
  │     │     ├── api/agents.ts     → persistence, registry (Phase 3)
  │     │     └── api/memories.ts   → persistence (Phase 4)
  │     └── static: client/index.html
  ├── persistence/seed.ts           → persistence/index.ts
  └── registry/agent-registry.ts    → persistence/index.ts

runtime/orchestrator.ts
  ├── registry/agent-registry.ts
  ├── persistence/index.ts
  ├── runtime/event-emitter.ts      → persistence, streaming/event-bus
  ├── runtime/session-manager.ts    → persistence, runtime/event-emitter
  ├── runtime/runner.ts             (Runner interface, StubRunner)
  ├── runtime/provider-router.ts    (routes profile.provider → Runner)
  │     ├── runtime/cli-runner.ts   (CliRunner — Anthropic/claude CLI)
  │     ├── runtime/openai-runner.ts (OpenAiRunner — OpenAI/codex CLI)
  │     └── runtime/gemini-runner.ts (GeminiRunner — Google/gemini CLI)
  ├── runtime/memory-loader.ts      (Phase 4: scoring, injection, extraction)
  └── runtime/cli-runner.ts         (CliRunner — real LLM via CLI subprocess)

streaming/sse-handler.ts
  └── streaming/event-bus.ts        (receives events from runtime/event-emitter)
```
