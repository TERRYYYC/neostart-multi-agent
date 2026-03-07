# ADR Guide

## Purpose

This folder stores Architecture Decision Records for `cat-cafe v1`.

Use ADRs to record decisions that should not be re-litigated in every coding session.

Examples:

- why `Thread` is the top-level boundary
- why `Message` and `EventLog` are separate
- why v1 visibility values are fixed
- why Phase 2 excludes configuration center and session chain automation

## File Naming

Use simple sequential names:

- `ADR-001-thread-is-primary-boundary.md`
- `ADR-002-message-eventlog-separation.md`
- `ADR-003-v1-visibility-model.md`

## Suggested Template

```md
# ADR-XXX: Title

## Status

- proposed | accepted | superseded

## Context

What problem or uncertainty existed?

## Decision

What was decided?

## Consequences

What becomes easier, harder, allowed, or forbidden because of this decision?

## Related Files

- absolute/path/to/file
```

## Rule

If a coding task would change a previously accepted architectural decision, update or supersede the ADR explicitly.
Do not silently drift away from the decision.

