# ADR-010 Counted Input Reservations

- Status: Accepted
- Date: 2026-07-19

## Context

The prompt `1.4.8` release baseline passed Rowan chapter 1. Rowan chapter 2 then spent `$0.031564875` before audit. Its 12,545-byte audit request reserved `$0.01902125`, exceeding the `$0.018435125` left under the `$0.05` chapter cap by `$0.000586125`.

The byte policy deliberately treats every UTF-8 byte as a possible input token. The official Responses input-token endpoint counted similar accepted narration and audit requests at 1,260 and 2,931 tokens. Live usage reported 1,260 and 2,947 tokens.

## Decision

- Keep the byte reservation as the first and fallback bound.
- Only when the byte bound does not fit, call `responses.inputTokens.count` with the exact stable Responses input fields.
- Give counting 10 seconds and no SDK retry.
- Reserve the returned count plus 512 safety tokens, price all input at the cache-write rate, and add maximum output.
- Reject invalid count responses and fall back to the byte bound.
- If actual usage exceeds a counted reservation, abort before commit and retain exact usage and cost in the failure trace.
- Keep native Multi-agent on byte reservations.

## Reason

This removes false byte-bound failures without changing prompts, model output, audit coverage, background-agent count, or the `$3` live-eval ceiling. Conservatively substituting the higher 2,947-token live audit usage for the 2,931-token counter result, the failed Rowan chapter-two checkpoint would reserve `$0.038588625`, below the next `$0.0446` cap.

## Consequences

- Stable calls may add one non-generation metering request only when the byte bound would otherwise block.
- Counter failure never permits generation.
- Dynamic narration retries cache the exact input used by counting and generation for each attempt.
- The full seven-dimension audit and maximum-three-agent gate remain unchanged.
- The count endpoint returns no usage or cost. Its billing treatment remains an explicitly documented unknown.
