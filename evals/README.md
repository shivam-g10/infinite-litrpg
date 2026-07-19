# Evals

Evals define completion. Implement runner before live prompt work.

## Command Contract

- `npm run evals`: all offline deterministic gates.
- `npm run evals:live:smoke`: smallest capped API suite.
- `npm run evals:live:full`: release-only live suite with explicit cost confirmation.

Runner must load root `.env`, redact secrets, write reports under ignored `evals/reports/`, and return nonzero on gate failure.

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
