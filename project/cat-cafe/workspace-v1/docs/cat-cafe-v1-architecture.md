# cat-cafe v1 Architecture Baseline

## 1. Purpose

This document is the formal architecture baseline for `cat-cafe v1`.

It is a hard prerequisite for implementation.

Before this baseline is accepted:

- do not create formal product UI pages
- do not create formal backend business APIs
- do not start implementing configuration center, session chain automation, export, or other secondary features

This baseline defines:

- v1 scope
- core entities
- event and visibility rules
- `@cat` invocation lifecycle
- frontend and backend boundaries
- implementation order

---

## 2. Product Goal

`cat-cafe v1` is a single-user, multi-agent collaboration workspace.

Its goal is not to be a generic chat app.
Its goal is to provide a traceable agent workspace where a user can:

- create a `Thread`
- send a message with `@cat`
- trigger one visible agent execution
- receive a public result in the main message stream
- inspect a minimal runtime status without exposing all private execution logs

---

## 3. v1 Scope

## 3.1 In Scope

- `Thread` as a first-class workspace resource
- left panel `Thread` list
- center public message stream
- minimal right-side runtime status
- `@cat` mention parsing
- one visible `AgentInvocation`
- one active `AgentSession` per cat per thread
- public message channel and private runtime event channel separation
- SSE streaming for visible output
- local persistence suitable for development

## 3.2 Explicitly Out of Scope

- full Hub / configuration center
- automatic session handoff and full `Session Chain`
- export
- voice I/O
- notification system
- long-term memory
- rich block system
- multi-user collaboration
- deep multi-hop A2A routing

## 3.3 First Demo Success Criteria

The first vertical slice is complete only if all of the following work:

1. create a new `Thread`
2. send one message containing `@cat`
3. backend creates one `AgentInvocation`
4. selected cat runs and returns output
5. output is appended to the public message stream in the same `Thread`
6. minimal runtime status shows invocation state change

---

## 4. Information Architecture

## 4.1 Page Skeleton

The v1 app is a three-column SPA:

- left: `Thread List`
- center: `Thread Message Stream`
- right: `Runtime Status`

## 4.2 Main Views

### Thread List

- create thread
- switch thread
- show recent threads

### Message Stream

- public user messages
- public agent replies
- limited system summary messages
- input box with `@cat`

### Runtime Status

- current invocation state
- current target cat
- simple timing / phase label

v1 runtime status must remain minimal.
Do not add advanced statistics before the first vertical slice is stable.

---

## 5. Core Domain Model

## 5.1 Entity List

v1 core entities are:

- `Thread`
- `Message`
- `AgentProfile`
- `AgentSession`
- `AgentInvocation`
- `EventLog`
- `WorkspaceBinding`

`SessionHandoff` is defined as a future entity, not a v1 implementation requirement.

---

## 5.2 Entity Definitions

### Thread

Purpose:

- the top-level workspace boundary

Key fields:

- `id`
- `title`
- `workspacePath`
- `createdAt`
- `updatedAt`
- `archivedAt?`
- `status`

Relationships:

- one `Thread` has many `Message`
- one `Thread` has many `AgentInvocation`
- one `Thread` has many `AgentSession`
- one `Thread` has one optional `WorkspaceBinding`

Lifecycle:

- created
- active
- archived

### Message

Purpose:

- represents only user-visible content in the main stream

Key fields:

- `id`
- `threadId`
- `role`
- `authorType`
- `authorId`
- `visibility`
- `content`
- `mentions`
- `sourceInvocationId?`
- `createdAt`

Relationships:

- belongs to one `Thread`
- may be produced by one `AgentInvocation`

Lifecycle:

- appended only
- never mutated in normal flow

### AgentProfile

Purpose:

- defines a cat identity available for routing

Key fields:

- `id`
- `name`
- `provider`
- `model`
- `persona`
- `enabled`

Relationships:

- one `AgentProfile` can have many `AgentSession`
- one `AgentProfile` can be the target of many `AgentInvocation`

Lifecycle:

- predefined for v1
- editable later in configuration phase

