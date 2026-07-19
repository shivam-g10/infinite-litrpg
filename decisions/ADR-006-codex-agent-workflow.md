# ADR-006 Codex Agent Workflow

- Status: Accepted
- Date: 2026-07-19

## Decision

Root GPT-5.6 Sol Ultra owns implementation. Maximum three direct subagents. Use them for bounded research, eval execution, and review. Root remains default sole writer.

## Reason

Read-heavy delegation saves context and time. Parallel writers create conflicts and token waste.

## Consequences

- `agents.max_threads = 4` and `agents.max_depth = 1`.
- Researcher and reviewer are read-only.
- Evaluator reports failures but never fixes or weakens gates.
