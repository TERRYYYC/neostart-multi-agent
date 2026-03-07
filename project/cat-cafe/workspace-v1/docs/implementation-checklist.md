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

## Phase 2 — What To Build

### Allowed

- Replace `StubRunner` with a real LLM runner (Anthropic API via `@anthropic-ai/sdk`)
- Wire system prompt from `AgentProfile.persona` into the LLM call
- Stream text deltas from the Anthropic API through the existing event pipeline
- Adjust frontend to handle real streaming latency
- Add API key configuration (env var `ANTHROPIC_API_KEY`)
- Add conversation context (prior messages) to the LLM call
- Fix any end-to-end bugs discovered during vertical slice testing

### NOT Allowed (Phase 3+)

- full configuration center
- automatic session chain handoff
- export
- voice
- notifications
- long-term memory
- advanced right-panel statistics
- multi-hop A2A

## Done Criteria For Phase 2

Phase 2 is complete only when:

1. user creates a `Thread`
2. user sends one message with `@cat`
3. system creates one invocation
4. selected cat returns one **real LLM reply** (not stub)
5. reply streams into the center stream in real-time
6. runtime panel shows minimal invocation state
7. conversation context (prior messages) is sent to the LLM

## Non-Negotiable Rules

- `Thread` is the top-level boundary
- `AgentInvocation` must exist before agent output appears in UI
- `Message` and `EventLog` must remain separate
- only `public / private / system-summary` are valid visibility values
- do not edit `project/fma` unless explicitly requested

## Before Starting Any Task

Read:

- `/Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/AGENTS.md`
- `/Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/docs/cat-cafe-v1-architecture.md`
- `/Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/docs/source-map.md`

Confirm:

- the task belongs to `Phase 2`
- the task does not require forbidden features
- the task can be validated end-to-end

## Phase 2 Key Integration Point

The `Runner` interface in `src/server/runtime/runner.ts` is the **only file** that needs a new implementation. The orchestrator already calls `runner.run()` with the correct params. Create a new `AnthropicRunner` that implements `Runner` and wire it into the orchestrator's default runner selection.
