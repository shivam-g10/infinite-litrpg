# ADR-018: Replace rejected prose without regenerating canon

## Status

Accepted on 2026-07-20.

## Context

The strict settled receipt preserves a complete twelve-result matrix, but human review rejects Rowan chapter 2, Elara chapter 1, and Lucan chapter 1. Regenerating their action, background intents, world delta, or chapter frame would change accepted canon and would also discard dependent chapters. Durable exposure is `$2.959276675`; only `$0.040723325` remains under the `$3` live cap.

## Decision

- Re-narration accepts one authenticated canonical source: before and after state, selected-POV action, full accepted intent list, accepted world delta, application-owned frame, adapter evidence, and Multi-agent output items.
- Deterministic validation parses both states, restages the exact delta, checks the player intent, locks the viewpoint and versions, and validates the frame before creating a provider budget.
- Re-narration runs no action translation, background agent, frame, state-writer, or store commit. It invokes only Luna narration, the existing bounded short-draft recovery when needed, and the full independent Luna audit.
- Narration, recovery, and audit use reasoning `none`. The audit is independently generated and capped at 64 output tokens. A prior `low` experiment consumed reasoning tokens without completing inside the bounded audit response. Every call records its actual reasoning effort.
- The replacement must keep the exact canonical-source hash. That hash binds state, state hashes, action, intents, delta, frame, fact partitions, chapter identity, fixture, adapter mode, Multi-agent items, and safe-context hash. Only prose, audit, usage, cost, latency, request ID, turn ID, trace calls, and stream evidence may change.
- The live report keeps all twelve cells, including later chapters. Each target records exact source and replacement turn IDs, request IDs, prose hashes, and canonical hash. A source turn becomes superseded only after its replacement validates.
- The sidecar stores each complete replacement as a write-ahead checkpoint before the report update. Stale recovery accepts only an append-only exact extension, applies validated replacement checkpoints without provider replay, writes a reconciliation report, and requires a normal registered resume for more provider work.
- The exact three-target run uses a `$0.0135` per-target ceiling. Its hard maximum new exposure is `$0.0405`; projected final exposure is `$2.999776675`, leaving `$0.000223325`. Preflight rejects the entire plan before client creation if prior spend, retained attempts, target count, or cap would exceed `$3`.
- No paid re-narration runs without a clean registered checkpoint and fresh authorization for the exact command.

## Consequences

- Corrected prose cannot alter accepted world or knowledge state.
- Elara chapter 2 and Lucan chapter 2 remain valid instead of being regenerated after their chapter 1 prose changes.
- Human review remains authoritative. Automated audit approval only makes a replacement eligible for new packets and another human review.
- A target may exhaust its `$0.0135` ceiling before producing eligible prose. This fails safely with exact spend evidence; gates are not weakened.

## Rejected alternatives

- Regenerate rejected suffixes. It changes canon, discards valid dependent chapters, and cannot fit the remaining conservative exposure.
- Edit prose by hand. It would bypass Responses evidence, audit, replay, and trace gates.
- Raise the global cap or lower quality gates. Both violate the fixed release eval.
