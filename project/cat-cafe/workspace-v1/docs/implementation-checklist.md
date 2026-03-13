# Implementation Checklist

## Current Phase

- Active phase: `Phase 2`
- Goal: minimal vertical slice — real LLM runner, end-to-end user flow
- Previous phase: `Phase 1 COMPLETE` (all 7 done criteria verified)

## Phase 1 Results (complete)

All 7 workstreams delivered and verified:

| WS | Deliverable | Status |
|----|-------------|--------|
| WS1 | Project skeleton (package.json, tsconfig.json, folder layout) | ✅ |
| WS2 | Shared domain types (7 interfaces, 7 scalar unions) | ✅ |
| WS3 | Persistence layer (Store<T> interface, JsonFileStore, 7 stores, seed data) | ✅ |
| WS4 | Agent registry (resolve, parseMentions, case-insensitive) | ✅ |
| WS5 | Invocation runtime (orchestrator, session manager, StubRunner, event emitter) | ✅ |
| WS6 | Event streaming + HTTP API (Express, SSE, visibility filtering, REST endpoints) | ✅ |
| WS7 | Minimal UI shell (single-file React SPA, three-column layout, SSE integration) | ✅ |

### Phase 1 Done Criteria (all passed)

1. ✅ a `Thread` can be created and loaded
2. ✅ a user message can be stored in a `Thread`
3. ✅ one `@cat` target can be resolved to an `AgentProfile`
4. ✅ one `AgentSession` can be found or created
5. ✅ one `AgentInvocation` can be created and tracked
6. ✅ runtime events can be emitted and persisted separately from public messages
7. ✅ visible output can be streamed without leaking raw private logs

## Phase 2 Results (complete)

All 6 deliverables implemented and typecheck passed:

| # | Deliverable | Status |
|---|-------------|--------|
| 1 | `CliRunner` class in `src/server/runtime/cli-runner.ts` (adapted from fma cli-runner.ts) | ✅ |
| 2 | Orchestrator wired to use `cliRunner` by default (fallback `CLI_RUNNER=stub`) | ✅ |
| 3 | Conversation context loaded from `messageStore` with dual truncation | ✅ |
| 4 | Frontend: thinking indicator, error banner, streaming latency UX | ✅ |
| 5 | POST /messages made non-blocking (fire-and-forget invocation, SSE delivers results) | ✅ |
| 6 | Documentation updated (source-map.md, implementation-checklist.md) | ✅ |

### Phase 2 Done Criteria

1. ✅ user creates a `Thread`
2. ✅ user sends one message with `@cat`
3. ✅ system creates one invocation
4. ✅ selected cat returns one **real LLM reply** (not stub) — via `claude` CLI subprocess
5. ✅ reply streams into the center stream in real-time — SSE `text.delta` events
6. ✅ runtime panel shows minimal invocation state — queued/running/completed/failed
7. ✅ conversation context (prior messages) is sent to the LLM — dual truncation strategy

### Key Changes

- **New file**: `src/server/runtime/cli-runner.ts` — spawns `claude -p --output-format stream-json` with `--model` and `--system-prompt` from `AgentProfile`
- **Modified**: `src/server/runtime/orchestrator.ts` — default runner switched from `stubRunner` to `cliRunner`
- **Modified**: `src/server/api/messages.ts` — invocation is now fire-and-forget (non-blocking POST)
- **Modified**: `src/client/index.html` — thinking indicator (animated dots), error banner, improved auto-scroll
- **Modified**: `src/server/runtime/index.ts` — barrel export includes `CliRunner`

### Environment Variables (Phase 2)

| Variable | Default | Description |
|----------|---------|-------------|
| `CLI_RUNNER` | (not set → cliRunner) | Set to `stub` to use StubRunner |
| `CLAUDE_PATH` | `claude` | Path to claude CLI binary |
| `CLI_HEARTBEAT_TIMEOUT` | `120000` | Max silence before killing CLI (ms) |
| `MAX_HISTORY_MESSAGES` | `10` | Max history messages in context |
| `MAX_MESSAGE_CHARS` | `2000` | Max chars per history message |

## Non-Negotiable Rules

- `Thread` is the top-level boundary
- `AgentInvocation` must exist before agent output appears in UI
- `Message` and `EventLog` must remain separate
- only `public / private / system-summary` are valid visibility values
- do not edit `project/fma` unless explicitly requested

## Phase 3 Results (in progress)

### Config Center (complete)

