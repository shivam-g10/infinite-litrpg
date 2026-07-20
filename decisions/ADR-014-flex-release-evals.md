# ADR-014 Flex Release Evals

- Status: Accepted
- Date: 2026-07-20
- Supersedes: ADR-013 for release-eval service tier and cost projection only

## Context

The first fresh prompt `1.4.11` run was interrupted by the local shell timeout during a narration retry. Exact evidence reconciliation retained three known attempts and charged the unknown request at its full reservation. Durable exposure reached `$2.811082175`; remaining headroom is `$0.188917825`.

The earlier `$0.207336` Standard projection used the cache-write rate for saved ordinary input. The corrected no-cache projection is `$0.208988`, which no longer fits. Removing calls or reducing chapters, agents, audits, or prose limits would change release behavior.

## Decision

- Release live evals use explicit Responses Flex processing.
- Product runtime defaults to Standard. Flex requires an explicit eval-owned setting.
- The selected tier is part of request construction, cost estimation, reservation, settlement, attempt and trace evidence, report provenance, and pricing version.
- The full twelve-cycle suite, six POVs, model IDs, prompts, strict schemas, maximum three background agents, audit loop, 900-to-1,300-word gate, and 60-second p95 gate stay unchanged.
- A Resource Unavailable 429 follows official no-charge semantics only when the provider error is identified exactly. All ambiguous transport failures retain their full reservation.
- One full live run may start only after code reproduces the `$0.104494` projection from exact inputs, every non-live gate passes, an independent review finds no blocker, a clean commit passes clean-clone verification, and durable exposure still equals `$2.811082175`.
- Never retry the full run automatically.

## Implementation

- Runtime schema `1.1.0-runtime-candidates-5` records requested and observed tier on attempts and calls.
- Live report version 9 requires tier-specific pricing, the exact matrix projection, complete current service-tier evidence, and Flex for the full suite. Versions 5 through 8 remain readable as historical Standard evidence.
- Durable ledger version 2 stores tier per reservation. Its version 1 migration assigns Standard to historical rows and verifies exposure is unchanged before commit.
- The full npm script selects Flex. Product runtime and smoke keep explicit Standard defaults.

## Reason

Flex halves token prices while keeping the same Responses API and GPT-5.6 models. It preserves the evaluated behavior and leaves `$0.084423825` projected budget margin.

## Consequences

- Flex can be slower or temporarily unavailable. The existing latency gate reports that risk instead of hiding it.
- Runtime evidence can prove that provider requests, pricing, and returned service tier agree.
- Standard product cost displays remain unchanged unless the caller explicitly selects another supported tier.
- Organization usage remains unavailable. The durable local ledger stays conservative and authoritative.
