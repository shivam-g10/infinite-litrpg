# Human Review Guide

## Fast no-cost review

Use a clean clone, or preserve any existing ignored `stories/` directory before resetting demo data.

```powershell
npm ci
npm run demo:seed
npm run dev
```

Open `http://127.0.0.1:3000`. The seed command restores authenticated Rowan chapter 1. On first app start, the legacy database is safely copied into `stories/imported-ashen-crown/`; no provider request runs.

Check:

1. Reader opens on Rowan with `Chapter 1 of 100` and the full chapter visible.
2. `Continue to next decision` is the only primary story action.
3. Opening it shows the exact target chapter before `Start generation` appears.
4. Story and character details stay behind one disclosure.
5. `More` → `Developer details` shows intent, delta, audit, model, usage, cost, latency, and state hashes without cluttering the Reader.
6. Desktop and phone widths have no horizontal overflow.
7. Markdown and Reader JSON exports contain no hidden canon.

Final narrative signoff requires six contiguous ten-chapter stories. The current tracked pack is a human-rejected baseline until prompt `1.5.0` replaces it.

The long-form gate must pass first:

```powershell
npm run review:stories:check
```

It fails unless every viewpoint has a provenance-checked chapter 1 through 10 and all 26 quality gates pass. The tracked source artifact contains every canonical chapter record, committed world delta, matching trace, and final state. The check rebuilds each state chain and readable pack. When green, read [SAMPLE_STORIES.md](SAMPLE_STORIES.md) in order, compare each chosen action with the next chapter, then complete each story verdict.

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

It avoids an immediate repeated action type, then selects the least-used offered action type and exact action with stable offered-order ties. It retains up to three sequential background agents, checkpoints each atomic commit, and publishes only chapters whose runtime audit and all story gates pass. The `$0.0848` flag is an upper bound. With `$0.86713` carried exposure, fair-share lowers the effective ceiling to `$0.070347833` so all 60 slots fit below `$5.088`. Canonical review stories and chapter Markdown live under ignored `stories/review-<character-id>/`; the spend ledger stays under ignored `evals/reports/`. Input-token count endpoint billing, if any, is outside the local ledger and provider invoice reconciliation.

The completed, human-rejected prompt `1.4.12` databases must first move through the provider-free, hash-bound lineage migration after the new source commit:

```powershell
npm run review:stories:migrate-variant -- --from-source-git-sha 90ca3462ea8c456cedc8f63d357b05970b5168aa --confirm-archive
```

It archives every old database, verifies both prior manifests and unique response cost, carries `$0.86713` as prior spend, keeps the authorized `$5.088` cap unchanged, and makes zero provider requests.

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
OPENAI_MAX_COST_USD_PER_CHAPTER=0.20
```

```powershell
npm run dev
```

Choose a character and make the opening decision. Then use `Continue to next decision`.

- Confirm the target chapter, then start only the run you intend.
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