| # | Deliverable | Status |
|---|-------------|--------|
| 1 | Agent CRUD API (`src/server/api/agents.ts`) — GET/POST/PUT/DELETE with validation + delete safety check | ✅ |
| 2 | Registry hot-reload after every mutating operation | ✅ |
| 3 | Config Center UI panel (replaces right panel via gear toggle) | ✅ |
| 4 | Agent list with enabled toggle, edit, delete actions | ✅ |
| 5 | Create/edit form with client + server validation | ✅ |
| 6 | Documentation updated (source-map, status, checklist) | ✅ |

### Config Center Done Criteria

1. ✅ View all agent profiles (enabled and disabled)
2. ✅ Create new agent profile with validation
3. ✅ Edit existing agent profile (name, model, persona, enabled)
4. ✅ Delete agent profile with active-invocation safety check
5. ✅ Registry reloads immediately after changes
6. ✅ UI accessible via gear icon in thread list header

### Config Center Upgrade — Family Grouping + New Thread Dialog (complete)

| # | Deliverable | Status |
|---|-------------|--------|
| 1 | AgentProfile type: added optional `family` + `displayName` fields | ✅ |
| 2 | Thread type: added optional `selectedAgentIds` field | ✅ |
| 3 | Seed data: family/displayName on all cats, Maine-Opus variant added | ✅ |
| 4 | Seed migration: patches existing profiles missing new fields | ✅ |
| 5 | Backend: agents.ts handles family/displayName in POST/PUT | ✅ |
| 6 | Backend: threads.ts accepts selectedAgentIds in POST | ✅ |
| 7 | Frontend: Config Center groups agents by family with provider color dots | ✅ |
| 8 | Frontend: NewThreadDialog modal (cat selector + project directory) | ✅ |
| 9 | Frontend: AgentForm includes family + displayName fields | ✅ |
| 10 | Provider color coding: purple=Anthropic, green=OpenAI, blue=Google | ✅ |

### Multi-Provider Support (complete)

| # | Deliverable | Status |
|---|-------------|--------|
| 1 | `OpenAiRunner` (`src/server/runtime/openai-runner.ts`) — Codex CLI subprocess (`codex exec --json`) | ✅ |
| 2 | `GeminiRunner` (`src/server/runtime/gemini-runner.ts`) — Gemini CLI subprocess (`gemini -p --output-format stream-json`) | ✅ |
| 3 | `provider-router.ts` — routes `profile.provider` → correct Runner instance | ✅ |
| 4 | Orchestrator updated to use `routeToRunner(profile)` instead of hardcoded `cliRunner` | ✅ |
| 5 | Provider validation in agents API — reject unknown providers (400), soft model prefix check | ✅ |
| 6 | `GET /api/agents/providers` endpoint — returns known providers with model suggestions | ✅ |
| 7 | Config Center form: provider `<select>` dropdown + model `<datalist>` suggestions | ✅ |
| 8 | Seed data: Ragdoll (OpenAI/gpt-4o) + Birman (Google/gemini-2.0-flash) | ✅ |
| 9 | Barrel exports updated, tsc clean, smoke tests passed | ✅ |

### Multi-Provider Architecture

All three providers use the **same CLI subprocess pattern** (unified architecture):

| Provider | CLI | Command | NDJSON Text Extraction |
|----------|-----|---------|----------------------|
| Anthropic | `claude` | `claude -p --output-format stream-json --model <m>` | `event.type === 'assistant'` → `event.message.content[].text` |
| OpenAI | `codex` | `codex exec --json "<prompt>"` | `event.type === 'item.completed' && event.item.type === 'agent_message'` → `event.item.text` |
| Google | `gemini` | `gemini -p <prompt> --output-format stream-json` | `event.type === 'message' && event.role === 'assistant'` → `event.content` |

### Multi-Provider Bugfixes (verified working)

Three critical bugfixes applied to gemini-runner.ts and openai-runner.ts after initial implementation:

