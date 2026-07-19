# Living Execution Plan

Update this file during work. Checkboxes need evidence in `docs/STATUS.md`.

## Progress

### Phase 0: Direction and Agent Scaffold

- [x] Product contract written.
- [x] Architecture and domain boundaries written.
- [x] Decisions and primary research captured.
- [x] Eval gates and seed fixtures specified.
- [x] Codex loop and bounded subagent roles configured.
- [x] Git repository and remote configured.
- [x] Initial scaffold commit created (`39b19a2`).

### Phase 1: App Bootstrap

- [x] Create root npm workspace with `app` and `shared` packages.
- [x] Initialize Next.js TypeScript app inside `app/` without nested Git repository.
- [x] Add strict TypeScript, lint, format, Vitest, Playwright, Zod, SQLite, and OpenAI SDK.
- [x] Add stable root commands listed in `AGENTS.md`.
- [x] Load root `.env` for app and eval runners.
- [x] Prove API key never enters client bundle.

### Phase 2: Contracts and Offline Evals

- [x] Implement schemas under `shared/contracts/`.
- [x] Implement deterministic invariant validator.
- [x] Load fixtures and JSONL cases.
- [x] Run 1,000 seeded offline simulations.
- [x] Make schema and invariant gates pass before live API work.

### Phase 3: Deterministic World Engine

- [x] Implement state versioning and chapter clock.
- [x] Implement intent preconditions and conflict resolution.
- [x] Implement deterministic investigation clues, relationship progression, and visibility rules.
- [x] Implement atomic SQLite commit.
- [x] Reject chapter 351 before any model call.

### Phase 4: OpenAI Runtime

- [x] Implement GPT-5.6-only model allowlist.
- [x] Implement Responses structured-output adapters.
- [x] Implement Luna native Multi-agent world tick.
- [x] Implement sequential Luna fallback.
- [x] Implement bounded refusal, retry, timeout, and preflight cost handling.
- [x] Persist successful calls and every failed or successful runtime attempt without secrets.

### Phase 5: Narrative Loop

- [x] Implement two valid choices plus custom action.
- [x] Implement POV-safe Terra narration and audited NDJSON replay.
- [x] Implement chapter fact audit that can reject prose but cannot create canon.
- [ ] Pass twelve full live chapter cycles.
- [ ] Pass zero-leak checks across six POVs.

### Phase 6: Product UI

- [x] Seed Ashen Crown world.
- [x] Character selection and permanent viewpoint lock.
- [x] World, character, chapter, progression, and clock views.
- [x] Reader mode hides private state.
- [x] God Mode shows intents, resolution, delta, usage, cost, and latency.
- [x] Export POV-safe Reader state, Markdown, and explicit full God Mode JSON.

### Phase 7: Hardening

- [x] Full check command green.
- [x] Browser smoke path green.
- [x] Native multi-agent and sequential live smoke paths green.
- [ ] Six POV review packets generated and agent-reviewed.
- [x] Secret scan and dependency-license check green.
- [x] Clean-clone setup verified.

### Phase 8: Build Week Submission

- User-owned gates begin after repository is submission-ready.
- [ ] README setup and architecture complete.
- [ ] Screenshots and architecture diagram ready.
- [ ] Demo script and capture path ready.
- [ ] User approves six POV review packets.
- [ ] User authorizes public repository push.
- [ ] User records or approves public demo under three minutes.
- [ ] User supplies Codex feedback session ID.
- [ ] User authorizes final challenge submission.

## Surprises and Discoveries

