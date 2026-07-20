# Evals

Evals define completion. Implement runner before live prompt work.

## Command Contract

- `npm run evals`: all offline deterministic gates.
- `npm run evals:live:smoke`: smallest capped API suite.
- `npm run evals:live:full`: release-only Flex suite with explicit cost confirmation.
- `npm run evals:live:reconcile`: registered no-network reconciliation for an interrupted unknown request.
- `npm run evals:live:reconcile-settled`: registered no-network report materialization for a released run whose requests all settled.

Live runs accept `--prior-spend-usd`, `--chapter-cap-usd`, and `--service-tier`. Report version 9 retains all version 8 canon, response, candidate, turn, stream, cost, and resume evidence. It also requires explicit requested and returned service tier on every current attempt and model call, tier-specific pricing version, exact clean-path projection, and a recomputed `serviceTierEvidenceComplete` gate. Selective resumes persist the exact human-rejected `rerunFrom` suffixes. Canon-preserving resumes instead persist exact `renarrate` targets plus source and replacement canonical hash, prose hash, request ID, and turn ID. The two modes are mutually exclusive. Paid source evidence remains append-only under `supersededTurnIds`, but each ID must fall inside the authenticated source evidence boundary. A settled finalization failure uses separate checkpoint-bound `settledFailure` provenance for its uncommitted evidence suffix. Neither kind can root current canon or satisfy a committed result. Older version 9 reports default new fields safely. A full version 9 report must use Flex. Missing, `auto`, mixed, mismatched, or retained poisoned tier evidence fails closed. Historical version 5 through 8 reports stay readable and default only their legacy tier provenance to Standard. An ignored atomic evidence sidecar survives interruption before chapter commit and carries the same tier and pricing bindings.

The static projection stays visible even when it exceeds `$3`; it is not the authority after a partial run. The durable SQLite ledger at ignored `evals/reports/live-spend-ledger.db` is authoritative. Ledger version 2 binds every reservation to Standard or Flex. Opening a version 1 ledger migrates historical rows to Standard in one transaction and verifies exact exposure is unchanged. Every generation request reserves tier-priced maximum exposure before provider transport and rejects a request that could take cumulative local exposure above `$3`. Returned usage settles at the returned tier before response validation. Missing or ambiguous provider tier keeps the conservative reservation and fails.

All live suites share this ledger. Do not run an unrelated smoke while a release resume chain is open. After a chain closes, a fresh suite may start only when `--prior-spend-usd` exactly equals the ledger's current total exposure; the ledger then folds that total into the new prior without reclaiming spend.

```powershell
npm run evals:live:smoke -- --prior-spend-usd 1.25 --chapter-cap-usd 0.10
npm run evals:live:full -- --prior-spend-usd 2.811082175 --chapter-cap-usd 0.0424
```

A full run requires a clean committed worktree. The npm full script selects Flex; the product runtime and smoke default explicitly to Standard. The parser authenticates versions 5 through 9, but the current full command can resume only a version 9 Flex report with the same prior spend, adapter, prompt version, and service tier. Versions 5 through 8 remain readable Standard baseline evidence and cannot cross into the Flex chain. Versions 7 through 9 authenticate each contiguous chapter prefix. Version 9 refuses a retained current-evidence prefix whose tier gate is false. A retained chapter keeps its original Git SHA and source cap; a new chapter uses the current run cap. Chapter 1 state is reconstructed from the seed fixture, player intent, accepted delta, and both trace state hashes before chapter 2 runs.

Current HEAD must equal the source checkpoint or differ only in committed non-runtime tests and release documentation. A legacy bridge additionally requires the exact audited hashes of every changed runtime file. Every source report must match a full-file SHA-256 and metadata entry in tracked `evals/resume-checkpoints.json`. Inspect and register each failed report before another resume. Never auto-resume an unregistered artifact.

The authorized prompt `1.4.11` Flex resume completed all twelve automated cycles. Its strict version 9 report has SHA-256 `fb9295d7c33ca154c7e407894b807d4a371b83d5ef066d78eee05ee42d4c49d2`, 91 attempts, `$0.1363645` total attempt cost, and all automated gates true. Exact durable exposure is `$2.947446675`; headroom is `$0.052553325`. There is no run lock and no active or uncertain reservation.

Human review rejected Rowan chapter 2, Elara chapter 1, and Lucan chapter 1. The prose spent uncommitted mana, crossed beyond the committed destination, reversed a route, and reassigned a POV-owned private plan. ADR-016 adds exact regressions plus narrow pre-audit and atomic-store validation. `--rerun-from <pov-id>:<chapter>` discards only that chapter suffix from a complete authenticated pair. It keeps seven accepted results and preserves all prior attempts and cost. The source report must be registered, all non-live gates and clean-clone verification must pass, and explicit user authority is required before this selective resume command:

```powershell
npm run evals:live:full -- --prior-spend-usd 2.811082175 --chapter-cap-usd 0.0424 --resume-report evals/reports/live-full-sequential.json --rerun-from rowan-ashborn:2 --rerun-from elara-voss:1 --rerun-from lucan-aurelis:1
```

