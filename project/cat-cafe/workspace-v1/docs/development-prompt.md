# Development Prompt Template

Use the following prompt as the default start for each new implementation session.

```text
You are working on the `cat-cafe v1` project.

Active workspace:
/Users/terry/Desktop/code code/project/cat-cafe/workspace-v1

Before doing any implementation work, read these files first:
1. /Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/AGENTS.md
2. /Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/docs/cat-cafe-v1-architecture.md
3. /Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/docs/implementation-checklist.md
4. /Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/docs/phase-1-task-breakdown.md
5. /Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/docs/status.md

Project rules:
- Work only inside `/Users/terry/Desktop/code code/project/cat-cafe/workspace-v1` unless explicitly told otherwise.
- Do not modify `/Users/terry/Desktop/code code/project/fma`; it is reference-only.
- Respect the current phase boundary.
- Do not implement full configuration center, automatic session chain/handoff, export, voice, notifications, long-term memory, advanced statistics, or multi-hop A2A unless explicitly requested.
- Do not bypass the core model: all agent execution must go through `Thread`, `Message`, `AgentInvocation`, `AgentSession`, and `EventLog`.
- Keep `Message` and `EventLog` separate.
- Only use `public`, `private`, and `system-summary` as visibility values unless the architecture docs are updated first.

Execution instructions:
- First summarize the current phase, the current task, and the exact files you plan to modify.
- Then implement only the smallest end-to-end change needed for this task.
- After changes, verify the result and update `/Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/docs/status.md` if the project status or next recommended step changed.

Current task:
[Replace this line with the concrete task for this session]
```

