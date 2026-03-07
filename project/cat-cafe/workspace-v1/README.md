# cat-cafe workspace-v1

This directory is the isolated implementation workspace for `cat-cafe v1`.

Purpose:

- keep new implementation work separate from `project/fma`
- keep analysis files separate from runnable code
- give coding agents one narrow working area

Rules:

- read [cat-cafe-v1-architecture.md](/Users/terry/Desktop/code code/project/cat-cafe/workspace-v1/docs/cat-cafe-v1-architecture.md) before coding
- do not treat `/Users/terry/Desktop/code code/project/fma` as the active worktree
- use `project/fma` only as a reference source for reusable runtime ideas
- do not edit files under `project/fma` unless explicitly requested
- do not implement features outside Phase 1 or Phase 2 unless explicitly requested

Suggested workspace structure:

- `docs/` architecture and implementation notes
- `src/` actual implementation
- `tmp/` scratch output and disposable experiments

