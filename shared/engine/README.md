# Deterministic Engine

Framework-independent domain logic lives in [`../src/engine`](../src/engine):

- `resolver.ts` validates player and background intent, resolves conflicts, and produces the only accepted `WorldDelta`.
- `delta.ts` stages prospective state without mutating canon.
- `knowledge.ts` builds the locked-POV context and enforces fact visibility.
- `clock.ts` owns act boundaries, milestone pressure, chapter 350 terminal state, and the no-chapter-351 guard.
- `narrative.ts` validates prose, choices, audit results, and safe chapter frames.
- `validation.ts` returns typed deterministic issues.

The app server owns the single atomic SQLite commit after this engine accepts a prospective turn. Background agents emit intent only.

Run `npm run test` for unit and regression coverage. Run `npm run evals` for 1,000 seeded resolutions, all act boundaries, POV attacks, and the full terminal horizon.
