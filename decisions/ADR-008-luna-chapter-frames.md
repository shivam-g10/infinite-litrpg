# ADR-008 Luna Chapter Frames

- Status: Accepted
- Date: 2026-07-19
- Supersedes: ADR-003 for chapter-frame generation only

## Context

Prompt `1.4.6` established a paid baseline before this routing change. A Terra narration completed, but the strict Luna audit could not start because the chapter had `$0.023394` left and the audit reservation was `$0.024960`. Repeating a Terra choice-frame call consumed budget without changing canon safety.

Chapter frames contain only a title, terminal flag, and at most two next choices. Strict schemas plus deterministic hidden-fact, action-target, milestone, and choice-distinctness validators reject unsafe output before narration or commit.

## Decision

- Luna generates strict chapter frames.
- Terra remains the custom-action translator and chapter narrator.
- Luna remains the background-intent and narrative-audit model.
- Sol routing is unchanged.
- The full live suite retains the maximum-three background-agent configuration.

## Reason

Luna lowers repeated structured-output cost while deterministic validation owns frame correctness. Terra remains on the prose path where quality matters most. The change creates enough safe reservation for narration plus audit under the remaining POC budget without weakening an eval or canon gate.

## Consequences

- Prompt `1.4.7` requires a fresh clean-checkpoint live report.
- Trace and service regressions assert Luna frame, Terra narration, and Luna audit routing.
- Architecture and cost evidence must name the split routing.
- Invalid frames still retry within the same strict response policy and never mutate canon.
