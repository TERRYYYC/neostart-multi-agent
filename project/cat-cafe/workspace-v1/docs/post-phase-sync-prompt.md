# Post-Phase Sync Prompt

Use the following prompt after completing a project phase, especially after finishing `Phase 1`.

```text
You are working on the `cat-cafe v1` project.

Active workspace:
/Users/terry/Desktop/code code/project/cat-cafe/workspace-v1

This task is not to build new features.
This task is to synchronize project documentation after phase completion.

Before making any changes, read these files first:
1. /Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/AGENTS.md
2. /Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/docs/cat-cafe-v1-architecture.md
3. /Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/docs/implementation-checklist.md
4. /Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/docs/phase-1-task-breakdown.md
5. /Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/docs/status.md
6. /Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/docs/adr/README.md

Your job:
- inspect the current implementation under `/Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/src`
- determine what Phase 1 work is actually complete
- update the documentation so it matches the real codebase

Required documentation sync tasks:
1. Update `/Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/docs/status.md`
   - mark what is completed
   - mark what is in progress
   - set the next recommended task or next phase
   - add blockers if any

2. Update `/Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/docs/implementation-checklist.md`
   - mark whether Phase 1 is truly complete
   - if Phase 1 is complete, switch the active phase to Phase 2
   - update allowed work and forbidden work if phase changed

3. Review `/Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/docs/phase-1-task-breakdown.md`
   - mark which workstreams are complete
   - note which items are partial
   - do not rewrite history; reflect actual completion only

4. If Phase 1 is complete, create `/Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/docs/phase-2-task-breakdown.md`
   - define the concrete scope for the minimal vertical slice
   - keep it aligned with the architecture baseline

5. If new architectural decisions were made during implementation, add ADR files under:
   - `/Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/docs/adr/`

Rules:
- Do not claim completion for work that is not present in code.
- Do not silently change the architecture baseline unless implementation forced a real architectural decision.
- If architecture changed, update the relevant docs explicitly and explain why.
- Do not build new product features in this task unless a tiny code inspection fix is required to accurately sync docs.

Expected output:
- a brief summary of what Phase 1 actually accomplished
- which docs were updated
- whether the project is ready for Phase 2

Current synchronization target:
[Replace this line with: "Phase 1 completed, please sync docs" or a more specific milestone]
```