The authorized command ran once. It spent `$0.01183` on seven known Flex attempts before final report validation exposed a superseded-evidence harness defect. The source report was not overwritten. Exact sidecar evidence and durable reservations are registered in `evals/settled-run-checkpoints.json`; exposure is `$2.959276675` and headroom is `$0.040723325`. Provider-free reconciliation materialized `evals/reports/live-full-sequential-settled-1.json` at SHA-256 `af6e64f1481e2220001e4408d4b3b20f42cf19861c72dc0d2d4bc7e62c18b7ec`. The committed resume registry binds it to eleven exact bridge hashes. It retains all twelve source results and marks the one new Rowan turn as uncommitted settled evidence. Do not rerun a paid command until canon-preserving re-narration passes every non-live gate and the user authorizes its exact command.

`--renarrate <pov-id>:<chapter>` replaces only authenticated prose evidence. Before provider access it restages exact canon, validates the original action and frame, authenticates the source candidate and hash, and checks the full target-count ceiling against durable exposure. It does not run intent, background-agent, frame, state-writer, or store-commit paths. Narration uses reasoning `none`; the independent audit uses reasoning `low`. The output report keeps all twelve chapter cells, writes each complete replacement to the sidecar before report update, and supersedes a source turn only after exact replacement validation. Three `$0.0135` targets have a hard `$0.0405` maximum, projecting `$2.999776675` total exposure and `$0.000223325` headroom. This exact paid command still needs fresh user authorization:

```powershell
npm run evals:live:full -- --prior-spend-usd 2.811082175 --chapter-cap-usd 0.0135 --resume-report evals/reports/live-full-sequential-settled-1.json --renarrate rowan-ashborn:2 --renarrate elara-voss:1 --renarrate lucan-aurelis:1
```

Never resume automatically.

Runner must load root `.env`, redact secrets, write reports under ignored `evals/reports/`, and return nonzero on gate failure.

Cost gates cover estimated Responses generation exposure from returned usage. The input-token counting endpoint returns token counts, not usage or cost, so count-request billing is not represented in this local ledger. Provider-bill reconciliation requires organization usage access.

An interrupted provider request deliberately leaves the ledger locked. Do not delete the database or clear the lock. Reconcile the provider request first; without organization usage access, the full reservation remains spent. A tracked interruption checkpoint authenticates one exact dead run, immutable sidecar, source commit, service tier, pricing version, retry shape, and tier-bound reservation set. `npm run evals:live:reconcile -- --checkpoint <id>` then converts only registered unknown requests to uncertain at full maximum, writes and rereads a strict tier-bound receipt, and releases the lock. It has no OpenAI client or provider-call path.

If the recorded process is dead and the ledger has zero active provider reservations, rerun the exact resume command with `--recover-stale-run <run-id>`. The lock error supplies the stable run ID. Recovery validates the append-only sidecar, service tier, pricing version, and exact settled exposure before atomically transferring only PID ownership; it never changes the run ID or exposure. Raw response and attempt evidence is checkpointed before a known reservation settles. If the sidecar adds evidence, recovery writes a reconciliation report and exits before replay or any provider request. The lock is released only after that report commits. If the final strict report already committed before the process died, recovery runs before API-key loading: it requires exact report-sidecar evidence, metadata, dead same-run ownership, zero active rows, exact known and uncertain row counts, and the exact durable snapshot, then deletes only the lock and makes no provider request. Inspect and register the report, then resume normally. An exact sidecar with no extension may continue. A live owner, wrong run ID, active reservation, changed tier, changed prior or baseline exposure, mutated evidence, or omitted settled exposure fails closed without changing the ledger.

If a final report build failed after every request settled and the old runner released its lock, use only the exact tracked settled checkpoint. `npm run evals:live:reconcile-settled -- --checkpoint <id>` authenticates the source report, append-only sidecar, rerun suffix, reservation rows, runtime Git source, and committed bridge. It keeps every source result because no replacement committed, marks only the new uncommitted evidence suffix as `settledFailure`, reclaims the same run ID locally, writes and rereads one strict failure report, then releases. A crash retry accepts only the byte-equivalent strict report apart from its timestamp and idempotently finishes the same ledger claim. It loads no API key and makes no provider request. Any mismatch fails before release; any report failure keeps the lock.

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

- Human scores choice fulfillment, character autonomy, POV safety, LitRPG mechanics, continuity, arc progress, and prose using `evals/RUBRIC.md`.
- Reviewer agents may surface evidence. They cannot become sole release judge.
- After one strict green version 9 full report, generate the authenticated six-packet set without network access:

```powershell
npm run evals:review-packets -- evals/reports/<final-report>.json
```

The command rejects partial reports, false gates, missing canonical evidence, and mixed tiers. It refuses to replace an existing packet directory unless `--force` is explicit. Generated-evidence hashes exclude the marked human-review block, so reviewers can fill scores and citations without breaking provenance. Use `--force` only before review or after preserving completed annotations.

Fresh manifests start `pending-human-review`. After all six final and chapter verdicts are filled, set the manifest to `human-reviewed-approved` or `human-reviewed-rejected`. Packet validation rejects an approved manifest containing a rejection, a rejected manifest with no rejection, or any completed status with missing verdicts. Packet headers record the generated status, not the current verdict.

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
