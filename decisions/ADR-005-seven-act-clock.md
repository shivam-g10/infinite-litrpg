# ADR-005 Seven-Act Clock

- Status: Accepted
- Date: 2026-07-19

## Decision

Use seven acts of at most 50 chapters. Raise convergence pressure from chapter 40 of each act. Force transition at chapter 50. Start final campaign at 301. Chapter 350 terminal. Reject 351 before API call.

## Reason

Finite deadlines make long-run progress measurable and prevent endless generation drift.

## Consequences

- Choice generator must honor arc constraints.
- Long-horizon checkpoint eval is mandatory.
