# AGENTS.md

## Purpose

This folder is the active implementation workspace for `cat-cafe v1`.

If you are coding inside this folder, your job is to implement `cat-cafe v1` based on the architecture baseline in:

- `/Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/docs/cat-cafe-v1-architecture.md`

Do not treat `project/fma` as the active project.
`project/fma` is reference material only.

---

## Current State

Phase 1 (runtime foundation) is **complete**. All 7 workstreams delivered and verified.

The project is now ready for **Phase 2** (minimal vertical slice).

**Before doing anything, read these documents in order:**

1. `docs/status.md` — current phase, what's done, what's next
2. `docs/cat-cafe-v1-architecture.md` — the architecture baseline
3. `docs/implementation-checklist.md` — what's allowed vs forbidden
4. `docs/source-map.md` — every file in `src/`, what it does, key exports

---

## Hard Rules

### 1. Respect phase boundaries

Before Phase 2 is complete, do not implement:

- full configuration center
- automatic session chain / handoff
- export
- voice
- notifications
- long-term memory
- advanced statistics panels
- multi-hop A2A

### 2. Stay inside this workspace

Default working directory for implementation should be:

- `/Users/terry/Desktop/code code/project/cat-cafe/workspace-v1`

Do not modify:

- `/Users/terry/Desktop/code code/project/fma`
- other unrelated project folders

unless the user explicitly asks for it.

### 3. Do not skip the invocation model

Any agent execution feature must be modeled through:

- `Thread`
- `Message`
- `AgentInvocation`
- `AgentSession`
- `EventLog`

Do not implement a shortcut that sends model output directly into the UI without an invocation record.

### 4. Keep public and private data separate

Public chat stream must only show:

- public user messages
- public agent replies
- selected system-summary content

Private runtime events must not be rendered directly in the main message list.

### 5. Visibility values

Only `public`, `private`, and `system-summary` are valid visibility values. Do not introduce new values without updating the architecture doc first.

---

## Tech Stack

- TypeScript full-stack monorepo
- Backend: Node.js + Express (port 3001)
- Frontend: single-file React SPA (CDN, no build step in Phase 1)
- Persistence: JSON file-based (`data/` directory)
- Streaming: SSE via in-process event bus
- ID generation: nanoid

---

## How To Run

```bash
cd /Users/terry/Desktop/code\ code/project/cat-cafe/workspace-v1
npm install
npx tsx src/server/main.ts
# Open http://localhost:3001
```

Server bootstraps automatically: seeds agent profiles → loads registry → starts HTTP.

---

## Recommended Workflow

1. Read the documents listed in "Current State" above.
2. Map the requested task to the current project phase.
3. Prefer narrow, end-to-end changes over broad scaffolding.
4. Reuse runtime ideas from `fma` carefully, but do not copy over its product model blindly.
5. Keep disposable experiments under `tmp/` and do not build final product code on top of spikes.
6. After changes, run `npx tsc --noEmit` to verify types.
7. Update `docs/status.md` if the project status or next recommended step changed.

---

## File Intent

- `docs/`: architecture, ADRs, build notes, source map
- `src/shared/`: domain types and utilities shared by server and client
- `src/server/`: backend code (persistence, registry, runtime, streaming, API, entry point)
- `src/client/`: frontend (currently single-file `index.html`)
- `tmp/`: throwaway tests, scratch notes, generated artifacts
- `data/`: runtime data files (auto-created, gitignored)

---

## If Unclear

When a requested change would cross the agreed phase boundary, stop and say so clearly.
Default to protecting the architecture and implementation order rather than guessing.
