# Contracts

The implemented strict Zod contracts live in [`../src/contracts`](../src/contracts). They cover world and character state, knowledge ledgers, arcs, player and background intents, accepted deltas, chapter frames and records, model calls, attempts, successful traces, and failed-turn traces.

Rules:

- Current model output uses strict schemas with unknown fields rejected.
- Persisted schemas explicitly admit authenticated historical prompt versions where migration requires them.
- TypeScript types are inferred from the schemas and exported through [`../src/index.ts`](../src/index.ts).
- Model output remains untrusted until parsing and deterministic validation both pass.

Verify with `npm run typecheck`, `npm run test`, and `npm run evals` from the repository root.
