# Evals

Evals define completion. Implement runner before live prompt work.

## Command Contract

- `npm run evals`: all offline deterministic gates.
- `npm run evals:live:smoke`: smallest capped API suite.
- `npm run evals:live:full`: release-only live suite with explicit cost confirmation.

Live runs accept `--prior-spend-usd` and `--chapter-cap-usd`. Report version 7 records prior spend, the static worst-case projection, exact cumulative generation-attempt exposure, attempt phase, audit rejections, deterministic draft rejections, approved prose, prompt version, per-result Git and chapter-cap provenance, source-report hash, bridge hashes, and adapter checkpoint.

The static projection stays visible even when it exceeds `$3`; it is not the authority after a partial run. The durable SQLite ledger at ignored `evals/reports/live-spend-ledger.db` is authoritative. It reserves every generation request before provider transport and rejects a request that could take cumulative local exposure above `$3`. Returned usage settles to estimated actual cost before response validation. A timeout, transport failure, or interrupted process keeps the full reservation.

All live suites share this ledger. Do not run an unrelated smoke while a release resume chain is open. After a chain closes, a fresh suite may start only when `--prior-spend-usd` exactly equals the ledger's current total exposure; the ledger then folds that total into the new prior without reclaiming spend.

```powershell
npm run evals:live:smoke -- --prior-spend-usd 1.25 --chapter-cap-usd 0.10
npm run evals:live:full -- --prior-spend-usd 1.30 --chapter-cap-usd 0.09
```

A full run requires a clean committed worktree. A failed version 5, 6, or 7 run can resume only with the same prior spend, adapter, and prompt version. Version 7 authenticates and retains each contiguous chapter prefix. A retained chapter keeps its original Git SHA and source cap; a new chapter uses the current run cap. Chapter 1 state is reconstructed from the seed fixture, player intent, accepted delta, and both trace state hashes before chapter 2 runs.

Current HEAD must equal the source checkpoint or differ only in committed non-runtime tests and release documentation. A legacy bridge additionally requires the exact audited hashes of every changed runtime file. Every source report must match a full-file SHA-256 and metadata entry in tracked `evals/resume-checkpoints.json`. Inspect and register each failed report before another resume. Never auto-resume an unregistered artifact.

```powershell
npm run evals:live:full -- --prior-spend-usd 2.735142975 --chapter-cap-usd 0.0424
```

Prompt `1.4.10` intentionally starts a fresh twelve-cycle matrix after folding exact prior exposure into the ledger. Prompt `1.4.9` results remain registered baseline evidence; they do not count toward the changed narration route.

Runner must load root `.env`, redact secrets, write reports under ignored `evals/reports/`, and return nonzero on gate failure.

Cost gates cover estimated Responses generation exposure from returned usage. The input-token counting endpoint returns token counts, not usage or cost, so count-request billing is not represented in this local ledger. Provider-bill reconciliation requires organization usage access.

An interrupted provider request deliberately leaves the ledger locked. Do not delete the database or clear the lock. Reconcile the provider request first; without organization usage access, the full reservation remains spent.

If the recorded process is dead and the ledger has zero active provider reservations, rerun the exact resume command with `--recover-stale-run <run-id>`. The lock error supplies the run ID. Recovery atomically transfers only the lock; it never changes exposure. Source-report reconciliation still runs before any provider request. A live owner, wrong run ID, active reservation, or omitted settled exposure fails closed.

## Gates

### 1. Schema

- Every intent and delta parses strict schema.
- Unknown fields rejected.
- Refusal or incomplete output causes zero mutation.
- Required pass: 100 percent.

### 2. Hard Invariants

- Run at least 1,000 seeded offline simulations.
- Zero invalid location, duplicate unique item, dead-character action, illegal progression, state-version skip, or chapter 351.

### 3. POV Knowledge

- Test all six viewpoints with adversarial hidden facts.
- Required leak rate: zero.

### 4. Live Cycle

- Twelve complete API chapter cycles.
- User action, up to three intents, one atomic commit, streamed chapter.
- Required: twelve valid commits and zero hard violations.
- POC total API budget: at most `$3`.
- Per-chapter target before regeneration: at most `$0.10`.

### 5. Long Horizon

- Thirty-five checkpoints through chapter 350.
- Include every act boundary, chapters 49 and 50, chapter 301, chapter 350.
- Required: all valid, 350 terminal, no 351 request.

### 6. Narrative Review

- Human reviews choice fulfillment, causality, POV voice, progression clarity, continuity, off-screen consequence, and repetition.
- Reviewer agents may surface evidence. They cannot become sole release judge.

### 7. Regression

- Every escaped defect becomes named fixture.
- Offline suite runs on every change.
- Live smoke runs before AI milestone completion.
- Full live suite runs before release.

### 8. Release

- All hard gates green.
- Six POV review packets generated and agent-reviewed.
- User narrative signoff remains release-owned gate.
- Secret scan clean.
- API key absent from browser bundle, logs, fixtures, reports, and Git history.
- Full chapter p95 at most 60 seconds with streaming.

## Trace Requirements

See `docs/ARCHITECTURE.md`. Save exact model and response metadata, state hashes, intents, delta, usage, latency, cost, retries, and result. Never save API key.
