# OpenAI Input-Token Counting

## Question

Can the runtime replace an excessively conservative byte reservation without weakening the per-chapter cost gate?

## Sources

- [Responses input-token count API](https://developers.openai.com/api/reference/resources/responses/subresources/input_tokens/methods/count), accessed 2026-07-19.
- [GPT-5.6 model pricing](https://developers.openai.com/api/docs/models/compare), accessed 2026-07-19.
- Installed OpenAI TypeScript SDK `6.48.0`, `resources/responses/input-tokens`, inspected 2026-07-19.

## Facts

- `POST /responses/input_tokens` returns `object: "response.input_tokens"` and an `input_tokens` count.
- The endpoint accepts the generation input, instructions, model, reasoning settings, and structured text format.
- The installed SDK exposes it as `client.responses.inputTokens.count`.
- GPT-5.6 cache writes cost `1.25x` uncached input. Luna costs `$1` input and `$6` output per million tokens. Terra costs `$2.50` input and `$15` output per million tokens.
- The reconstructed Rowan narration request counted 1,260 input tokens, exactly matching live usage.
- The reconstructed Rowan audit counted 2,931 input tokens. The accepted live audit reported 2,947 input tokens.
- The API reference returns no generation usage or cost field for a count response.

## Inference

- The official count is a stronger request-specific input bound than treating every UTF-8 byte as a token.
- Pricing every counted input token at the higher cache-write rate, adding 512 safety tokens, and adding maximum output remains conservative.
- The existing byte estimate must remain the fallback. A counter error must never open the generation gate.

## Unknowns

- OpenAI documentation does not state billing treatment for the input-token count endpoint. The project ledger treats it as a metering call because it returns no usage or generated output.
- The beta input-token counter does not accept the native Multi-agent configuration, so native calls cannot use this narrowing path.

## Decision Impact

- Stable structured and streamed calls use the byte bound when it fits.
- Only a byte-bound failure triggers one counter call with a 10-second timeout and no SDK retry.
- The generation reservation uses counted input plus 512 tokens at the cache-write rate and maximum output.
- Invalid or failed counting returns the byte bound, so generation remains blocked.
- Actual usage above any counted reservation aborts before commit and is recorded exactly.
