# Prompt Cache and Prompt 1.4.10 Live Failure

- Date: 2026-07-20
- Scope: official OpenAI behavior plus local prompt `1.4.10` report evidence

## Facts

- OpenAI enables implicit prompt caching by default for eligible prompts of at least 1,024 tokens. GPT-5.6 cache writes cost `1.25x` ordinary input, cached reads cost less, and usage reports both write and read tokens. Exact prefix matches are required. Source: [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).
- GPT-5.6 supports `prompt_cache_options.mode: "explicit"`. With no explicit breakpoint, explicit mode disables prompt caching and cache-write charges. Source: [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching#prompt-cache-breakpoints).
- GPT-5.6 Luna costs `$1` per million ordinary input tokens, `$0.10` per million cached input tokens, and `$6` per million output tokens. Cache writes cost `1.25x` ordinary input. Source: [GPT-5.6 Luna model](https://developers.openai.com/api/docs/models/gpt-5.6-luna).
- `POST /responses/input_tokens` returns an input-token count for a request. It does not return generation usage or cost. Source: [Get input token counts](https://developers.openai.com/api/reference/resources/responses/subresources/input_tokens/methods/count).
- The prompt `1.4.10` report recorded cache writes, not reads, for every first attempt. Rowan chapter 1 wrote 1,571 agent tokens, 1,235 frame tokens, 1,323 narration tokens, and 2,774 audit tokens. Rowan chapter 2 first attempts also wrote their prompt inputs. Only repeated narration prompts received cached reads.
- All four raw Luna narrations were short: 857, 820, 872, and 800 words. Two recovery calls failed the auxiliary continuation range. One final merged draft reached audit. Its audit rationale called Rowan's allowed reincarnation identity forbidden, named `malachar-contained-the-void`, and rejected continuity. The rejected prose is absent, so the named leak and continuity defect cannot be adjudicated.

## Inference

- Implicit caching is a net loss for unique agent, frame, narration, and audit prompts. Explicit mode without breakpoints should remove the `25%` cache-write premium while leaving prompt content unchanged.
- Repeated-request cache savings matter only after a failed first attempt. Length compliance, merged-draft validation, and grounded audit retries must remove that expensive path before disabling caching can be treated as a safe end-to-end saving.
- A bare leaked fact ID is not sufficient audit evidence. An exact prose quote plus deterministic fact-anchor overlap can reject the observed false rationale without accepting a real hidden-fact paraphrase.

## Unknowns

- Provider-bill access is unavailable, so local generation usage remains the only reconciled cost source.
- The input-token count endpoint's billing treatment is not established by the cited reference. Do not assume count requests are free or use them outside the existing guarded fallback.
- The final rejected Rowan prose and its two failed continuations were not persisted. Their actual quality and word counts are unknowable.

## Decision Impact

- Add failed-candidate evidence before another live request.
- Set GPT-5.6 requests to explicit cache mode with no breakpoints and reserve ordinary input cost plus the existing safety margin.
- Preserve the hard 900 to 1,300 word gate. Align the auxiliary recovery acceptance with the declared target instead of rejecting a valid merged chapter early.
- Ground hard audit failures in exact prose. Retry an invalid audit on the same prose instead of immediately buying another narration.
- Bump prompt and report versions for the changed prompt, schema, and evidence semantics. Run no paid call until the fresh twelve-cycle cost proof fits the remaining `$0.213614825` headroom.

## Cost Check

- Repricing all 15 recorded attempts with explicit no-cache Luna input yields `$0.049801`, versus actual `$0.0512422`.
- Clean Rowan chapter 1 falls from `$0.01705675` to `$0.015331`.
- Failed Rowan chapter 2 rises from `$0.03418545` to `$0.03447` because two repeated narration requests lose cached-read savings.
- Twelve clean Rowan-chapter-1 paths cost `$0.183972`. The fixed six-POV schedule adds sixteen background-agent calls. Pricing them at the largest observed no-cache agent cost projects `$0.223732`, exceeding headroom by `$0.010117175`.
- Removing all observed recovery cost still leaves a `$0.002365175` overflow. The next step is lossless request compaction and retry elimination, not a paid run.
- The first compact tuple probe failed at the provider with HTTP 400: fixed Zod tuples emitted array-valued `items`, which Responses rejected. Compact strict objects with a homogeneous action-argument array passed sequential, native-batch, and frame token-count validation.
- Across all six POVs, exact provider counts save 221 background input tokens per call. Twenty-eight calls save 6,188 tokens. Frame changes save another 420 input tokens across twelve chapters.
- Same-model exact JSON pair counts show a minimum structural saving of 48 output tokens across all eight background actions and one output token per frame. The original calculation incorrectly valued saved ordinary input at the `$1.25` cache-write rate. Explicit no-cache Luna input costs `$1` per million, so the corrected Standard saving is `$0.014744` and the corrected twelve-cycle projection is `$0.208988`.
- Before the interrupted run, corrected Standard margin was `$0.004626825` under `$0.213614825`. The interruption raised durable exposure to `$2.811082175`, so Standard now exceeds remaining headroom by `$0.020070175`. Deterministic chapter 1 and chapter 2 probes still show Rowan has the largest combined narration-plus-audit input among all six POVs.
- Eighty-seven input-token count requests were made while closing the schema and cost unknowns. No generation request ran. The count endpoint's billing treatment remains undocumented, so these requests are not represented in the local generation ledger.
