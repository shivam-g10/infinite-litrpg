# ADR-015 Short Narration Recovery

- Status: Accepted
- Date: 2026-07-20
- Supersedes: ADR-012 and ADR-013 for recovery eligibility and deterministic acceptance only

## Context

The first paid Flex matrix produced Elara drafts of 789, 850, and 768 words. The 850-word draft received a coherent 91-word continuation and formed a valid 941-word chapter. Recovery still rejected it because the requested 900-to-925 target was also used as a hard continuation ceiling of 75 words.

The report is the behavior baseline. It completed both Rowan chapters, spent `$0.029972`, and left the durable ledger at `$2.841054175` exposure with `$0.158945825` headroom.

## Decision

- A 750-to-899-word draft may use one tail-only Luna continuation when word count is its sole deterministic failure.
- The model-facing request still targets a 900-to-925-word merge. Its instructions, JSON fields, byte cap, retry count, and token cap stay unchanged.
- Deterministic acceptance allows a merged chapter through 949 words. A continuation below 900 total words or above 949 is rejected.
- Accepted prose reruns the unchanged 900-to-1,300-word validator and the full independent canon and POV audit before commit.
- Recovery evidence stores the actual deterministic acceptance ceiling. Source Git SHA distinguishes retained old behavior from new behavior.
- Prompt `1.4.11`, runtime schema `1.1.0-runtime-candidates-5`, and report version 9 stay unchanged because no model-facing template or persisted shape changed.
- The failed report must be hash-registered before resume. Never resume automatically.

## Reason

The request target guides concise output. It is not the chapter contract. A small deterministic overshoot is safe when the final chapter still passes every existing validator and audit.

## Consequences

- The exact 850 plus 91 defect now reaches full validation and audit as a 941-word candidate.
- Drafts of 768 and 789 words can use the same bounded recovery path. A 749-word draft cannot.
- The absolute chapter limit, canon rules, POV boundary, one recovery attempt, and atomic commit stay unchanged.
- Another paid attempt requires a reviewed clean checkpoint and explicit user authority.
