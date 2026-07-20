# ADR-009 Bounded Luna Length Recovery

- Status: Superseded by ADR-012
- Date: 2026-07-19

## Context

The prompt `1.4.7` paid baseline produced an otherwise-valid 848-word Terra draft. The absolute chapter contract requires 900 to 1,300 words. A full Terra regeneration could not reserve safely after the first draft, while deterministic padding would create prose without an audit trail.

## Decision

- Terra targets 975 to 1,000 words with a 1,400-token output cap.
- Recovery is allowed only when the raw draft has 840 to 899 words and word count is its sole deterministic failure.
- Luna receives at most 1,200 bytes containing only the ending excerpt and the exact missing-word range.
- Luna may return one continuation of at most 140 output tokens with no retry.
- The continuation cannot introduce any new action, event, entity, dialogue, mechanic, fact, relationship, cause, discovery, decision, time passage, or state change.
- The merged prose reruns every deterministic gate and the independent full narrative audit before hash, replay, or atomic commit.

## Reason

This preserves the unchanged 900 to 1,300 word gate, keeps hidden canon out of recovery context, and bounds the maximum recovery reservation at `$0.00298`. A live-shaped three-agent regression with two rejected frame candidates commits at `$0.0332095` under the `$0.05` chapter cap.

## Consequences

- Recovery output and usage appear as a separate Luna `recovery` trace attempt.
- Only final audited prose is hashed, stored, and replayed.
- Any second validation failure falls back to the existing safe full regeneration path when budget permits.
- No deterministic padding or unaudited prose is accepted.