### AgentSession

Purpose:

- stores one cat's active runtime context within one `Thread`

Key fields:

- `id`
- `threadId`
- `agentId`
- `status`
- `createdAt`
- `lastActiveAt`
- `sealedAt?`
- `contextSummary?`

Relationships:

- belongs to one `Thread`
- belongs to one `AgentProfile`
- can be referenced by many `AgentInvocation`

Lifecycle:

- created on first use
- active during v1
- sealed is reserved for later phases

### AgentInvocation

Purpose:

- records one explicit agent execution request

Key fields:

- `id`
- `threadId`
- `sourceMessageId`
- `targetAgentId`
- `sessionId`
- `parentInvocationId?`
- `state`
- `phase`
- `visibility`
- `startedAt`
- `finishedAt?`
- `errorCode?`

Relationships:

- belongs to one `Thread`
- starts from one source `Message`
- targets one `AgentProfile`
- runs within one `AgentSession`
- owns many `EventLog`

Lifecycle:

- queued
- running
- completed or failed

### EventLog

Purpose:

- stores runtime events that are not equivalent to public messages

Key fields:

- `id`
- `threadId`
- `invocationId`
- `sessionId?`
- `eventType`
- `visibility`
- `payload`
- `createdAt`

Relationships:

- belongs to one `AgentInvocation`
- may reference one `AgentSession`

Lifecycle:

- append-only

### WorkspaceBinding

Purpose:

- binds one `Thread` to one project path

Key fields:

- `id`
- `threadId`
- `path`
- `createdAt`

Relationships:

- belongs to one `Thread`

Lifecycle:

- created with thread or attached later

---

## 5.3 Entity Relationship Model

Text ER model:

```text
Thread
 ├─< Message
 ├─< AgentInvocation
 ├─< AgentSession
 └─1 WorkspaceBinding?

AgentProfile
 ├─< AgentInvocation
 └─< AgentSession

Message
 └─1 source for AgentInvocation

AgentSession
 └─< AgentInvocation

AgentInvocation
 └─< EventLog
```

Rules:

- `Thread` is the top-level boundary
- `Message` is only for user-visible stream content
- `EventLog` is not a chat message substitute
- `AgentInvocation` is the center of runtime tracking
- `AgentSession` is the context carrier for repeated executions by the same cat in the same thread

---

## 6. Visibility Model

## 6.1 Allowed Visibility Values

v1 only allows three visibility levels:

- `public`
- `private`
- `system-summary`

No additional visibility values may be introduced during v1 implementation without updating this document.

## 6.2 Meaning

### public

Visible in the center message stream.

Examples:

- user message
- final agent reply

### private

Not shown in the public chat stream.
Used for runtime-only events and internal execution details.

Examples:

- raw tool activity
- intermediate thinking
- low-level CLI events
- hidden agent handoff details

### system-summary

Visible to the user, but rendered as system/meta information rather than a normal reply.

Examples:

- invocation started
- invocation failed summary
- minimal state transition notices

## 6.3 Frontend Push Rules

### Push to center message stream

Only:

- `Message.visibility = public`
- selected system summary messages derived from `system-summary`

### Push to runtime status panel

Consume:

- current `AgentInvocation`
- selected `EventLog` with `private` or `system-summary`

But the panel should show aggregated status, not raw event dumps.

### Never push raw private logs into the public stream

This is a hard rule.

---

## 7. Invocation Lifecycle

This defines the lifecycle for a message like:

`@maine please inspect this file`

## 7.1 Steps

### Step 1: user sends a public message

The system appends one `Message`:

- `role = user`
- `visibility = public`

The input parser extracts:

- target cat mention
- remaining task text

### Step 2: system resolves target agent

The backend resolves `@cat` to one `AgentProfile`.

If resolution fails:

- create one `system-summary` failure event
- do not create a running invocation

### Step 3: session selection

The backend finds or creates one `AgentSession` for:

- current `Thread`
- target `AgentProfile`

v1 rule:

- one active session per cat per thread

### Step 4: invocation creation

