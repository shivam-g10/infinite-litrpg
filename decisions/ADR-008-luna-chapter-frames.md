# ADR-008 Luna Chapter Frames

- Status: Accepted
- Date: 2026-07-19
- Supersedes: ADR-003 for chapter-frame generation only

## Context

Prompt `1.4.6` established a paid baseline before this routing change. A Terra narration completed, but the strict Luna audit could not start because the chapter had `$0.023394` left and the audit reservation was `$0.024960`. Repeating a Terra choice-frame call consumed budget without changing canon safety.

Prompt `1.4.7` then showed that asking Luna to reproduce the entire frame was needless and brittle. Two returned titles exposed a hidden literal claim before the third attempt succeeded. The actions themselves were already constrained by deterministic validation.

## Decision

- Application code enumerates and validates legal choice options from prospective canon.
- Luna returns only a short title and up to two ranked option IDs.
- Application code owns terminal state, actions, choice IDs, descriptions, and milestone targets, then validates the final strict frame.
- Terra remains the custom-action translator and chapter narrator.
- Luna remains the background-intent and narrative-audit model.
- Sol routing is unchanged.
- The full live suite retains the maximum-three background-agent configuration.

## Reason

Luna supplies narrative preference without restating legal action structures. Deterministic code owns every field that can affect the next turn. Terra remains on the prose path where quality matters most. This reduces structured-output failures and cost without weakening an eval or canon gate.

## Consequences

- Prompt `1.4.8` requires a fresh clean-checkpoint live report.
- Trace and service regressions assert Luna option ranking, app-owned final choices, Terra narration, and Luna audit routing.
- Architecture and cost evidence must name the split routing.
- Unsafe titles and invalid candidate output still retry within the same strict response policy and never mutate canon.
