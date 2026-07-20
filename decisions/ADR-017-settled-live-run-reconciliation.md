# ADR-017: Reconcile settled live runs without losing evidence

## Status

Accepted on 2026-07-20.

## Context

The authorized selective resume retained all paid source evidence, discarded five human-rejected canonical result suffixes, and started a replacement Rowan chapter 2. Two narration candidates and seven provider attempts settled for `$0.01183`.

Final report validation then failed because source candidates from discarded slots were still treated as candidates for the replacement canonical chain. The normal-run finalization flag also started as committed, so the ledger lock was released even though no final report was written. The sidecar and seven known ledger reservations survived, but the source report remained unchanged.

Human review also found a deterministic narration gap. The validator rejected `mana ... sixteen of eighteen` but missed `reserve lessen from eighteen to sixteen` while canon kept mana at `18/18`.

## Decision

- Paid evidence stays append-only.
- A current version 9 resume records an exact source evidence boundary. `supersededTurnIds` must come from that authenticated source prefix. Current-run turns cannot be mislabeled as old evidence to bypass canon checks.
- A recovered finalization failure records a separate `settledFailure`: checkpoint ID, run ID, sidecar hash, attempted rerun suffixes, and the exact uncommitted evidence turn. Its evidence must be the complete suffix after the source boundary and cannot satisfy a committed result.
- The failed replacement committed no canon. The receipt therefore keeps all twelve source results, all 98 attempts, and all raw evidence. Only the new Rowan turn is a settled failure; the five source suffixes stay reusable until valid replacements commit.
- A run lock is released only after the final strict report is atomically written. Normal and recovery runs start with `reportCommitted: false`.
- If a process dies after the atomic report rename but before lock release, the exact `--recover-stale-run` command takes a provider-free finalization path before API-key loading. It requires a current strict report, the exact same-run sidecar, exact evidence arrays and metadata, a dead owner, zero active reservations, same-run reservation ownership, exact known and uncertain row counts, and an exact durable snapshot. It only deletes the lock; it never rewrites the report or changes exposure.
- A released run with only known reservations may be reclaimed by its exact run ID through a tracked settled-run checkpoint. The checkpoint binds source report, sidecar hash and counts, append-only suffix, seven reservation rows, service tier, Git source, rerun suffixes, and bridge hashes.
- Settled reconciliation loads no API key and makes no provider request. It writes one strict failure report, verifies it, then releases the reclaimed lock. A crash retry authenticates an existing atomic report before idempotently releasing the same exact run. Any mismatch retains the lock.
- Narrative state validation now compares explicit health and mana transitions with the canonical before-to-after transition. It covers number words, reverse and single-target forms, trailing resource names, common depletion verbs, and scoped ownership. Denials, hypotheticals, remote-character resources, and resource-cost comparisons remain non-canon text.

## Consequences

- Old rejected prose and all spend remain auditable without poisoning current canon.
- The `$0.01183` paid suffix can enter the next resume baseline without another provider call.
- The recovered Rowan prose is not promoted to a result. Automated acceptance cannot override the observed human canon defect.
- Existing version 9 reports and sidecars default new provenance fields safely. Reports without authenticated source boundaries cannot supersede evidence.
- A committed report with uncertain provider usage remains recoverable. The exact snapshot keeps the conservative maximum exposure charged.

## Rejected alternatives

- Delete old candidates or responses. This loses paid evidence.
- Overwrite the source report. This destroys the authenticated checkpoint.
- Promote the last Rowan candidate. Human review rejects its invented mana spend.
- Run another paid command before reconciliation. The ledger and report baselines would disagree.
