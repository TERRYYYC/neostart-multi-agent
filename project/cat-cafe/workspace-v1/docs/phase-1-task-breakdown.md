# Phase 1 Task Breakdown

## Objective

Build the runtime foundation required for the first vertical slice.

This phase is successful only if the system can support:

- `Thread`
- `Message`
- `AgentProfile`
- `AgentSession`
- `AgentInvocation`
- `EventLog`

without collapsing these concepts into a single conversation object.

---

## Workstream 1: Project Skeleton

### Tasks

- define initial source layout under `src/`
- define where persistence files live
- define shared type modules
- define a minimal development bootstrap path

### Output

- stable folder structure
- base type definitions

### Notes

- keep it small
- avoid speculative folders for out-of-scope features

---

## Workstream 2: Domain Types

### Tasks

- define `Thread`
- define `Message`
- define `AgentProfile`
- define `AgentSession`
- define `AgentInvocation`
- define `EventLog`
- define `Visibility`

### Output

- one shared domain types module

### Acceptance

- all later runtime code imports these shared types
- no duplicate business types appear in random files

---

## Workstream 3: Persistence Layer

### Tasks

- choose v1 local persistence strategy
- implement thread store
- implement message store
- implement invocation store
- implement session store
- implement event log store

### Output

- local development persistence with clear separation by resource

### Acceptance

- resources are stored separately enough that later migration is possible
- messages are not used as a substitute for event logs

---

## Workstream 4: Agent Registry

### Tasks

- define initial cat roster
- map `@cat` aliases to `AgentProfile`
- provide a resolution function for mentions

### Output

- seeded profiles for v1 cats
- deterministic mention resolution

### Acceptance

- invalid mentions fail clearly
- valid mentions resolve without touching runtime execution logic

---

## Workstream 5: Invocation Runtime

### Tasks

- accept a message submission
- parse mention and task body
- find or create session
- create invocation
- connect invocation to runner
- emit runtime events
- assemble visible output

### Output

- one end-to-end runtime path for single-agent execution

### Acceptance

- an invocation record exists before visible output is appended
- invocation state moves through `queued -> running -> completed|failed`

---

## Workstream 6: Event Streaming

### Tasks

- define SSE event payloads
- stream invocation status to client
- stream visible text safely
- prevent raw private logs from entering public stream

### Output

- minimal runtime streaming channel

### Acceptance

- frontend can render current invocation state
- private runtime events remain private

---

## Workstream 7: Minimal UI Shell

### Tasks

- create thread list shell
- create center message stream shell
- create minimal runtime panel shell
- create input box with `@cat`

### Output

- smallest usable interface for Phase 2

### Acceptance

- UI exists only to validate the runtime flow
- no advanced control panels or statistics are added

---

## Suggested Order

1. project skeleton
2. domain types
3. persistence layer
4. agent registry
5. invocation runtime
6. event streaming
7. minimal UI shell

---

## Risks To Watch

- reintroducing `Conversation` as the main model
- mixing runtime events into public messages
- building frontend state before backend truth exists
- adding session chain concepts before single-session flow is stable
- copying FMA product assumptions instead of only reusing its runtime techniques

---

## Definition Of “Ready For Phase 2”

Phase 1 is ready to hand off only if:

- a thread can be created
- a message with `@cat` can be submitted
- an invocation is stored
- a session is selected
- runtime events are recorded
- one visible reply can be produced safely

If any of these is missing, Phase 2 has not actually started.
