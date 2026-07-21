# ADR-023: Unbounded Generation and Fixed Quality Bar

- Status: Accepted
- Date: 2026-07-21

## Context

Prompt `1.5.0` committed no chapter. A local output ceiling cut off Sol narration, then a chapter-cost ceiling blocked its retry. Earlier word-range recovery added calls without proving scene quality. Repeated cap adjustment created a loop while six ten-chapter stories remained unavailable for review.

Genre research now defines a fixed pass bar in `research/2026-07-21-litrpg-good-enough.md`.

## Decision

- Bump prompts to `1.6.0`. Preserve `1.5.0` for authenticated historical reads.
- Omit `max_output_tokens` from Responses API requests. Provider hard limits remain external facts, not application policy.
- Remove active per-chapter and aggregate cost enforcement from product and six-story review generation. Keep actual usage, reservations, interruption state, and cost telemetry.
- Remove prose word ranges, prompt byte ceilings, tail recovery, and stored prose-size ceilings. Require nonempty, complete, validated scenes.
- Use Sol medium for chapter frame and narration, Terra low for narrative audit, and Luna for at most three POV-safe background intents.
- Give frame, narrator, and audit full prior chapter prose. Give background characters a per-chapter POV-safe canon history, never raw selected-POV prose.
- Add a repeating ten-chapter arc guide: commitment, setup, escalation, convergence, payoff.
- Keep strict schemas, canon staging, atomic commit, POV safety, source provenance, chapter 100 demo approval, chapter 350 terminal, no chapter 351, request timeout, and at most two retries.
- Define completion as six independently passing ten-chapter stories plus recorded human review. Do not tune the bar after seeing output.

## Consequences

Quality failures can use finite provider retries without a local money, output-token, byte, or word-count stop. Runs remain finite through the 60-chapter review horizon, retry count, timeouts, and terminal rules. Actual spend stays visible in Developer evidence and hidden from the Reader.

Historical capped reports and ADRs remain evidence only. They no longer describe the current product or six-story review command.
