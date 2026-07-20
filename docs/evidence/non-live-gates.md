# Non-Live Release Evidence

- Verified: 2026-07-20
- Scope: human-review Reader and chapter-100 continuation checkpoint
- Paid generation calls in this scope: zero

## Full Gate

`npm run check` exited `0` in 42.5 seconds.

- Prettier: passed.
- ESLint: passed with no warning.
- Strict TypeScript: shared, app, and tools passed.
- Vitest: 18 files, 272 tests passed.
- Offline eval: 14 invariant cases, 12 POV attacks across six viewpoints, 1,000 seeded simulations, 35 transitions, chapter 350 terminal, chapter 351 blocked.
- Production build: passed.
- Playwright: 21 passed, one configured desktop skip. Desktop and mobile cover character selection, suggested and custom actions, retry, exact cost confirmation, routine continuation through chapter 100, stop-after-current, God Mode, exports, horizontal overflow, health, and reflected-input safety.
- Secret scan: passed across 215 working files, ignored logs and reports, and Git history.
- Client bundle: no API key name, configured value, or key-shaped token.
- Licenses: 526 installed packages passed.
- Six-story packet reproducibility: passed.
- Dependency audit: zero vulnerabilities.
- Diff hygiene: passed.

## Chapter-100 and Spend-Consent Gate

The shared policy plans routine continuation only through the next incomplete milestone or chapter 100. Starting from chapter 1, the browser test makes exactly 99 story POSTs: 97 strict `continue_story` requests and two player decisions. Approval boundaries are exact:

- 46 routine requests approved through chapter 47;
- 49 routine requests approved through chapter 97;
- two routine requests approved through chapter 100;
- zero chapter-101 requests.

Every routine request has a unique UUID and the exact current world version. The server rejects an approval beyond the current deterministic plan and rejects automatic continuation at chapter 100 before any model call. The Reader shows chapter count, per-chapter cap, worst-case total, and requires explicit confirmation. `Stop after this chapter` completes only the active atomic request.

## Six-Story Gate

`npm run demo:samples:check` authenticates the source review-packet manifest and exact packet hashes. The tracked pack selects one chapter-level human pass for Rowan, Elara, Maelin, Varek, Lucan, and Nyra, records each prose hash, and includes review fields.

- Artifact: `docs/SAMPLE_STORIES.md`
- SHA-256: `53c3f4e4faf12553ae7df443719b7b7546999ba20aa9d7c5fa1653cf1a1cfa38`
- Provider calls: zero

## Browser QA

`npm run demo:seed` restored authenticated Rowan chapter 1 from tracked demo evidence and made no model request. In the in-app browser:

- Reader had one page `h1`; God Mode had one page `h1` and structured panel headings;
- the normal action showed `Up to 46 chapters · maximum $4.6000`;
- confirmation showed chapter 47, `$4.6000` maximum, and `$0.1000` per-chapter cap;
- keyboard focus moved to the confirmation heading;
- native radio arrow navigation changed Rowan selection to Elara in E2E;
- desktop client and scroll widths both measured 1,425 pixels;
- mobile client and scroll widths both measured 375 pixels;
- no generation confirmation was accepted.

Both independent reviewers reran their focused suites after fixes. Every reported P0 through P3 finding closed, and neither reviewer found a new P0 through P2 defect.

Screenshots are viewport captures:

| File                   |      Pixels | SHA-256                                                            |
| ---------------------- | ----------: | ------------------------------------------------------------------ |
| `reader-desktop.png`   | 1425 by 990 | `f5500f4be3a6940e38a97ef165404a94045d6ed9ed49e3e99f8fe2e3a860e1d4` |
| `god-mode-desktop.png` | 1280 by 720 | `e1e73414f421c6726d93dbebeea44fd6c338610349972870f664ac8ed2355125` |
| `reader-mobile.png`    |  375 by 812 | `a3db8c74031bd2591cf797944db97961a442b84f80a343c102e78d80636b41d5` |

## Demo Evidence

`rowan-chapter-1-demo.json` strict-parses as canonical Rowan chapter 1, binds its full result hash, current prompt and contract versions, and source report SHA-256. The seed command restores exact state, chapter, trace, choices, prose, cost, and usage from this tracked file. It refuses to overwrite an existing save.

- Tracked artifact SHA-256: `bd8f7205b20698537f06ecafd38abf0b529f8e449de2b5ba068ae557e6686da8`
- Source report SHA-256: `90374f2e4ca49fe390fc6c64cd9412579efa7cdaa2c7e291f1b8a772127ea1bc`
- Provider calls: zero

## Clean Clone

Run after the green checkpoint commit. Record the exact commit and isolated result in `docs/STATUS.md` and this section before handoff.
