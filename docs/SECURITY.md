# Security

## Secrets

- Put `OPENAI_API_KEY` in root `.env`.
- Only server modules read it.
- `.env`, databases, logs, generated stories, and eval reports are Git-ignored.
- Errors, traces, exports, screenshots, and client payloads must not contain the key or request headers.
- Run `npm run security:secrets` and `npm run security:bundle` before release.

## Untrusted model output

- Parse structured output with strict Zod schemas.
- Reject unknown fields, incomplete responses, refusals, invalid actions, and illegal mutations.
- Agents emit intent only. Deterministic code builds the accepted delta.
- Buffer narration until deterministic checks and the independent audit pass.
- Commit the world version, delta, knowledge, chapter, trace, and usage in one SQLite transaction.
- A failed request makes no canonical mutation.

## Reader boundary

- Reader responses contain only POV-safe state and prose.
- Raw prompts, hidden facts, other character ledgers, audit instructions, traces, usage, latency, and costs stay server-side.
- Markdown and JSON exports are reader-safe.

## Runtime controls

- One active turn per story and idempotent request receipts prevent duplicate commits.
- Model calls have finite retries and timeouts.
- Background intent concurrency is capped at three.
- Chapter 351 is rejected before a model call.

## Content

- Generate original settings and characters.
- Do not request living-author imitation or protected-universe copying.
- Adult fantasy violence is allowed. Explicit sexual content and sexual content involving minors are not.

## Release gate

- Secret scan clean.
- Client bundle scan clean.
- Dependency audit clean.
- License inventory contains no blocked license.
- Browser error paths do not echo private inputs.
