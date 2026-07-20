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

Read and annotate all six curated passing POV samples in [SAMPLE_STORIES.md](SAMPLE_STORIES.md).

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

Use a separate clean clone so existing local story data stays safe. Put the API key and the per-chapter ceiling you accept in root `.env`, then start the app:

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