- Next.js setup intentionally deferred during planning scaffold.
- Native Multi-agent beta access is confirmed for the configured key.
- OpenAI Responses return token usage but no cost field; cost must use a versioned local pricing table.
- Native Multi-agent TypeScript calls require `client.beta.responses.create` plus the beta option; raw HTTP uses the beta header.
- Safe chapter streaming conflicts with post-generation narrative audit. MVP will buffer, audit, then replay validated text as a stream so rejected prose never reaches the reader.
- `research/2026-07-19-openai-runtime.md` incorrectly said Terra narrates after commit. Prospective state, narration, audit, then atomic commit remains authoritative.
- Fixtures now cover strict schemas, atomic rollback, 35 clock checkpoints, semantic POV attacks, and both adapter paths.
- Initial seeded simulation was only repeated clone validation. It was replaced before AI changes with 1,000 actual resolve-and-stage commits plus a 350-commit terminal horizon.
- Engine review found and closed teleport injection, missing effect, hidden-fact action, duplicate intent, cross-owner unique item, dynamic remote POV state, milestone, and existing-fact propagation defects. Each has a regression test.
- First live narration exceeded 1,300 words. Bounded audit-aware regeneration and an oversized-prose regression now prevent commit.
- Audit then found invented skills, clues, elapsed years, and semantic private-role hints. Narration now receives exact before/delta/after projections; remote public-role teasers were removed from agent context and semantic leak cases doubled from six to twelve.
- Native Multi-agent beta is available for this API key. Both native and sequential capped live chapters committed successfully.
- Next.js hot reload retained an obsolete global service during browser QA. A clean server restart removed the mismatch; clean-start real Reader, God Mode, exports, and two chapter commits passed.
- The first twelve-cycle run stopped after four commits. One chapter exceeded the `$0.10` cap and Maelin exposed remote-character claims, contradictory audit evidence, and an 897-word draft. Cost preflight, structured audit issue codes, tighter remote-character rules, retry feedback, and a 975 to 1,025 word target now have regressions.
- Read-only release review found replay retry double-commit risk, arbitrary action targets, unreachable knowledge progression, hidden Reader JSON state, missing failed-attempt trace cost, and missing live streaming proof. Expected-version UUID idempotency, target allowlists, deterministic clues and relationships, safe exports, attempt traces, and exact stream reconstruction now close them.
- Stable Next `16.2.10` pins vulnerable PostCSS `8.4.31`. Pinned Next `16.3.0-canary.89` carries PostCSS `8.5.10`; the full build and both dependency audits are green.
- Contract, prompt, and fixture versions moved to `1.1.0` before new live traces. Investigation now stops emitting new facts at world or ledger capacity, and failed nested audit attempts remain in exact cost and usage totals.
- Final paid-run review found unknown-cost retries, remote-delta audit leakage, lost failed-turn traces, missing sequential-agent attribution, and retry budget resets. Worst-case reservations, POV-visible audit projections, durable failure traces, exact agent IDs, cumulative world-version exposure, and a serialized local turn queue now have regressions.
- Maelin prompt `1.1.0` smoke exposed an audit ambiguity: Luna scored choice fulfillment against future chapter choices instead of the selected player action. The first rejected narration then left too little worst-case budget for the duplicated prompt. Prompt `1.2.0` names future choices explicitly, uses one compact after-turn POV canon, and cuts measured narration input from 11,848 to 6,505 bytes and audit input from 17,533 to 12,182 bytes in the deterministic probe.
- The first prompt `1.2.0` full run exposed same-turn observation ordering. Rowan moved away but the resolver still marked him as observing Nyra at his old location, and narration leaked her generated clue. Observer visibility now uses every accepted actor's post-turn location. Prompt `1.3.0` also forbids extrapolating findings from another character's visible investigation event.
- The prompt `1.3.0` release run established a new baseline before further AI changes. Zero chapters committed and exposure was `$0.06607685`. Luna saw after-turn XP plus the exact current-chapter grant but no pre-turn value, then incorrectly called the grant pre-existing. Prompt `1.4.0` labels before state, current effects, and after state explicitly.
- Final engine review found duplicate matched mutations, caller-selected intent disposition, broad milestone self-attestation, and copied early-ending claims. Staging now recomputes deterministic disposition and requires the full event, state-mutation, and knowledge-mutation artifacts to match exactly. Incomplete milestones require one of at least two direct typed target shapes; early endings are resolver-derived.
- Live report version 5 preserves attempt phase, deterministic rejection issues, audit evidence, approved prose, prior spend, projected exposure, exact cumulative spend, prompt version, Git SHA, and adapter. Full runs require a clean committed worktree. A failed run may resume only at the same checkpoint. It retains complete POV pairs, preserves every old attempt cost, and reruns incomplete pairs from chapter 1.
- The first prompt `1.4.0` smoke process was killed by the shell timeout before a report existed. Its full `$0.097` ceiling is reserved as unknown exposure. Prompt `1.4.1` keeps the timing fix but sends only pre-turn values touched by current effects, lowering request reservation.
- Prompt `1.4.1` passed Rowan chapter 1, then exposed a custom-action translation defect: Terra changed “Investigate the immediate area for fresh tracks” into `wait`, and the audit correctly rejected the prose. Prompt `1.4.2` states the mapping explicitly. Deterministic validation now rejects changed semantics, wrong targets, and every otherwise-illegal translation before background model calls. An impossible local investigation during an incomplete milestone lock returns 422 before any model call.
- Prompt `1.4.2` then exposed a semantic knowledge leak before any commit: Rowan connected his known old identity to a hidden Void-containment history. Prompt `1.4.3` makes supplied POV canon and current effects an exhaustive whitelist and forbids synthesizing new relationships from identities, threats, places, or shared vocabulary. Retry feedback now uses fixed issue codes only; it never echoes audit prose, hidden claims, or fact IDs into narrator context.
- Prompt `1.4.3` passed Rowan chapter 1, then Terra translated the same explicit local investigation as another action on all three attempts. Prompt `1.4.4` resolves only simple command-led local investigations deterministically to the POV location. Compound, conditional, negated, and multi-sentence actions still route to the bounded Terra translator.
- Prompt `1.4.4` passed both Rowan chapters, then one structurally invalid Luna audit exhausted Elara's retry reservation. Prompt `1.4.5` parses Luna through a permissive candidate schema, then deterministically derives approval, locks the prose hash, and validates the final stored audit. Positive scores require `pass`; zero scores require dimension-specific failure codes. Narrator and auditor receive identical POV and world canon. The 400-token experiment lacked safe headroom, so the audited cap remains 550.
- Prompt `1.4.5` passed both Rowan chapters. Elara then referred to the supplied public `world.threat`, but Luna called that concept forbidden because the audit instruction explicitly permitted POV canon and omitted `world`. Prompt `1.4.6` names `world` as established public canon for both narrator and auditor while retaining the ban on synthesized causes, relationships, mechanisms, and history. Public world fields take precedence over semantically overlapping forbidden facts; only details exclusive to a forbidden fact fail.
- Prompt `1.4.6` established the next paid baseline before more AI changes. Rowan chapter 1 reached Terra narration, but the nested audit did not start: prior calls and narration spent `$0.031506`, leaving `$0.023394` against a `$0.024960` audit reservation. Zero chapters committed. Cumulative conservative exposure is `$2.371789175`.
- Prompt `1.4.7` keeps the full maximum-three background-agent live gate. It moves the strictly validated chapter frame from Terra to Luna, targets 900 to 925 words, and deduplicates current events. Compact labeled maps and tuples preserve every value in the deliberate narration whitelist and every forbidden remote-effect value. The whitelist intentionally excludes existing-fact provenance, skill unlock metadata, world version, and non-POV factions; projection regressions lock those safety boundaries. The model returns only seven ordered scores, seven evidence strings, and leak IDs; application code derives dimensions, issue codes, approval, and prose hash before final strict validation. Reconstructing the old 1,057-word Rowan chapter measured a 12,514-byte full audit request and `$0.0189825` reservation. The `$0.0523` cap retains `$0.0011215` for Rowan with its two selected agents and `$0.00124925` for the conservative three-agent Elara case using the old longer narration outputs; the shorter target adds headroom. A separate three-agent 900-word service request reserved `$0.01773125` for audit and committed under the release cap.

