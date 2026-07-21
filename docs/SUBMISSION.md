# Build Week Submission Packet

## Submission Fields

| Field               | Value                                                | State                   |
| ------------------- | ---------------------------------------------------- | ----------------------- |
| Project             | Infinite LitRPG                                      | Ready                   |
| Track               | Apps for Your Life                                   | Ready                   |
| Tagline             | Choose one life. The world keeps moving without you. | Ready                   |
| Repository          | `https://github.com/shivam-g10/infinite-litrpg`      | Public; build unpushed  |
| License             | MIT                                                  | Ready                   |
| Private fallback    | `testing@devpost.com`, `build-week-event@openai.com` | Not needed while public |
| Demo video          | Public YouTube URL                                   | User recording gate     |
| Codex Session ID    | Primary build task `/feedback` ID                    | User input gate         |
| Final live evidence | Human-approved corrected six-POV report              | Paid correction blocked |

## Paste-Ready Description

Infinite LitRPG is a local, bring-your-own-key story engine for living inside one character's perspective while a six-character fantasy world moves independently around them.

The original Ashen Crown setting begins after Demon King Malachar dies and reincarnates as Rowan Ashborn. Players choose one of six characters. That viewpoint locks permanently for the local world. Every turn combines the player's action with up to three goal-driven background-character intents, resolves one deterministic canonical delta, writes a viewpoint-safe chapter, audits it, and commits the full state transition atomically.

The project treats AI output as untrusted intent or prose. GPT-5.6 models never mutate canon. Strict TypeScript schemas, deterministic validation, knowledge ledgers, one canonical state writer, versioned traces, bounded cost, and a hard chapter-350 terminal guard make the story inspectable and reproducible. Reader mode exposes only selected-character knowledge. God Mode shows the complete intent, delta, audit, usage, cost, latency, and state-hash trail.

Everything runs locally with SQLite and the user's OpenAI API key. There is no account, hosted service, payment system, analytics, public feed, or secret sent to the browser.

## Core Features

- Six selectable characters with permanent viewpoint lock.
- Original seven-act reincarnated Demon King world.
- Up to three active background-character agents per chapter.
- Deterministic single-writer canon and atomic SQLite commits.
- POV knowledge filtering plus independent narrative audit.
- Two suggested choices and strict custom-action translation.
- Routine continuation to meaningful decisions with exact batch cost confirmation.
- Chapter-100 demo horizon without changing the chapter-350 engine.
- Reader and full-canon God Mode views.
- Exact model, service-tier, token, cost, latency, retry, and state-hash traces.
- One thousand offline simulations and hard chapter-351 rejection.
- Sequential Luna fallback plus isolated native Multi-agent adapter.

## GPT-5.6 Use

| Role                                       | Model         |
| ------------------------------------------ | ------------- |
| Custom-action translation                  | GPT-5.6 Terra |
| Background intents                         | GPT-5.6 Luna  |
| Story frame and narration                  | GPT-5.6 Sol   |
| Independent narrative and continuity audit | GPT-5.6 Terra |

Only the OpenAI Responses API is used. Product runtime requests Standard processing. Release evaluation uses explicitly isolated Flex processing with returned-tier verification and tier-aware accounting.

## Codex Collaboration

Codex accelerated the full build loop:

- researched current OpenAI API and Build Week requirements from primary sources;
- created visual concepts before frontend implementation;
- designed strict schemas, deterministic state transitions, SQLite atomicity, and model adapters;
- established eval baselines before every AI behavior change;
- converted live failures into named regression tests;
- tested desktop and mobile click-to-result behavior in a real browser;
- performed independent code, security, cost, and provenance reviews;
- maintained the living plan, decision records, evidence log, and clean-clone verifier.

Key product decisions stayed explicit: one canonical writer, selected-POV knowledge only, accepted `WorldDelta` as the sole source of new canon, no chapter 351 path, local bring-your-own-key runtime, and no hosted product surface.

## Judge Test Path

1. Install Node.js 24 and npm 11.
2. Run `npm ci`.
3. Copy `.env.example` to `.env` and add an OpenAI API key with GPT-5.6 access.
4. Run `npm run dev`.
5. Open `http://127.0.0.1:3000`.
6. Select Rowan, take a suggested action, read the committed chapter, and inspect the exact `Continue to next decision` plan.
7. Open God Mode.
8. Run `npm run check` for every non-live gate.

No sample data import is needed. The Ashen Crown world seeds automatically into ignored local SQLite state.

## Evidence Manifest

- [README and setup](../README.md)
- [Architecture](ARCHITECTURE.md)
- [Current verified status](STATUS.md)
- [Human review guide](HUMAN_REVIEW.md)
- [Fresh six-story review marker; six ten-chapter stories pending](SAMPLE_STORIES.md)
- [Eval contract](../evals/README.md)
- [Narrative rubric](../evals/RUBRIC.md)
- [Desktop reader](screenshots/reader-desktop.png)
- [Desktop God Mode](screenshots/god-mode-desktop.png)
- [Mobile reader](screenshots/reader-mobile.png)
- [Timed demo script](DEMO_SCRIPT.md)
- [Current non-live gate output](evidence/non-live-gates.md)
- [Complete Rowan chapter trace](evidence/rowan-chapter-1-trace.json)

## Final Release Gates

- [ ] Strict full live report contains twelve valid commits across six POVs.
- [ ] Six POV packets pass human narrative review.
- [ ] Six contiguous ten-chapter stories pass human progression review.
- [x] Repository is public with an MIT license.
- [ ] Current release checkpoint is pushed after user authorization.
- [ ] Public YouTube demo is approved and below three minutes.
- [ ] Primary Codex `/feedback` Session ID is supplied.
- [ ] User authorizes final Devpost submission.