Create one `AgentInvocation`:

- `state = queued`
- then `state = running`
- bind it to `threadId`, `sourceMessageId`, `targetAgentId`, `sessionId`

### Step 5: runtime execution

The runner emits `EventLog` records such as:

- invocation started
- provider selected
- model started
- streaming text chunk
- invocation completed
- invocation failed

Raw runtime events default to `private`.

### Step 6: visible output assembly

When the run succeeds:

- streamed visible text is assembled into one public agent `Message`
- `sourceInvocationId` points back to the invocation

When the run fails:

- create one `system-summary` message or event
- do not leak raw private logs

### Step 7: invocation closure

Set:

- `state = completed` or `failed`
- `finishedAt`

The runtime status panel updates to reflect final state.

## 7.2 State Machine

```text
queued -> running -> completed
queued -> running -> failed
queued -> cancelled
```

v1 does not need user-triggered cancellation UI, but the state is reserved.

---

## 8. Event Model

## 8.1 v1 Event Types

Recommended initial event types:

- `invocation.created`
- `invocation.started`
- `invocation.text.delta`
- `invocation.completed`
- `invocation.failed`
- `session.created`
- `session.selected`

## 8.2 Event Rules

- all runtime events are append-only
- every runtime event belongs to one invocation
- events may be streamed over SSE
- frontend consumers must not infer business truth from UI state alone
- persistence is the source of truth

---

## 9. Backend Boundaries

The backend is split into these v1 responsibilities:

### Thread Service

- create thread
- list thread
- load thread detail

### Message Service

- append user message
- append agent public message
- list thread messages

### Agent Runtime Service

- parse mention
- resolve agent
- select session
- create invocation
- run CLI model
- emit event logs

### Persistence Layer

- store thread
- store message
- store invocation
- store session
- store event log

v1 storage may be local file-based if it preserves clear boundaries between these resources.

---

## 10. Frontend Boundaries

The frontend is split into:

### Thread Shell

- app layout
- thread navigation

### Stream View

- public message list
- input box
- system summary rendering

### Runtime Panel

- current invocation snapshot only

### Client State Rule

Frontend state is a cache of backend truth.
Do not let frontend-only state become the system of record for invocation or session lifecycle.

---

## 11. API Draft

The final route names may change, but the boundaries should remain.

### Thread APIs

- `POST /api/threads`
- `GET /api/threads`
- `GET /api/threads/:id`

### Message APIs

- `GET /api/threads/:id/messages`
- `POST /api/threads/:id/messages`

### Runtime APIs

- `POST /api/threads/:id/invocations`
- `GET /api/threads/:id/runtime`
- `GET /api/threads/:id/stream`

Guideline:

- message submission and invocation triggering may be combined in v1
- do not combine thread persistence with runtime event transport in one unclear route

---

## 12. Implementation Order

## Phase 0: Baseline

Done when this document is accepted.

## Phase 1: Runtime Foundation

Build:

- thread persistence
- invocation model
- session model
- event log model
- SSE stream separation

Do not build advanced UI in this phase.

## Phase 2: Minimal Vertical Slice

Build only:

- create thread
- send `@cat` message
- run one invocation
- append one public result
- show minimal runtime status

Nothing else should jump ahead of this.

## Phase 3 and Later

After Phase 2 is proven:

- session chain
- A2A expansion
- config center
- audit tools
- export

---

## 13. Non-Negotiable Constraints

- `Thread` is the primary workspace boundary
- `AgentInvocation` is the primary runtime tracking object
- `Message` and `EventLog` must remain separate
- only three visibility states are allowed in v1
- no formal feature work may bypass invocation modeling
- no advanced modules before the minimal vertical slice works end-to-end

---

## 14. Open Questions

These do not block Phase 1:

- whether thread creation must bind a workspace immediately
- whether failed invocation should appear as a system summary message or only in the runtime panel
- whether v1 right panel shows one current invocation or a short recent list

These do block post-v1 phases:

- automatic session handoff thresholds
- multi-hop A2A routing depth
- full configuration center structure