## Decision Log

- See `decisions/`.
- Fixed 50-chapter act boundaries are authoritative; early terminal endings may end the story but do not create shortened nonterminal acts.
- `World Director` is deterministic application code for MVP. Models emit intents and prose only; no model owns conflict resolution or canonical state.
- `WorldState.chapter` means last committed chapter. Generation from 349 may create terminal chapter 350. Any request when current chapter is 350 is rejected before model access.
- Validated narration uses buffer-audit-replay streaming. This trades first-token latency for zero exposure of rejected prose.
- ADR-008 moves only validated chapter frames to Luna after the prompt `1.4.6` paid cost baseline. Terra remains the custom-action translator and narrator. The full live eval still allows all three relevant background agents.

## Outcomes and Retrospective

- Phases 1 through 4 and Phase 6 are implemented. Offline contracts, deterministic transitions, knowledge boundaries, atomic storage, both OpenAI adapters, and the product UI are green. Phase 5 has green live smoke and awaits the twelve-cycle release run.

## Current Milestone

Phase 5 release eval: finish the prompt `1.4.7` clean checkpoint, then run twelve complete cycles across all six viewpoints at `$0.0523` per chapter. Conservative prior exposure is `$2.371789175`; projected worst-case cumulative exposure is `$2.999389175`.
