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
- [ ] Initial scaffold commit created.

### Phase 1: App Bootstrap

- [ ] Create root npm workspace with `app` and `shared` packages.
- [ ] Initialize Next.js TypeScript app inside `app/` without nested Git repository.
- [ ] Add strict TypeScript, lint, format, Vitest, Playwright, Zod, SQLite, and OpenAI SDK.
- [ ] Add stable root commands listed in `AGENTS.md`.
- [ ] Load root `.env` for app and eval runners.
- [ ] Prove API key never enters client bundle.

### Phase 2: Contracts and Offline Evals

- [ ] Implement schemas under `shared/contracts/`.
- [ ] Implement deterministic invariant validator.
- [ ] Load fixtures and JSONL cases.
- [ ] Run 1,000 seeded offline simulations.
- [ ] Make schema and invariant gates pass before live API work.

### Phase 3: Deterministic World Engine

- [ ] Implement state versioning and chapter clock.
- [ ] Implement intent preconditions and conflict resolution.
- [ ] Implement knowledge propagation and visibility rules.
- [ ] Implement atomic SQLite commit.
- [ ] Reject chapter 351 before any model call.

### Phase 4: OpenAI Runtime

- [ ] Implement GPT-5.6-only model allowlist.
- [ ] Implement Responses structured-output adapters.
- [ ] Implement Luna native Multi-agent world tick.
- [ ] Implement sequential Luna fallback.
- [ ] Implement bounded refusal, retry, timeout, and cost handling.
- [ ] Persist full trace envelope without secrets.

### Phase 5: Narrative Loop

- [ ] Implement two valid choices plus custom action.
- [ ] Implement POV-safe Terra narration and streaming.
- [ ] Implement chapter fact audit that can reject prose but cannot create canon.
- [ ] Pass twelve full live chapter cycles.
- [ ] Pass zero-leak checks across six POVs.

### Phase 6: Product UI

- [ ] Seed or generate Ashen Crown world.
- [ ] Character selection and permanent viewpoint lock.
- [ ] World, character, chapter, progression, and clock views.
- [ ] Reader mode hides private state.
- [ ] God Mode shows intents, resolution, delta, usage, cost, and latency.
- [ ] Export story and world state as Markdown and JSON.

### Phase 7: Hardening

- [ ] Full check command green.
- [ ] Browser smoke path green.
- [ ] Multi-agent and sequential paths green.
- [ ] Six POV review packets generated and agent-reviewed.
- [ ] Secret scan and dependency-license check green.
- [ ] Clean-clone setup verified.

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
- Native Multi-agent beta access is unknown until first live probe.

## Decision Log

- See `decisions/`.

## Outcomes and Retrospective

- Not built yet.

## Current Milestone

Create initial scaffold commit. Then Phase 1: create root npm workspace, bootstrap app, and establish stable offline verification commands. Do not begin live model behavior before contracts and baseline eval runner exist.
