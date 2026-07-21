# Human Review Guide

## Fast no-cost review

Use a clean clone or a workspace with no `data/ashen-crown.db`.

```powershell
npm ci
npm run demo:seed
npm run dev
```

Open `http://127.0.0.1:3000`. The seed command restores authenticated Rowan chapter 1 from tracked evidence and makes no provider request.

Check:

1. Reader opens on Rowan with `Chapter 1 of 100` and the full chapter visible.
2. `Continue to next decision` is the only primary story action.
3. Opening it shows the exact chapter count, stop chapter, per-chapter cap, and worst-case total before `Start generation` appears.
4. Story and character details stay behind one disclosure.
5. God Mode shows intent, delta, audit, model, usage, cost, latency, and state hashes.
6. Desktop and phone widths have no horizontal overflow.
7. Markdown and Reader JSON exports contain no hidden canon.

Do not use the current one-chapter excerpts for progression signoff. They prove voice only. Final narrative review requires six contiguous ten-chapter stories.

The long-form gate must pass first:

```powershell
npm run review:stories:check
```

It currently fails until provenance-checked chapter-1-through-10 evidence exists for all six viewpoints. The tracked source artifact must contain every canonical chapter record, committed world delta, matching trace, and final state; the check rebuilds each state chain and the readable pack from those payloads. When green, read [SAMPLE_STORIES.md](SAMPLE_STORIES.md) in order. Compare each displayed chosen action with the following chapter, then complete each chapter progression table and story verdict.

For release review, use the complete authenticated [review packet set](review-packets/). Its manifest is `human-reviewed-rejected`: Rowan chapter 2, Elara chapter 1, and Lucan chapter 1 failed. The curated samples use different passing chapters and do not replace that rejected evidence.

## Chapter-100 behavior proof

This provider-free browser test starts at chapter 1, makes 99 mocked chapter requests, pauses for decisions after chapters 47 and 97, commits chapter 100, and proves no chapter-101 request occurs:

```powershell
npm run test:e2e -- --grep "continues routine chapters"
```

The stop test proves `Stop after this chapter` lets the active atomic request finish and starts no later request:

```powershell
npm run test:e2e -- --grep "stops an automatic run"
```

## Optional live generation review

The reproducible six-story review run is separate from interactive browser testing. Its no-provider preflight is:

```powershell
npm run review:stories:preflight
```

The exact paid command is authorized with a hard `$5.088` aggregate Responses generation-exposure ceiling across the rejected archived branch, 60 replacement chapters, and any resumed attempts:

```powershell
npm run review:stories:live -- --confirm-cost --chapter-cap-usd 0.0848 --total-cap-usd 5.088
```

It avoids an immediate repeated action type, then selects the least-used offered action type and exact action with stable offered-order ties. It retains up to three sequential background agents, checkpoints each atomic commit, and publishes only chapters whose runtime audit passed. The `$0.0848` chapter flag budgets one uninterrupted attempt chain plus known failed turns restored from the story database. It uses an isolated spend ledger under ignored `evals/reports/`. Input-token count endpoint billing, if any, is outside the local ledger and provider invoice reconciliation.

The rejected prompt `1.4.11` databases must first move through the provider-free, hash-bound quality migration after the new source commit:

```powershell
npm run review:stories:migrate-variant -- --from-source-git-sha 5c92e7a75629d0d39e6edea676b4cf4ad44fb12c --confirm-archive
```

It archives every old database, verifies unique response cost against the ledger, carries `$0.1635525` as prior spend, applies only the authorized `$2.544` to `$5.088` cap transition, and makes zero provider requests.

After a killed process, use only the run ID printed by the lock error and only after that process is dead:

```powershell
npm run review:stories:recover -- --run-id <uuid>
```

Recovery makes no provider request. It charges an unknown active request at its full reservation, releases the stale lock, and leaves less headroom for the same stable run. Because a hard-killed request has no failed-turn record, a resumed attempt for that chapter can take its lifetime exposure above `$0.0848`; the hard `$5.088` aggregate still cannot be exceeded. Preflight then shows the committed count for every viewpoint. Resume the exact paid command only while chapters remain.

If all 60 chapters committed but the process stopped before both review files were written, finalize them without a key or provider request:

```powershell
npm run review:stories:finalize
```

Finalization accepts only the two story-review output paths as worktree changes and rebuilds summaries from the canonical commit payloads.

For ad hoc interactive review, use a separate clean clone so existing local story data stays safe.

Put the API key and the per-chapter ceiling you accept in root `.env`, then start the app:

```dotenv
OPENAI_API_KEY=
OPENAI_MAX_COST_USD_PER_CHAPTER=0.10
```

```powershell
npm run dev
```

Choose a character and make the opening decision. Then use `Continue to next decision`.

- Review the exact maximum shown and confirm `Start generation` only if you accept it.
- Keep the tab open. The browser orchestrates one atomic chapter request at a time.
- The story asks again only at an incomplete act milestone: after chapter 47 and after chapter 97 on the path to 100.
- `Stop after this chapter` is truthful. It does not cancel active provider work.
- A failed chapter exposes `Retry same chapter`, which reuses the exact request ID.
- Chapter 100 ends the demo run. The underlying story remains nonterminal and still supports the hard chapter-350 ending.

Cost is bounded per chapter, not per multi-chapter run. From a new world, chapter 100 can authorize up to `100 × OPENAI_MAX_COST_USD_PER_CHAPTER`; from the chapter-1 demo seed, up to `99 ×` that ceiling. Actual usage can be lower. Set the ceiling before the run and stop when needed.

## Human verdict

Record:

- Was the core path obvious without instructions?
- Did the app ask for input only when the decision felt meaningful?
- Was generation status truthful and understandable?
- Did stopping behave as expected?
- Did the six voices feel distinct and worth continuing?
- Any hidden-knowledge, canon, pacing, or LitRPG clarity issue with an exact chapter citation.
