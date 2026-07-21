# ADR-022: Long-Form Quality Variant

- Status: Accepted
- Date: 2026-07-21

## Context

The first authorized ten-chapter run committed Rowan chapters 1 through 10, then failed Elara chapter 1 three times. Elara prose repeatedly treated departed Aurelis Capital as the destination ahead. The prompt exposed before and after locations but did not name their direction. The existing generic re-narration movement instruction had already failed on the same route.

The first-offered-choice branch also produced weak progression. Rowan alternated repeated investigation and skill actions, then asked Nyra similar questions for five chapters. Those chapters passed deterministic and model audits but are not good human-review evidence.

Durable story-review exposure is `$0.1635525`. No request is active or uncertain. Old failed traces can overlap attempts restored into a later committed trace, so raw trace totals cannot be summed without deduplicating response IDs.

## Decision

- Bump the prompt to `1.4.12`. Preserve `1.4.11` as a persisted historical version.
- For a viewpoint move, send exact departed and destination IDs and names plus this positive direction: start in departed, travel away, end in destination, and keep departed behind.
- Select the offered choice by this deterministic order: avoid the immediately previous action type, least prior use of action type, least prior use of the exact action, then offered order.
- Reject the old Rowan and Elara branches for final progression review. Restart all six viewpoints from chapter 1 under one source variant.
- Archive every old story database before restart. Hash every file. Record committed and failed run IDs. Deduplicate response IDs and require their total cost to equal durable ledger exposure.
- Bind the archive manifest hash into the new ledger source ID and the final source evidence. Fold the exact old exposure into fresh prior spend. Never delete or reclaim it.
- Permit only the explicitly authorized cap transition from `$2.544` to `$5.088`. Set the uninterrupted chapter-chain cap to `$0.0848`. Keep zero active reservations as a migration precondition.
- Keep migration provider-free and idempotent. A partial archive or stale migration lock must resume without moving or charging data twice.

## Consequences

All final review chapters share prompt `1.4.12`, one branch policy, one source Git SHA, and one hash-bound cost lineage. The final packet cannot mix the rejected branch with replacement chapters. The larger cap improves retry headroom but remains a hard ceiling; it does not weaken audit, canon, POV, word-count, or atomic-commit gates.
