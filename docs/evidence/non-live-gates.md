# Non-Live Release Evidence

- Verified: 2026-07-20
- Scope: release-artifact checkpoint `066f43e4cfe5f52ad231c8d681439c146408705b`
- Paid generation calls: zero

## Full Gate

`npm run check` exited `0` in 37.5 seconds.

- Prettier: passed.
- ESLint: passed with no warning.
- Strict TypeScript: shared, app, and tools passed.
- Vitest: 17 files, 226 tests passed.
- Offline eval: 14 invariant cases, 12 POV attacks across six viewpoints, 1,000 seeded simulations, 35 transitions, chapter 350 terminal, chapter 351 blocked.
- Production build: passed.
- Playwright: 17 passed, one intentional desktop skip. Desktop and mobile God Mode checks include current prompt `1.4.11`, runtime schema `1.1.0-runtime-candidates-5`, state-hash non-overlap, and zero horizontal overflow.
- Secret scan: passed across 187 working files, ignored logs and reports, and Git history.
- Client bundle: no API key name, configured value, or key-shaped token.
- Licenses: 526 installed packages passed.

`npm audit --audit-level=low` exited `0` with zero vulnerabilities. `git diff --check` exited `0`.

## Clean Clone

`npm run verify:clean-clone` exited `0` in 54.1 seconds; the verifier reported its isolated gate in 50.8 seconds. A temporary clone of commit `066f43e4cfe5f52ad231c8d681439c146408705b` completed `npm ci` with zero vulnerabilities, then passed format, lint, strict typecheck, 226 tests, every offline eval, production build, 17 E2E passes with one intentional skip, both security scans, and 526 licenses.

## Resume Continuity Gate

The authenticated partial report SHA-256 `447f860a0e918198d246fef37671f16db3664ef76887fba390eaaabc77f9eddd` parses as version 9, prompt `1.4.11`, sequential Flex evidence. Checkpoint authentication returns 27 exact bridge files. File hashing reads raw bytes, so the three PNG screenshots are bound without text decoding. Regressions admit the audited 35-path release slice, enforce a 30-file bridge ceiling, reject 31 bridge files, and verify both attempt-level and call-level Flex provenance. No provider request ran.

## Review-Packet Gate

The offline packet CLI parsed the authenticated partial version 9 report, exited `1`, and returned `Review packets require one strict, fully green version 9 full report`. This proves the current two-chapter Rowan report cannot create release packets.

## Browser QA

The checked `demo:seed` command authenticated report SHA-256 `447f860a0e918198d246fef37671f16db3664ef76887fba390eaaabc77f9eddd`, restored Rowan chapter 1 with its exact canonical title, choices, player action, prose, state, and trace, and made no model request.

In the in-app browser:

- all six selectable profiles rendered;
- selecting Elara changed the detail panel and exposed one `Begin as Elara` control;
- restored Rowan Reader and God Mode rendered at desktop and mobile breakpoints;
- Reader showed the authenticated title `Read the Ash Trail` and exact report choices;
- Reader and God Mode had one header each and no horizontal overflow;
- desktop trace hashes stayed inside their rows without label overlap;
- console error and warning log was empty.

Screenshots are viewport captures, not stitched full pages:

| File                   |      Pixels | SHA-256                                                            |
| ---------------------- | ----------: | ------------------------------------------------------------------ |
| `reader-desktop.png`   | 1265 by 712 | `ef6b3cd455db62eb5ac52d246955866782b0949ee412f96dea47a308380d508e` |
| `god-mode-desktop.png` | 1265 by 712 | `6d2a2d06dd664041ad53f38c92dbb99a356b4100069c2e22c1500141f3f099df` |
| `reader-mobile.png`    |  375 by 812 | `3d100d7460b172bddffacbb5c9e2f3818d141dbfcd6b294530f4d7a5676df820` |

## Independent Review Fixes

Read-only review found four release-evidence defects. The packet verifier now requires one exact human-review marker pair, keeps full future milestones only in the reviewer appendix, strict-parses and cross-checks manifest provenance, and rejects marker injection. Demo restore now commits and verifies the exact authenticated chapter record. The obsolete automatic weak packet writer was removed; only the strict offline CLI can publish review packets. Strict typecheck and 38 focused packet, resume, and restore tests pass. No provider request ran.

## Trace Artifact

`rowan-chapter-1-trace.json` parses through the production persisted-trace schema. Its attempt costs and usage exactly total to the envelope, every attempt is Flex, the gate passed, prompt version is `1.4.11`, and runtime schema is `1.1.0-runtime-candidates-5`.

- Tracked artifact SHA-256: `12bd67727460c57d4387a1d63bff741341db015024310139f83eaa45f40ee0d3`
- Source report SHA-256: `447f860a0e918198d246fef37671f16db3664ef76887fba390eaaabc77f9eddd`
- Source Git SHA: `4d47dfb7c748b9d620a81f37a849bf4c96b14edb`
