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

Final narrative signoff requires six contiguous ten-chapter stories. The rejected pack is absent from the active workspace. Git history preserves it. [SAMPLE_STORIES.md](SAMPLE_STORIES.md) contains no prose and is not review evidence. The single prompt `1.6.0` stretch stopped with six total chapters, so final narrative signoff is not ready.

The long-form gate must pass first:

```powershell
npm run review:stories:check
```

It fails unless every viewpoint has a provenance-checked chapter 1 through 10 and every current quality gate passes. The tracked source artifact contains every canonical chapter record, committed world delta, matching trace, and final state. The check rebuilds each state chain and readable pack. When green, read [SAMPLE_STORIES.md](SAMPLE_STORIES.md) in order, compare each chosen action with the next chapter, then complete each story verdict using the fixed bar in [LitRPG good-enough research](../research/2026-07-21-litrpg-good-enough.md).

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

The exact paid command requires explicit confirmation and records actual Responses usage without an application cost ceiling:

```powershell
npm run review:stories:live -- --confirm-unbounded-cost
```

It follows the director-ranked choice unless rank would make the fixed final action-diversity or repetition bar impossible. It retains up to three sequential background agents and checkpoints each atomic commit. All six stories run once in batches of at most two. After all 60 chapters commit, the runner evaluates every story against all 33 fixed gates once. It does not run a pilot, stop for per-story tuning, or feed old `docs/SAMPLE_STORIES.md` content into generation. Canonical review stories and chapter Markdown live under ignored `stories/review-<character-id>/`; usage telemetry stays under ignored `evals/reports/`.

The completed, human-rejected prompt `1.4.12` databases are already archived. The single prompt `1.6.0` source commit carries an exact hash-bound bridge from that archive marker to the current variant. Verify it without a provider call:

```powershell
npm run review:stories:preflight
```

Preflight verifies prior manifests, both intervening commits, the old and new variant hashes, every changed path, the durable ledger, and current progress. It makes zero provider requests and must not mutate the archive or ledger.

After a killed process, use only the run ID printed by the lock error and only after that process is dead:

```powershell
npm run review:stories:recover -- --run-id <uuid>
```

Recovery makes no provider request. It marks an unknown active request at its full reservation for conservative telemetry, releases the stale lock, and preserves exact lineage. Preflight then shows the committed count for every viewpoint. Resume the exact paid command only while chapters remain.

If all 60 chapters committed but the process stopped before both review files were written, finalize them without a key or provider request:

```powershell
npm run review:stories:finalize
```

Finalization accepts only the two story-review output paths as worktree changes and rebuilds summaries from the canonical commit payloads.

For ad hoc interactive review, use a separate clean clone so existing local story data stays safe.

Put the API key in root `.env`, then start the app:

```dotenv
OPENAI_API_KEY=
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

Actual usage remains visible in Developer details. Reader stays focused on story. `Stop after this chapter` controls the next request, not the provider call already in flight.

## Human verdict

Record:

- Was the core path obvious without instructions?
- Did the app ask for input only when the decision felt meaningful?
- Was generation status truthful and understandable?
- Did stopping behave as expected?
- Did the six voices feel distinct and worth continuing?
- Any hidden-knowledge, canon, pacing, or LitRPG clarity issue with an exact chapter citation.