1. **Environment cleanup**: `spawn()` now uses `buildCleanEnv()` that strips Claude nesting detection env vars (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_AGENT_SDK_VERSION`, etc.). Without this, these vars interfere with gemini/codex CLI subprocess execution.

2. **Model flag: env var only**: `--model` is only passed when `GEMINI_MODEL` / `CODEX_MODEL` env var is set. `profile.model` is NOT passed to CLI because: (a) reference implementation only uses env vars, (b) CLI tools may not recognize all model name formats, (c) both default to their best available model.

3. **Gemini-specific fixes** (from reference `cli-runner.ts`):
   - Argument order: prompt must come RIGHT AFTER `-p` flag: `gemini -p <prompt> --output-format stream-json`
   - Removed `--sandbox` and `-y` flags (not used by reference)
   - User message filtering: Gemini echoes `role:"user"` messages, must filter to only `role:"assistant"`
   - `isHarmlessGeminiTelemetry()` filter for ECONNRESET stderr noise

### Multi-Provider Done Criteria

1. ✅ `tsc --noEmit` passes with zero errors
2. ✅ Server boots and loads all 5+ cats (Anthropic + OpenAI + Google)
3. ✅ `GET /api/agents/providers` returns provider metadata
4. ✅ `POST /api/agents` with unknown provider returns 400
5. ✅ Existing Anthropic cats continue to work via `claude` CLI
6. ✅ OpenAI cats route to Codex CLI runner (requires `codex` installed + authenticated)
7. ✅ Google cats route to Gemini CLI runner (requires `gemini` installed + authenticated)
8. ✅ Missing CLI returns clear spawn error message, not crash

### Environment Variables (Phase 3 Multi-Provider)

| Variable | Required | Description |
|----------|----------|-------------|
| `CODEX_PATH` | No | Path to codex CLI binary (default: `codex`) |
| `CODEX_MODEL` | No | Override codex model (default: codex auto-selects) |
| `GEMINI_PATH` | No | Path to gemini CLI binary (default: `gemini`) |
| `GEMINI_MODEL` | No | Override gemini model (default: gemini auto-selects) |

### CLI Prerequisites

| Provider | Install Command | Auth |
|----------|----------------|------|
| Anthropic | pre-installed (`claude`) | API key or `claude login` |
| OpenAI | `npm i -g @openai/codex` | ChatGPT account or `OPENAI_API_KEY` |
| Google | `npm i -g @google/gemini-cli` | Google account login |

### Session Chain / Handoff (complete)

| # | Deliverable | Status |
|---|-------------|--------|
| 1 | Type system: `SessionHandoff` entity, `SummaryStrategy`, `HandoffTrigger`, `AgentSession.predecessorSessionId/handoffId`, `EventType` additions | ✅ |
| 2 | Persistence: `sessionHandoffStore` (session-handoffs.json) | ✅ |
| 3 | Core logic: `session-chain.ts` — shouldSealSession, sealSession, generateContextSummary, executeHandoff, getSessionChain, getPredecessorSummary | ✅ |
| 4 | Summary strategies: rule-based (first msg + last 5) and LLM-generated (via same agent's runner) with fallback | ✅ |
| 5 | Orchestrator: Step 3.5 handoff check integrated before runner execution | ✅ |
| 6 | Runner context: all 3 runners (cli/openai/gemini) load predecessor contextSummary and prepend to prompt | ✅ |
| 7 | SSE events: `session.sealed` and `session.handoff` forwarded via sse-handler | ✅ |
| 8 | REST API: GET session-chain, GET session-handoffs, POST manual seal, GET config | ✅ |
| 9 | Frontend: RuntimePanel shows session chain list with status, message count, expandable summaries, handoff notification | ✅ |
| 10 | Barrel exports updated, tsc clean | ✅ |

### Session Chain Done Criteria

1. ✅ `tsc --noEmit` passes with zero errors
2. ✅ Session auto-seals when message count exceeds `SESSION_SEAL_MESSAGE_THRESHOLD`
3. ✅ Context summary generated (rule-based default, LLM optional)
4. ✅ New session created with `predecessorSessionId` linking to sealed session
5. ✅ Predecessor context prepended to runner prompt in new session
6. ✅ SSE events (`session.sealed`, `session.handoff`) forwarded to frontend
7. ✅ REST API returns session chain and handoff records
8. ✅ RuntimePanel displays session chain with expandable summaries
9. ✅ Manual seal endpoint works

### Session Chain Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SESSION_SEAL_MESSAGE_THRESHOLD` | `30` | Messages per session before auto-seal |
| `SESSION_SEAL_TOKEN_THRESHOLD` | `20000` | Approximate token threshold for auto-seal |
| `SESSION_SUMMARY_STRATEGY` | `rule-based` | Default summary strategy (`rule-based` or `llm-generated`) |
| `SESSION_SUMMARY_MAX_CHARS` | `1000` | Max characters for context summary |

### Audit Tools (complete)

| # | Deliverable | Status |
|---|-------------|--------|
| 1 | `GET /api/threads/:threadId/audit-logs` — event log API with filtering (eventType, agentId, time range, pagination) | ✅ |
| 2 | `GET /api/threads/:threadId/audit-stats` — aggregate statistics (invocation counts, avg duration, failure rate, per-agent breakdown) | ✅ |
| 3 | AuditPanel UI component: stat cards grid (invocations, events, avg time, failures) | ✅ |
| 4 | AuditPanel: filterable event list with event type dropdown | ✅ |
| 5 | AuditPanel: load-more pagination for large event histories | ✅ |
| 6 | RuntimePanel → Audit tab switcher (Audit → button in runtime header) | ✅ |
| 7 | tsc clean | ✅ |

### Audit Tools Done Criteria

1. ✅ `tsc --noEmit` passes with zero errors
2. ✅ `GET /api/threads/:threadId/audit-logs` returns filtered event logs
3. ✅ `GET /api/threads/:threadId/audit-stats` returns aggregate statistics
4. ✅ AuditPanel renders stats cards and event list
5. ✅ Event type filter narrows results
6. ✅ Load-more pagination works

### Project Directory Binding (complete)

| # | Deliverable | Status |
|---|-------------|--------|
| 1 | `GET /api/threads/:threadId/workspace-binding` — get current binding | ✅ |
| 2 | `PUT /api/threads/:threadId/workspace-binding` — create/update binding + sync Thread.workspacePath | ✅ |
| 3 | `DELETE /api/threads/:threadId/workspace-binding` — remove binding | ✅ |
| 4 | WorkspaceBindingBadge UI component with inline editing | ✅ |
| 5 | Badge displays project path with edit/set button | ✅ |
| 6 | tsc clean | ✅ |

### Project Directory Binding Done Criteria

1. ✅ `tsc --noEmit` passes with zero errors
2. ✅ `PUT /workspace-binding` creates/updates binding and syncs Thread.workspacePath
3. ✅ `GET /workspace-binding` returns current binding
4. ✅ `DELETE /workspace-binding` removes binding and clears Thread.workspacePath
5. ✅ WorkspaceBindingBadge renders inline-editable path below message area

### A2A Expansion — Single-Hop (complete)

| # | Deliverable | Status |
|---|-------------|--------|
| 1 | messages.ts: iterate ALL mentions (not just first) and trigger sequential invocations | ✅ |
| 2 | Sequential execution: each agent runs after the previous completes | ✅ |
| 3 | Error isolation: failure in one agent doesn't block others | ✅ |
| 4 | POST response includes `triggeredMentions` array | ✅ |
| 5 | tsc clean | ✅ |

### A2A Expansion Done Criteria

1. ✅ `tsc --noEmit` passes with zero errors
2. ✅ Message with `@maine @siamese review this` triggers two invocations sequentially
3. ✅ Each invocation runs the full lifecycle independently
4. ✅ If first agent fails, second still executes
5. ✅ POST response indicates all triggered mentions

## Phase 4 Results (complete)

### Long-term Memory (complete)

| # | Deliverable | Status |
|---|-------------|--------|
| 1 | Memory entity types: `Memory`, `MemoryScope`, `MemoryCategory`, `MemorySource` in `types.ts` | ✅ |
| 2 | `memoryStore` persistence (`memories.json`) + 3 seed memories | ✅ |
| 3 | Memory CRUD API (`src/server/api/memories.ts`) — 6 endpoints with filtering, pagination, stats, validation | ✅ |
| 4 | Memory loader module (`src/server/runtime/memory-loader.ts`) — scoring, selection, formatting, extraction | ✅ |
| 5 | Prompt injection in `cli-runner.ts` — memories between predecessor summary and conversation history | ✅ |
| 6 | Auto-extraction in `orchestrator.ts` — `[MEMORY:]` markers parsed, stripped from reply, Memory entities created | ✅ |
| 7 | SSE `memory.extracted` event forwarded via `sse-handler.ts` | ✅ |
| 8 | MemoryPanel UI — list/filter/search/edit/delete/add, brain icon toggle, scope tabs, stats bar | ✅ |
| 9 | Memory toast notification — SSE listener shows auto-extraction toast | ✅ |
| 10 | tsc clean, documentation updated | ✅ |

### Long-term Memory Done Criteria

1. ✅ `tsc --noEmit` passes with zero errors
2. ✅ Memory CRUD API: all 6 endpoints work (create, read, update, delete, list, stats)
3. ✅ Memory validation: category enum, confidence 0-1, scope-dependent fields, key uniqueness
4. ✅ Memory injection: relevant memories appear in Anthropic runner prompt
5. ✅ Auto-extraction: `[MEMORY:]` markers in agent output create Memory entities
6. ✅ Marker stripping: `[MEMORY:]` markers removed from public reply message
7. ✅ SSE event: `memory.extracted` events forwarded to frontend
8. ✅ MemoryPanel UI: renders with filter/search/edit/delete/add functionality
9. ✅ Brain icon toggle in thread list header

### Long-term Memory Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_MEMORIES_IN_CONTEXT` | `3` | Max memories injected into prompt |
| `MAX_MEMORY_CHARS` | `500` | Total char budget for memory section |

## NOT Allowed (Phase 5+)

- export
- voice
- notifications
- advanced statistics
- multi-hop A2A (agent-to-agent chaining without user trigger)
