# ADR-011 Durable Live Eval Budget

- Status: Accepted
- Date: 2026-07-20

## Context

The prompt `1.4.9` version 6 resume retained Rowan's pair and committed Elara chapter 1. Elara chapter 2 spent `$0.03383925`, then its audit reservation missed the `$0.0405` chapter cap. Cumulative conservative generation exposure reached `$2.6656366`, leaving `$0.3343634` under the `$3` POC cap.

The old pair-only resume would discard valid Elara chapter 1. Ten pending chapters require a cap no higher than `$0.03343634`, but retained Rowan chapter 2 cost `$0.038406625`. No single safe cap exists. Retaining Elara's valid prefix leaves nine pending chapters and `$0.037151489` average headroom, but a static per-chapter projection still cannot express safe settlement of cheaper requests.

## Decision

- Use report version 7.
- Retain authenticated contiguous chapter prefixes, not pairs only.
- Rebuild a retained chapter 1 from the seed state, player intent, accepted delta, and both trace state hashes before generating chapter 2.
- Preserve each retained result's source Git SHA and chapter cap.
- Store cumulative live generation exposure in SQLite integer nano-USD.
- Acquire one durable run lock.
- Reserve each request maximum in an immediate transaction before provider transport.
- Settle returned usage to estimated actual cost before model-output validation.
- Keep the full reservation for timeout, transport failure, missing usage, or interruption.
- Refuse any new request whose reservation could push cumulative exposure above `$3`.
- Write the report through a temporary file and atomic rename after every committed chapter and at run end.
- Pin every legacy runtime bridge file by SHA-256 in the tracked checkpoint registry.

## Reason

This preserves valid paid evidence and makes the global limit independent of process memory, report-write timing, mixed chapter caps, and retries. A failed or interrupted run cannot silently reclaim uncertain exposure.

## Consequences

- The static suite projection remains evidence but may exceed `$3`; request-level reservations are authoritative.
- A stale run lock is a deliberate stop. Provider reconciliation is required before recovery.
- A dead owner with zero active reservations may transfer its lock only through the explicit old run ID. Baseline reconciliation still runs before provider transport. A live owner, active reservation, wrong ID, or omitted exposure fails closed.
- The ledger bounds locally estimated Responses generation exposure. It does not prove the provider invoice because the configured key lacks organization usage access and input-token count billing is unknown.
- Actual usage above a conservative reservation is recorded, aborts before canon commit, and fails the total-cost gate.
- Every failed version 7 report must be archived, hashed, registered, and committed before resume.
- All live suites share one global ledger. A fresh suite can rotate chains only by supplying prior spend exactly equal to current durable exposure.
