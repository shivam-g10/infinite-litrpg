# ADR-013 Grounded Audits and Complete Live Evidence

- Status: Accepted
- Date: 2026-07-20
- Supersedes: ADR-012 for cache policy, audit grounding, recovery upper bound, and failed-candidate evidence

## Context

The clean prompt `1.4.10` run committed Rowan chapter 1, then failed Rowan chapter 2. Four Luna drafts were short. Two bounded continuations missed their declared ranges. The final merged draft reached audit, but the auditor called Rowan's allowed reincarnation identity forbidden and named an unrelated hidden Void fact. Only accepted prose was retained, so the disputed claim could not be checked. Fifteen known attempts cost `$0.0512422`; global exposure reached `$2.786385175`, leaving `$0.213614825`.

Official OpenAI behavior also showed that implicit prompt caching charged a cache-write premium on unique first requests. Only repeated narration retries received cached reads. Repricing the recorded run with ordinary Luna input cost saves `$0.0014412` overall, but repeated failures become more expensive without cached reads.

## Decision

- Prompt version becomes `1.4.11`. Runtime trace schema becomes `1.1.0-runtime-candidates-4`. Canon contract version remains `1.1.0`.
- Every generation request uses explicit prompt-cache mode with no breakpoint. Reservations price input as ordinary uncached input. Input-token counting remains a read-only count request and does not set generation cache options.
- The audit candidate returns seven scores, seven evidence strings, and leak evidence containing a canonical fact ID plus an exact prose quote. Application code validates every zero-score quote, every leak quote, allowed fact IDs, and at least two significant anchors shared with the forbidden claim. It then derives leak IDs, issue codes, approval, and prose hash.
- A structurally valid but ungrounded audit retries against the identical prose. Three exhausted audit attempts end the turn as a non-retryable failure. They do not buy another narration.
- Recovery for an 800-to-899-word sole failure targets the complete 900-to-925 range. Merged prose still reruns the unchanged 900-to-1,300 contract and every deterministic and audit gate.
- Failed retry instructions carry only the prior word count, never rejected prose.
- Background models emit a compact strict object containing action type plus ordered arguments, exact goal, exact expected effect, and exact prerequisite arrays. Application code alone assigns actor, intent ID, contract, prompt, and state versions. The decoder reruns the unchanged canonical intent schema. Sequential agent calls keep the 256-token ceiling. Maximum three background agents remains unchanged.
- Frame models emit only compact title and ranked-option fields. Application code still owns actions, choice IDs, descriptions, targets, and terminal state.
- Model schemas use provider-supported object and homogeneous-array JSON Schema. Fixed Zod tuples are forbidden at the Responses boundary because the provider rejects their generated `items` arrays.
- Structured Responses output is captured raw before cost-bound output evaluation, local JSON parsing, and Zod parsing. Live report version 8 records every narration, recovery, and audit response; every narrative candidate; continuation; merged draft; word count; recovery range and verdict; parsed audit candidate; response ID; canon input; deterministic issue; adapter output; prompt/schema version; and Git provenance. One turn identity is created before model access and reused by attempts, candidates, failures, the committed chapter request, and the final trace. Every successful trace call, including intent and frame calls, must reproduce one retry group from attempts bound to that turn; nested audit and recovery attempts may interleave.
- Version 8 roots each result in full seed-derived before and after state, the accepted action, intents, delta, frame, fact partitions, committed chapter, exact stream chunks, usage, and state hashes. Deterministic restaging must reproduce the stored after-state. The accepted result must match exactly one candidate, and every candidate response must match one settled attempt. Release booleans are recomputed from this evidence instead of trusted as stored claims.
- An atomic ignored sidecar checkpoints raw response and attempt evidence before a known durable reservation settles, then adds candidate evidence before chapter commit. Multiple user-level retries of one pending chapter keep distinct request and turn IDs. A legacy-evidence start index survives transitive version 8 resumes. Stale recovery accepts only an append-only extension whose total equals durable settled exposure, keeps one stable run ID while atomically transferring PID ownership, and retains that lock until its reconciliation report commits. New sidecar evidence exits before replay or provider access; a later normal resume consumes the registered report. This evidence stays server-only.

## Reason

The next paid result must be adjudicable. Exact quote grounding prevents an auditor from attaching an unrelated hidden fact to allowed prose. Same-prose audit retry and aligned recovery attack the observed retry costs without dropping canon, agents, validation, or audit coverage. Explicit cache policy makes reservations match the chosen provider behavior.

## Consequences

- A failed live run now preserves enough evidence to reproduce and review every narrative rejection.
- A successful version 8 run preserves enough evidence to reproduce state transition, stream replay, response identity, and committed chapter independently of its summary booleans.
- Unique requests avoid the cache-write premium. Repeated identical retries lose cached-read savings, so retry removal remains mandatory.
- Historical version 7 reports stay strict and readable. Only new runs write version 8.
- Exact provider counts on the six-POV schedule plus the minimum structural output saving reduce the no-cache twelve-cycle projection from `$0.223732` to `$0.207336`. This fits `$0.213614825` headroom by `$0.006278825` before narration and audit prompt savings. No generation runs until full non-live gates, review, commit, and clean-clone verification pass.
