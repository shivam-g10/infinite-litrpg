# Evals

Evals define completion. Implement runner before live prompt work.

## Command Contract

- `npm run evals`: all offline deterministic gates.
- `npm run evals:live:smoke`: smallest capped API suite.
- `npm run evals:live:full`: release-only live suite with explicit cost confirmation.
- `npm run evals:live:reconcile`: registered no-network reconciliation for an interrupted unknown request.

Live runs accept `--prior-spend-usd` and `--chapter-cap-usd`. Report version 8 records prior spend, the static worst-case projection, exact cumulative generation-attempt exposure, attempt phase, every raw narration, recovery, and audit response, every merged narration candidate, recovery bounds and verdicts, parsed audit candidates, response IDs, canon inputs, deterministic rejections, approved prose, prompt and runtime-schema versions, per-candidate and per-result Git provenance, chapter-cap provenance, source-report hash, bridge hashes, and adapter checkpoint. Accepted results require one exact candidate and every trace call, raw response, and current-schema attempt must bind to its turn. A carried start index authenticates the unavailable prefix from a legacy report across later version 8 resumes. An ignored atomic evidence sidecar survives interruption before chapter commit.

The static projection stays visible even when it exceeds `$3`; it is not the authority after a partial run. The durable SQLite ledger at ignored `evals/reports/live-spend-ledger.db` is authoritative. It reserves every generation request before provider transport and rejects a request that could take cumulative local exposure above `$3`. Returned usage settles to estimated actual cost before response validation. A timeout, transport failure, or interrupted process keeps the full reservation.

All live suites share this ledger. Do not run an unrelated smoke while a release resume chain is open. After a chain closes, a fresh suite may start only when `--prior-spend-usd` exactly equals the ledger's current total exposure; the ledger then folds that total into the new prior without reclaiming spend.

```powershell
npm run evals:live:smoke -- --prior-spend-usd 1.25 --chapter-cap-usd 0.10
npm run evals:live:full -- --prior-spend-usd 1.30 --chapter-cap-usd 0.09
```

A full run requires a clean committed worktree. A failed version 5, 6, 7, or 8 run can resume only with the same prior spend, adapter, and prompt version. Versions 7 and 8 authenticate and retain each contiguous chapter prefix. A retained chapter keeps its original Git SHA and source cap; a new chapter uses the current run cap. Chapter 1 state is reconstructed from the seed fixture, player intent, accepted delta, and both trace state hashes before chapter 2 runs.

Current HEAD must equal the source checkpoint or differ only in committed non-runtime tests and release documentation. A legacy bridge additionally requires the exact audited hashes of every changed runtime file. Every source report must match a full-file SHA-256 and metadata entry in tracked `evals/resume-checkpoints.json`. Inspect and register each failed report before another resume. Never auto-resume an unregistered artifact.

Prompt `1.4.11` requires a fresh twelve-cycle matrix after folding exact prior exposure into the ledger. Prompts `1.4.9` and `1.4.10` remain registered baseline evidence; they do not count toward the changed narration, audit, recovery, cache, and evidence route. The first fresh run was interrupted. Exact conservative exposure is now `$2.811082175`; headroom is `$0.188917825`. The corrected Standard clean-path projection is `$0.208988` and cannot fit. No generation command is authorized until the runner implements and proves explicit Flex request, pricing, trace, and report binding. The same provider-counted matrix projects `$0.104494` on Flex.

Runner must load root `.env`, redact secrets, write reports under ignored `evals/reports/`, and return nonzero on gate failure.

Cost gates cover estimated Responses generation exposure from returned usage. The input-token counting endpoint returns token counts, not usage or cost, so count-request billing is not represented in this local ledger. Provider-bill reconciliation requires organization usage access.

An interrupted provider request deliberately leaves the ledger locked. Do not delete the database or clear the lock. Reconcile the provider request first; without organization usage access, the full reservation remains spent. A tracked interruption checkpoint may authenticate one exact dead run, immutable sidecar, source commit, retry shape, and reservation set. `npm run evals:live:reconcile -- --checkpoint <id>` then converts only registered unknown requests to uncertain at full maximum, writes and rereads a strict receipt, and releases the lock. It has no OpenAI client or provider-call path.

If the recorded process is dead and the ledger has zero active provider reservations, rerun the exact resume command with `--recover-stale-run <run-id>`. The lock error supplies the stable run ID. Recovery validates the append-only sidecar and exact settled exposure before atomically transferring only PID ownership; it never changes the run ID or exposure. Raw response and attempt evidence is checkpointed before a known reservation settles. If the sidecar adds evidence, recovery writes a reconciliation report and exits before replay or any provider request. The lock is released only after that report commits. Inspect and register it, then resume normally. An exact sidecar with no extension may continue. A live owner, wrong run ID, active reservation, changed prior or baseline exposure, mutated evidence, or omitted settled exposure fails closed without changing the ledger.

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
