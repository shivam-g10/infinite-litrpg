# ADR-003 GPT-5.6 Routing

- Status: Superseded in part by ADR-008
- Date: 2026-07-19

## Decision

- Sol: world genesis, act recovery, finale.
- Terra: choice planning and chapter narration. ADR-008 moves validated chapter frames to Luna.
- Luna: character intents and chapter fact audit.
- Responses API only. Reject every non-GPT-5.6 model ID.

## Reason

Role routing preserves quality where valuable and controls repeated chapter cost.

## Consequences

- Exact effort stays baseline until eval data supports change.
- Usage and cost displayed per call.
- No cross-family fallback.
