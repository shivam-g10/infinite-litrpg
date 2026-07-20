# ADR-012 Luna Narration and Compact Live Prompts

- Status: Accepted
- Date: 2026-07-20
- Supersedes: ADR-003 and ADR-008 for chapter narration; ADR-009 for target and recovery bounds
- Superseded in part by: ADR-013 for cache policy, audit grounding, recovery upper bound, and failed-candidate evidence

## Context

Prompt `1.4.9` established the paid baseline before this behavior change. Four Terra chapters passed. Maelin chapter 1 then returned 812 words after `$0.030771625` of chapter exposure, and a full Terra retry could not fit. Conservative global exposure reached `$2.735142975`, leaving `$0.264857025` for release proof.

Routing the four valid narration usages through Luna would average `$0.0223287875`; twelve unchanged chapters would cost `$0.26794545` before the heavier three-agent mix. Seed background-agent instructions measured 5,162 to 5,572 bytes each, and frame prompts measured 5,387 to 5,821 bytes.

## Decision

- Luna becomes the primary chapter narrator. Terra remains the bounded custom-action translator. Sol routing is unchanged.
- Narration and audit remain separate calls. The narrator receives only the canon whitelist. The auditor additionally receives forbidden detection context and still owns no state.
- Background-agent and frame inputs use labeled maps and tuples that preserve every supplied POV and public-world value. Maximum background agents remains three.
- Narration targets 900 to 925 words. The absolute 900 to 1,300 word contract is unchanged.
- A draft with 800 to 899 words may use one tail-only Luna continuation only when word count is its sole deterministic failure. The request remains at most 1,200 bytes, has no retry, and uses at most 230 output tokens based on the exact missing-word range.
- Merged prose reruns every deterministic gate and the full independent audit before hash, replay, or atomic commit.
- Current writes require prompt `1.4.10`. Persisted reads accept authenticated `1.4.9` and `1.4.10` deltas, intents, and traces only when every nested prompt version matches the trace.
- Prompt version becomes `1.4.10`. The old four Terra results remain baseline evidence but do not count toward release. The durable ledger folds exact `$2.735142975` exposure into a fresh twelve-cycle matrix.

## Reason

Luna cuts narration price to 40 percent of Terra at equal usage. Lossless context compaction and the shorter target add headroom without reducing agents, canon, schema, audit, word-count, replay, or atomicity gates. A fresh matrix proves the actual release route across all six viewpoints.

## Consequences

- Seed agent instructions are 4,083 to 4,374 bytes and frame prompts are 4,293 to 4,608 bytes.
- A live-shaped three-agent 812-word recovery regression commits under `$0.0405` without the input-token counting fallback.
- Narrator and auditor use the same model, so human review remains required for correlated prose and audit mistakes.
- Traces still record exact model, attempt, usage, cost, response, prompt, fixture, schema, and Git provenance.
- Any failed paid run is archived and reconciled before another request. The `$3` global cap does not change.
