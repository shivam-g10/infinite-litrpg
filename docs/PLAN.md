# Living Plan

Updated: 2026-07-21

## Current goal

Prepare the local app for direct human demo and chapter-by-chapter review.

## Done

- Click-based reincarnation and System creator with sensible defaults.
- Optional user protagonist name plus fresh generated cast and world vocabulary.
- Origin-focused Chapter 1 prompt and audit.
- Per-story background generation state and library switching.
- NDJSON phase progress, reload recovery, latest-chapter reroll, reject, restart, and reader-safe exports.
- One SQLite database and one Markdown file per chapter under ignored `stories/`.
- Concurrent Luna fallback plus optional native Multi-agent adapter.
- Clean Reader with developer telemetry removed.
- Obsolete paid eval, cost-ledger, review-packet, demo-seed, migration, and old screenshot code removed.
- README, architecture, product, security, demo, review, and status docs rebuilt around the current app.

## Acceptance gates

- [x] All provider-free gate components pass: format, lint, strict typecheck, unit tests, offline evals, build, E2E, scans, licenses, audit, and diff check.
- [x] Desktop and mobile creator paths pass without browser errors.
- [x] Story library API returns 200 on a clean server start.
- [x] Create, open, switch, generate, progress, reroll, reject, and export work in browser.
- [x] Generation in one story does not block another story.
- [ ] Clean clone setup works.
- [ ] Human reviews at least ten contiguous chapters from a fresh story.
- [ ] User approves the demo experience.

## Stop condition

Stop after one verification stretch and browser smoke test. Human story judgment and release publication remain user gates. Do not restart live eval loops.
