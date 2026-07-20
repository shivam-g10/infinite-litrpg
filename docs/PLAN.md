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
- [x] Keep product requests explicitly Standard and bind explicit Flex into release-eval requests, pricing, reservations, traces, and recovery evidence.

### Phase 5: Narrative Loop

- [x] Implement two valid choices plus custom action.
- [x] Implement POV-safe Luna narration and audited NDJSON replay.
- [x] Implement chapter fact audit that can reject prose but cannot create canon.
- [x] Reproduce the exact prompt `1.4.11` Standard and Flex matrix projections and fail closed on incomplete service-tier evidence.
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
- [x] README setup and architecture complete.
- [x] Screenshots and architecture diagram ready.
- [x] Demo script and capture path ready.
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
- The prompt `1.4.7` paid baseline committed zero chapters. Two Luna frame attempts exposed a hidden literal claim before a safe candidate succeeded. Terra then stopped at 848 words. Prior calls spent `$0.027620125`; the remaining `$0.024679875` could not reserve a full Terra retry. Cumulative conservative exposure is `$2.3994093`.
- Prompt `1.4.8` makes final choices application-owned. Luna ranks safe option IDs and supplies the title; deterministic code owns actions, IDs, descriptions, milestone targets, and terminal state. Terra now targets 975 to 1,000 words. An otherwise-valid 840-to-899-word draft may use one tail-only Luna continuation capped at 1,200 request bytes and `$0.00298`, then must pass every deterministic gate and the full independent audit. A three-agent, two-frame-retry, 848-word regression committed at `$0.0332095`; every request preflight stayed below `$0.05`.
- The prompt `1.4.8` paid matrix passed Rowan chapter 1 at 1,049 words and `$0.033194375`. Rowan chapter 2 produced valid narration, but the crude audit byte reservation missed the remaining chapter budget by `$0.000586125`. One of twelve chapters committed. Run exposure was `$0.06475925`; cumulative conservative exposure is `$2.46416855`.
- ADR-010 keeps byte bounds as the safe fallback and uses the official Responses input-token counter only when that bound would block. Counted input adds a 512-token margin, prices every token at the cache-write rate, and retains maximum output. The reconstructed live narration count exactly matched 1,260 used tokens; the audit counted 2,931 versus 2,947 used. Conservatively using the higher 2,947-token live audit usage, the failed checkpoint falls to a `$0.038588625` preflight without changing any prompt or eval.
- The counted-reservation prompt `1.4.8` matrix baseline committed zero chapters. Its audit treated Rowan's explicitly supplied private reincarnation canon as hidden from his own viewpoint, returned no leaked fact ID, and blocked otherwise valid narration. Exact run exposure was `$0.0268884`; cumulative conservative exposure is `$2.49105695`. This establishes the regression baseline before prompt `1.4.9` clarifies that selected-POV private canon is narratable but cannot become another character's knowledge without a canonical effect.
- Prompt `1.4.9` names the selected viewpoint's fact map as allowed POV canon. It permits exact restatements and faithful paraphrases of POV-private canon in internal close-third narration while requiring allowed current effects or visible events before another character can learn it; detection-only remote context never grants narration permission. A paired regression sends the same explicit reincarnation prose through Rowan and Elara contexts: Rowan's fact is allowed, Elara's is forbidden, and the hidden Void history stays forbidden. The strongest three-agent, two-frame-retry, narration-recovery, full-audit test passed at the original fresh-run `$0.0424` cap with conservative 1,400-token narration and 3,200-token audit counts; the same regression also passes the resumed `$0.0405` cap.
- Prompt `1.4.9` passed both Rowan chapters at `$0.029751275` and `$0.038406625`. Elara chapter 1 then received contradictory audit evidence: POV safety scored zero while its evidence said supplied POV canon was used; continuity also scored zero and no leak ID was named. The strict gate rejected it. Total run exposure was `$0.10373065`; cumulative conservative exposure is `$2.5947876`. Same-cap recovery would project `$3.0187876`. Report version 6 therefore permits only a cap decrease and non-runtime source drift, preserves complete pairs with original trace SHAs, and requires every source artifact's full hash and metadata in the committed resume registry. Resuming ten chapters at `$0.0405` projects `$2.9997876`, leaving `$0.0002124`.
- The version 6 resume committed Elara chapter 1 at `$0.03700975`. Elara chapter 2 spent `$0.03383925`, then its audit reservation missed the chapter cap by `$0.000470`. Total attempts are `$0.17457965`; cumulative conservative exposure is `$2.6656366`. Pair-only recovery is now mathematically impossible: ten pending chapters require a cap at most `$0.03343634`, while retained Rowan chapter 2 requires at least `$0.038406625`.
- ADR-011 introduces report version 7. It retains authenticated contiguous prefixes, reconstructs Elara chapter 1 state from the accepted trace, preserves mixed source caps, and makes an integer nano-USD SQLite request ledger authoritative. Each generation reservation commits before transport; known usage settles before validation; unknown usage and crashes keep full exposure. Atomic report checkpoints preserve every committed chapter.
- Durable recovery now distinguishes safe and unsafe interruption. A dead process with zero active reservations can transfer PID ownership of the same stable run ID only after its append-only sidecar exactly matches settled exposure. An extension produces a reconciliation-only report, retains the lock until that report commits, and exits before replay or provider access. An active reservation remains an external stop. All live suites share the ledger; a fresh chain can start only by folding the exact durable total into its new prior spend.
- The version 7 resume retained Rowan and Elara chapter 1, then committed Elara chapter 2 at `$0.03873475`. Maelin chapter 1 produced an 812-word draft after `$0.030771625` of intent, frame, and narration exposure. The strict 900-word gate rejected it; a full Terra retry could not fit the chapter. Four results are valid. Cumulative exposure is `$2.735142975`, leaving `$0.264857025` for eight chapters.
- The prompt `1.4.9` seed-input baseline measured 5,162 to 5,572 bytes per background-agent instruction and 5,387 to 5,821 bytes per frame prompt. A fresh twelve-cycle Luna-narration counterfactual using the four valid phase costs is `$0.26794545`, which exceeds remaining headroom before accounting for the heavier three-agent POV mix. The next behavior slice must therefore retain every canon and audit gate while compacting lossless background/frame context and shortening the narration target. The archived Terra results remain baseline evidence but will not count toward the new release matrix.
- ADR-012 introduces prompt `1.4.10`. Luna becomes the primary narrator while Terra remains the custom-action translator. Labeled maps and tuples preserve every background POV, provenance, visibility, skill, secret, and public-world value, reducing seed agent instructions to 4,083–4,374 bytes and frames to 4,293–4,608 bytes. Narration targets 900–925 words. Sole-failure recovery expands to 800–899 words with a dynamic maximum of 230 output tokens; merged prose still reruns the unchanged 900–1,300 gate and full audit. Current writes require `1.4.10`; persisted reads accept matching authenticated `1.4.9` records. A three-agent 812-word regression passes under `$0.0405` without token counting. The old four Terra chapters will not count toward the fresh release matrix.
- Prompt `1.4.10` committed Rowan chapter 1, then failed Rowan chapter 2 after three short narrations, two failed continuations, and one disputed audit. The report retained only accepted prose, so the leak claim could not be adjudicated. Fifteen known attempts cost `$0.0512422`; global exposure reached `$2.786385175` and left `$0.213614825`.
- ADR-013 introduces prompt `1.4.11`, runtime schema `1.1.0-runtime-candidates-4`, and live report version 8. Generation calls explicitly disable prompt caching and reserve ordinary input. Audit failures require exact prose evidence and canonical fact anchors, invalid audits retry the same prose, recovery aligns to 900–925 words, and reports preserve every rejected narrative candidate without exposing it to the reader. Compact application-owned intent and frame envelopes preserve exact domain values. Provider token counts and minimum structural output savings project `$0.207336`, leaving `$0.006278825` under the remaining global headroom before additional narration and audit savings.
- ADR-014 adds explicit service-tier provenance without changing prompt behavior. Product requests send Standard; the full release script sends Flex. Runtime schema `1.1.0-runtime-candidates-5`, live report version 9, and ledger version 2 preserve requested and returned tier through attempts, calls, traces, sidecars, reservations, interruption receipts, and resumes. Historical rows migrate as Standard without changing exposure. Exact code projections are `$0.208988` Standard and `$0.104494` Flex.

