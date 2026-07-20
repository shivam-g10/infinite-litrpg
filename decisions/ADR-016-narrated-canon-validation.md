# ADR-016 Narrated Canon Validation

- Status: Accepted
- Date: 2026-07-20

## Context

The completed prompt `1.4.11` Flex matrix passed every deterministic and model-audit gate. Human review still rejected three chapters:

- Rowan chapter 2 spent two mana in prose while accepted canon kept mana at `18/18`.
- Elara chapter 1 entered Aurelis Capital while accepted movement ended on Capital Road.
- Lucan chapter 1 put Aurelis Capital ahead after leaving it and attributed Lucan's private coup plan to Varek.

These are release-blocking contradictions. They do not require a broader model prompt change. The existing narrator prompt already forbids uncommitted state changes and unsupported canon.

## Decision

- Validate explicit POV health and mana snapshots against the before and prospective states.
- Reject strong arrival claims for locations other than the committed destination.
- When movement occurs, reject prose that treats the departed location as the destination ahead.
- Reject a POV-owned private fact when prose preserves its stable predicate but assigns it to another named character.
- Run the same validator before model audit and again inside the atomic store transaction.
- Keep checks narrow. Human review remains authoritative for semantic claims outside these deterministic patterns.
- Keep prompt `1.4.11`, runtime schema `1.1.0-runtime-candidates-5`, and report version 9. Version 9 resume metadata gains backward-compatible `rerunFrom` provenance; older version 9 reports parse it as an empty list.
- Resume only rejected chapter suffixes from an authenticated complete pair. Retain valid chapter 1 when rejection starts at chapter 2. Preserve every prior attempt and its cost.

## Reason

The accepted `WorldDelta` is the only source of new canon. Explicit prose that disagrees with staged state must never reach audit or storage. Narrow checks close observed defects without pretending arbitrary narrative semantics can be solved by regular expressions.

## Consequences

- The exact Rowan, Elara, and Lucan defects have deterministic, service, and atomic-store regressions.
- The old report remains the authenticated behavior baseline and paid-attempt ledger source.
- A selective resume keeps seven accepted chapters and reruns five: Rowan chapter 2, both Elara chapters, and both Lucan chapters.
- The five previously accepted paths cost `$0.044674`, which is `$0.007879325` below current headroom. This is not a worst-case proof: five chapter ceilings project `$3.159446675`. The durable request ledger must stop before `$3` if new retries consume the margin.
- The global durable ledger remains the spending authority. Another paid resume needs a clean registered checkpoint and explicit user authority.
