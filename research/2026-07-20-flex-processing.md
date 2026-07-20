# Flex Processing for the Release Eval

- Date: 2026-07-20
- Scope: official OpenAI Flex behavior, current ledger exposure, and the unchanged prompt `1.4.11` matrix

## Facts

- Flex uses the Responses API with `service_tier: "flex"`. It is intended for lower-priority work such as evaluations. It can be slower and can return Resource Unavailable 429 errors. Source: [Flex processing](https://developers.openai.com/api/docs/guides/flex-processing).
- The installed OpenAI SDK exposes returned `Response.service_tier`. Local strict fixtures map provider `default` to project Standard and provider `flex` to project Flex; missing, `auto`, `scale`, `priority`, or a different recognized tier fails.
- OpenAI states that a Flex Resource Unavailable 429 is not charged. Source: [Flex processing](https://developers.openai.com/api/docs/guides/flex-processing).
- Flex token prices are half Standard for GPT-5.6 Sol, Terra, and Luna. Luna is `$0.50` per million input tokens, `$0.05` cached input, `$0.625` cache write, and `$3` output. Source: [API pricing](https://developers.openai.com/api/docs/pricing?latest-pricing=flex).
- The project key cannot call organization usage or cost endpoints because it lacks `api.usage.read`. Local conservative accounting remains authoritative. Source: [Usage API](https://platform.openai.com/docs/api-reference/usage/audio_transcriptions_object).
- The interrupted prompt `1.4.11` run left three known attempts totaling `$0.010074` and one unknown narration request with maximum `$0.014623`. Exact reconciliation charged the unknown at full maximum. Durable exposure is `$2.811082175`; headroom is `$0.188917825`.
- The corrected Standard twelve-cycle clean-path projection is `$0.208988`. Applying Flex prices to the same tokens and calls gives `$0.104494`.

## Inference

- Full Flex is the smallest behavior-preserving path. Prompts, schemas, model IDs, six POVs, twelve chapters, three-agent maximum, canon validation, audit coverage, and word gates remain unchanged.
- Projected final conservative exposure is `$2.915576175`, leaving `$0.084423825`. This margin is larger than one full Flex clean matrix component budget but does not authorize automatic reruns.
- The existing 60-second chapter p95 gate must remain. Flex latency may cause a valid failure; changing the release gate would hide that result.

## Unknowns

- Exact latency and Resource Unavailable frequency for this twelve-cycle run are unknown until the single release attempt.
- Provider invoice equality remains unknowable without organization usage access.
- The exact SDK error object for a Flex Resource Unavailable 429 remains unknown. Until a provider response proves that shape, the runner keeps the full reservation for every ambiguous failure.

## Decision Impact

- Product requests stay Standard by default. Only an explicit release-eval option selects Flex.
- Bind requested and returned service tier into request construction, pricing version, reservations, attempts, traces, and the strict live report.
- Price byte bounds, counted-input bounds, known usage, static projection, and durable settlements with the same tier.
- Runtime schema `1.1.0-runtime-candidates-5`, live report version 9, and ledger version 2 implement the binding. Historical ledger rows migrate as Standard without changing nano-USD exposure.
- Do not weaken prompts, agents, audits, chapters, word count, or latency gates.
- Run no paid request until unit tests, full `npm run check`, independent review, clean commit, clean-clone verification, and an exact ledger preflight reproduce the projected fit.