## Decision Log

- See `decisions/`.
- Fixed 50-chapter act boundaries are authoritative; early terminal endings may end the story but do not create shortened nonterminal acts.
- `World Director` is deterministic application code for MVP. Models emit intents and prose only; no model owns conflict resolution or canonical state.
- `WorldState.chapter` means last committed chapter. Generation from 349 may create terminal chapter 350. Any request when current chapter is 350 is rejected before model access.
- Validated narration uses buffer-audit-replay streaming. This trades first-token latency for zero exposure of rejected prose.
- ADR-008 routes title and option ranking to Luna while application code owns the final chapter frame. ADR-012 moves narration to Luna; Terra remains the custom-action translator. The full live eval still allows all three relevant background agents.
- ADR-012 permits one bounded Luna continuation only for an otherwise-valid 800-to-899-word draft. It does not weaken the absolute 900-to-1,300-word gate.
- ADR-010 permits official input-token counting to narrow a byte reservation. Failed counting keeps the byte bound. Actual overrun aborts before commit with exact accounting.
- Prompt `1.4.9` distinguishes reader access to selected-POV private canon from an in-world knowledge transfer. It does not auto-approve empty leak lists or weaken forbidden fact and remote-effect checks.
- ADR-011 replaces pair-only live recovery and static suite rejection with authenticated prefix recovery plus durable request-level global reservations. Static projection stays visible but cannot reclaim or spend exposure.
- Version 7 authenticates each retained result's source cap. Every new result cap must equal the current run cap; mixed caps cannot be forged to pass the cost gate.
- ADR-013 makes prompt-cache behavior explicit, grounds audit failures in retained prose, and moves new live evidence to strict report version 8. Canon, three background agents, deterministic validation, full independent audit, and atomic commit remain unchanged.
- ADR-014 keeps product traffic explicitly Standard and requires Flex for version 9 full release reports. Requested and returned tier, pricing version, and projection must agree; missing, mixed, auto, mismatched, or retained poisoned evidence fails closed.
- Responses rejects Zod fixed tuples because their generated JSON Schema uses an unsupported array-valued `items`. Runtime candidates therefore use compact strict objects and homogeneous argument arrays, followed by exact deterministic decoding and canonical schema validation.
- Version 8 creates one turn identity before model access; binds accepted results, candidates, raw narration, recovery, and audit responses, retry groups for intent and narrative calls, committed chapter requests, traces, and stream chunks to it; deterministically restages full before and after state; preserves raw malformed audit text; carries authenticated legacy gaps across resumes; and recomputes every release gate from evidence.

## Outcomes and Retrospective

- Phases 1 through 4 and Phase 6 are implemented. Offline contracts, deterministic transitions, knowledge boundaries, atomic storage, both OpenAI adapters, product UI, README, architecture, screenshots, and demo path are green. Phase 5 has green live smoke and awaits the complete twelve-cycle release report.

## Current Milestone

Phase 5 release eval: prompt `1.4.11` locally preserves exact failed candidates, grounds audit rejections, stops after same-prose audit exhaustion, aligns recovery, and disables implicit cache writes. Exact checkpoint reconciliation permanently charged the interrupted unknown request at its full maximum; the durable ledger has zero lock, zero active reservations, one uncertain reservation, exposure `$2.811082175`, and headroom `$0.188917825`. Explicit Flex processing reproduces the `$0.104494` matrix, requires matching provider tier evidence, and projects final exposure `$2.915576175`. Full non-live gates and independent review pass. Create the clean checkpoint, pass clean-clone verification, and run the exact ledger preflight before the single paid twelve-cycle attempt. No automatic retry.
