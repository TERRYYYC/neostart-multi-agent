# Project Status

## Current Snapshot

- Project: `cat-cafe v1`
- Active workspace: `/Users/terry/Desktop/code code/project/cat-cafe/workspace-v1`
- Current phase: `Phase 4 IN PROGRESS`
- Overall status: `Phase 4 COMPLETE — Long-term Memory delivered`

## Current Goal

Phase 4 is **complete**. Long-term Memory feature delivered: Memory entity (3-level scope), CRUD API, relevance scoring & prompt injection, auto-extraction from agent output, MemoryPanel UI, SSE notifications.

## Must-Read Documents

Every coding session must read these first:

1. `/Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/AGENTS.md`
2. `/Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/docs/cat-cafe-v1-architecture.md`
3. `/Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/docs/implementation-checklist.md`
4. `/Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/docs/source-map.md`
5. `/Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/docs/status.md`

## Completed

- created isolated implementation workspace
- wrote formal v1 architecture baseline
- wrote implementation checklist
- wrote Phase 1 task breakdown
- WS1: project skeleton (package.json, tsconfig.json, src/ folder layout)
- WS2: shared domain types (Thread, Message, AgentProfile, AgentSession, AgentInvocation, EventLog, WorkspaceBinding, Visibility, EventType) — verified against architecture §5–§8
- WS3: persistence layer (generic Store<T> interface, JsonFileStore implementation, 7 concrete stores, seed data for 3 cats) — smoke tested
- WS4: agent registry (AgentRegistry class, case-insensitive mention resolution, parseMentions utility) — smoke tested
- WS5: invocation runtime (event emitter, session manager, Runner interface + StubRunner, orchestrator with full §7.1 lifecycle, extractTaskText utility) — 6 tests passed: lifecycle, session reuse, invalid mention, runner failure, Message/EventLog separation
- WS6: event streaming + HTTP API (Express server, in-process event bus, SSE handler with visibility filtering, REST APIs for threads/messages/runtime, server entry point with bootstrap) — verified: tsc clean, curl smoke tests, SSE streaming (no private data leaked)
- WS7: minimal UI shell (single-file React SPA — three-column layout, thread list, message stream with SSE streaming, input box with @cat, runtime panel with live state updates) — verified: frontend served at /, E2E curl test (create thread → send @maine → invocation OK)
- Phase 2: real LLM runner (CliRunner via claude CLI subprocess), fire-and-forget invocation, conversation context loading, thinking indicator, error banner — all 6 deliverables verified
- Phase 3 — Config Center: CRUD API for agent profiles (`/api/agents`), frontend config panel (replaces right panel), gear icon toggle, create/edit/delete agents with live registry reload — verified: tsc clean, curl smoke tests (GET/POST/PUT/DELETE), validation, delete safety check
- Phase 3 — Config Center Upgrade: family grouping (`family`, `displayName` fields), provider color dots (purple/green/blue), NewThreadDialog modal with cat selector + project directory, Thread.selectedAgentIds, multi-variant seed data (Maine Sonnet + Opus), seed migration patch — verified: tsc clean, curl smoke tests
- Phase 3 — Multi-Provider Support: Codex CLI runner (`codex exec --json`), Gemini CLI runner (`gemini -p --output-format stream-json`), provider router (routes profile.provider → correct CLI runner), provider/model validation in agents API, provider dropdown + model datalist in Config Center form, Ragdoll (OpenAI) + Birman (Gemini) seed cats — verified: tsc clean, server boots, curl smoke tests. All 3 providers use unified CLI subprocess architecture.
- Phase 3 — Session Chain / Handoff: Full automatic session sealing when message/token thresholds exceeded, dual summary strategies (rule-based + LLM-generated), session chain with predecessor context carry-over, SessionHandoff entity + persistence, new SSE events (session.sealed, session.handoff), REST API for session chain/handoffs/manual seal, RuntimePanel session chain UI with expandable summaries — verified: tsc clean
- Phase 3 — Audit Tools: Event log API with filtering (eventType, agentId, time range, pagination), aggregate statistics endpoint (invocation counts, avg duration, failure rate), AuditPanel UI with stat cards + filterable event list + load-more pagination — verified: tsc clean
- Phase 3 — Project Directory Binding: Workspace binding CRUD API (GET/PUT/DELETE /api/threads/:threadId/workspace-binding), WorkspaceBindingBadge UI component with inline editing, auto-sync with Thread.workspacePath — verified: tsc clean
- Phase 3 — A2A Expansion (single-hop): Multiple @mentions in one message now trigger sequential invocations for each mentioned agent, POST response includes triggeredMentions array, agents execute one after another to avoid race conditions, errors in one don't block the rest — verified: tsc clean
- Phase 4 — Long-term Memory: Memory entity with 3-level scope (global/thread/agent), 6 categories (fact/preference/context/user-profile/session-insight/agent-state), CRUD API with filtering/pagination/stats, relevance scoring & prompt injection (Anthropic runner), auto-extraction from `[MEMORY:]` markers in agent output, MemoryPanel UI (list/filter/search/edit/delete/add), SSE `memory.extracted` toast notifications — verified: tsc clean

## Phase 1 Done Criteria Check

Per `implementation-checklist.md`, Phase 1 is complete when:

1. a Thread can be created and loaded ✅ (threadStore + POST/GET /api/threads)
2. a user message can be stored in a Thread ✅ (messageStore + POST /api/threads/:id/messages)
3. one @cat target can be resolved to an AgentProfile ✅ (AgentRegistry.resolve())
4. one AgentSession can be found or created ✅ (findOrCreateSession())
5. one AgentInvocation can be created and tracked ✅ (executeInvocation() lifecycle)
6. runtime events can be emitted and persisted separately from public messages ✅ (EventLog in event-logs.json, Message in messages.json)
7. visible output can be streamed without leaking raw private logs ✅ (SSE handler with toSsePayload() filtering)

## In Progress

- Phase 4 is complete. Ready for Phase 5 planning.

## Next Recommended Task

- Phase 5 planning: export, voice, notifications, advanced statistics, multi-hop A2A

## Blockers

- none

## Out Of Scope (Phase 5+)

- export (thread/message export)
- voice
- notifications
- advanced statistics
- multi-hop A2A (agent-to-agent chaining without user trigger)

## How To Run

```bash
cd /Users/terry/Desktop/code\ code/project/cat-cafe/workspace-v1
npm install
npx tsx src/server/main.ts
# Open http://localhost:3001
```

## Update Rule

Update this file whenever:

- the current phase changes
- a major milestone is completed
- the next recommended task changes
- a new blocker appears
