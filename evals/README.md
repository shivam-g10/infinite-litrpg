# Evals

Evals define completion. Implement runner before live prompt work.

## Command Contract

- `npm run evals`: all offline deterministic gates.
- `npm run evals:live:smoke`: smallest capped API suite.
- `npm run evals:live:full`: release-only live suite with explicit cost confirmation.

Live runs accept `--prior-spend-usd` and `--chapter-cap-usd`. The runner rejects a suite when prior spend plus every configured chapter ceiling could exceed the cumulative `$3` POC cap. Report version 6 records prior spend, projected maximum, exact cumulative generation-attempt cost, attempt phase, audit rejections, deterministic draft rejections, approved prose, prompt version, per-result Git provenance, source-report hash, changed harness paths, and adapter checkpoint.

```powershell
npm run evals:live:smoke -- --prior-spend-usd 1.25 --chapter-cap-usd 0.10
npm run evals:live:full -- --prior-spend-usd 1.30 --chapter-cap-usd 0.09
```

A full run requires a clean committed worktree. A failed version 6 run can resume with the same prior spend, adapter, and prompt version. The chapter cap may stay fixed or decrease, never increase. Current HEAD must equal the source checkpoint or differ only in committed non-runtime tests and release documentation; the one version 5 bridge also permits its audited runner migration. Resume keeps all old attempt cost and rejections, retains only complete chapter 1 and 2 POV pairs with their original trace SHAs, and reruns every incomplete POV from chapter 1. Every source report must exactly match a full-file SHA-256 and metadata entry in tracked `evals/resume-checkpoints.json`. Inspect and register a failed version 6 report before another resume; never auto-resume an unregistered artifact.

```powershell
npm run evals:live:full -- --prior-spend-usd 2.49105695 --chapter-cap-usd 0.0405 --resume-report evals/reports/live-full-sequential-prompt-1.4.9.json
```

Runner must load root `.env`, redact secrets, write reports under ignored `evals/reports/`, and return nonzero on gate failure.

Cost gates cover estimated Responses generation exposure from returned usage. The input-token counting endpoint returns token counts, not usage or cost, so count-request billing is not represented in this local ledger. Provider-bill reconciliation requires organization usage access.

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
