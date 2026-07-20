# Prompt Boundary

Prompts execute only on the server, so their implementation lives in [`../../app/src/server/story/prompts.ts`](../../app/src/server/story/prompts.ts), beside the story orchestration that supplies their inputs. Shared code exports the strict contracts and deterministic POV projections consumed by those builders.

The builders keep stable instructions separate from dynamic state, label compact context fields, and give narration only selected-character knowledge plus visible prospective effects. API keys never enter prompts or traces.

Every AI-behavior change requires a recorded baseline, a named regression, a prompt-version bump, and the non-live gates before another capped live run. See [`../../evals/README.md`](../../evals/README.md) and [`../../docs/STATUS.md`](../../docs/STATUS.md).
