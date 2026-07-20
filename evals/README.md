# Evals

Evals define completion. Implement runner before live prompt work.

## Command Contract

- `npm run evals`: all offline deterministic gates.
- `npm run evals:live:smoke`: smallest capped API suite.
- `npm run evals:live:full`: release-only Flex suite with explicit cost confirmation.
- `npm run evals:live:reconcile`: registered no-network reconciliation for an interrupted unknown request.

Live runs accept `--prior-spend-usd`, `--chapter-cap-usd`, and `--service-tier`. Report version 9 retains all version 8 canon, response, candidate, turn, stream, cost, and resume evidence. It also requires explicit requested and returned service tier on every current attempt and model call, tier-specific pricing version, exact clean-path projection, and a recomputed `serviceTierEvidenceComplete` gate. A full version 9 report must use Flex. Missing, `auto`, mixed, mismatched, or retained poisoned tier evidence fails closed. Historical version 5 through 8 reports stay readable and default only their legacy tier provenance to Standard. An ignored atomic evidence sidecar survives interruption before chapter commit and carries the same tier and pricing bindings.

The static projection stays visible even when it exceeds `$3`; it is not the authority after a partial run. The durable SQLite ledger at ignored `evals/reports/live-spend-ledger.db` is authoritative. Ledger version 2 binds every reservation to Standard or Flex. Opening a version 1 ledger migrates historical rows to Standard in one transaction and verifies exact exposure is unchanged. Every generation request reserves tier-priced maximum exposure before provider transport and rejects a request that could take cumulative local exposure above `$3`. Returned usage settles at the returned tier before response validation. Missing or ambiguous provider tier keeps the conservative reservation and fails.

All live suites share this ledger. Do not run an unrelated smoke while a release resume chain is open. After a chain closes, a fresh suite may start only when `--prior-spend-usd` exactly equals the ledger's current total exposure; the ledger then folds that total into the new prior without reclaiming spend.

```powershell
npm run evals:live:smoke -- --prior-spend-usd 1.25 --chapter-cap-usd 0.10
npm run evals:live:full -- --prior-spend-usd 2.811082175 --chapter-cap-usd 0.0424
```

A full run requires a clean committed worktree. The npm full script selects Flex; the product runtime and smoke default explicitly to Standard. The parser authenticates versions 5 through 9, but the current full command can resume only a version 9 Flex report with the same prior spend, adapter, prompt version, and service tier. Versions 5 through 8 remain readable Standard baseline evidence and cannot cross into the Flex chain. Versions 7 through 9 authenticate each contiguous chapter prefix. Version 9 refuses a retained current-evidence prefix whose tier gate is false. A retained chapter keeps its original Git SHA and source cap; a new chapter uses the current run cap. Chapter 1 state is reconstructed from the seed fixture, player intent, accepted delta, and both trace state hashes before chapter 2 runs.

Current HEAD must equal the source checkpoint or differ only in committed non-runtime tests and release documentation. A legacy bridge additionally requires the exact audited hashes of every changed runtime file. Every source report must match a full-file SHA-256 and metadata entry in tracked `evals/resume-checkpoints.json`. Inspect and register each failed report before another resume. Never auto-resume an unregistered artifact.

Prompt `1.4.11` requires a fresh twelve-cycle matrix after folding exact prior exposure into the ledger. Prompts `1.4.9` and `1.4.10` remain registered baseline evidence; they do not count toward the changed narration, audit, recovery, cache, and evidence route. The first fresh run was interrupted. Exact conservative exposure is `$2.811082175`; headroom is `$0.188917825`. Code reproduces the corrected Standard projection `$0.208988` and Flex projection `$0.104494`; only Flex fits, with projected final exposure `$2.915576175`. No generation command is authorized until full non-live gates, independent review, clean commit, clean-clone verification, and exact ledger preflight pass. Run the full command once. Never rerun automatically.

Runner must load root `.env`, redact secrets, write reports under ignored `evals/reports/`, and return nonzero on gate failure.

Cost gates cover estimated Responses generation exposure from returned usage. The input-token counting endpoint returns token counts, not usage or cost, so count-request billing is not represented in this local ledger. Provider-bill reconciliation requires organization usage access.

An interrupted provider request deliberately leaves the ledger locked. Do not delete the database or clear the lock. Reconcile the provider request first; without organization usage access, the full reservation remains spent. A tracked interruption checkpoint authenticates one exact dead run, immutable sidecar, source commit, service tier, pricing version, retry shape, and tier-bound reservation set. `npm run evals:live:reconcile -- --checkpoint <id>` then converts only registered unknown requests to uncertain at full maximum, writes and rereads a strict tier-bound receipt, and releases the lock. It has no OpenAI client or provider-call path.

If the recorded process is dead and the ledger has zero active provider reservations, rerun the exact resume command with `--recover-stale-run <run-id>`. The lock error supplies the stable run ID. Recovery validates the append-only sidecar, service tier, pricing version, and exact settled exposure before atomically transferring only PID ownership; it never changes the run ID or exposure. Raw response and attempt evidence is checkpointed before a known reservation settles. If the sidecar adds evidence, recovery writes a reconciliation report and exits before replay or any provider request. The lock is released only after that report commits. Inspect and register it, then resume normally. An exact sidecar with no extension may continue. A live owner, wrong run ID, active reservation, changed tier, changed prior or baseline exposure, mutated evidence, or omitted settled exposure fails closed without changing the ledger.

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
