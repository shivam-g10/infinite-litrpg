# ADR-021: Ten-Chapter Progression Review

- Status: Accepted
- Date: 2026-07-21
- Amendment: ADR-022 replaces the branch policy, prompt, and cost ceilings after the first paid quality baseline. The remaining evidence contract stays active.

## Context

One passed excerpt per viewpoint proves neither continuity nor progression. Existing authentic evidence contains only chapters 1 and 2. The version 9 live matrix and its recovery rules deliberately require exactly two chapters per viewpoint and must not be widened for a separate review need.

## Decision

Use a separate long-form review runner.

- Generate one fresh chapter-1-through-10 branch for each of the six fixed viewpoints.
- Select the first offered in-world choice for every generated chapter. Never inject one repeated custom action.
- Keep up to three background characters on the sequential Luna fallback.
- Commit through the production `StoryService`; do not use prose fixtures or browser mocks.
- Track every canonical chapter record, committed world delta, matching trace, and final state. Restage every delta, verify state and usage totals, and derive the readable summary and hashes during every check; never trust a standalone summary.
- Publish only chapters with a passed runtime audit, contiguous world versions, current prompt and Git provenance, exact chapter, prose, and trace hashes, and Flex response receipts.
- Show the selected action before each chapter so review can judge choice fulfillment.
- Keep the version 9 two-chapter release matrix unchanged.
- Use an isolated durable ledger. One uninterrupted chapter attempt chain, including known failed turns restored from its story database, has a `$0.0424` runtime budget. A hard-killed unknown request is charged at full reservation to the aggregate ledger; a resumed retry can therefore take lifetime exposure for that chapter above `$0.0424`. All 60 chapters and resumes together may expose at most `$2.544` in Responses generation exposure. Input-token count endpoint billing is outside that ledger.
- Disable SDK retries. Keep one stable run ID across suffix resumes. Recover a dead process by charging unknown requests at full reservation before releasing its lock.
- Require a clean commit and exact cost flags before provider access. Preflight remains read-only and provider-free, with one committed-prefix count per viewpoint.
- Allow provider-free artifact finalization after all 60 commits. This recovery path accepts no unrelated worktree change.
- Bind the generated source Git SHA to the review checkout. Only named review-document bridges may differ; any runtime, verifier, dependency, or unrelated worktree change makes the pack stale.

## Consequences

Human review gets six coherent ten-chapter stories plus the action that led into each chapter. Generation can resume from visible committed prefixes without relabeling old evidence. A clean clone can restage the canonical commit chain before accepting the Markdown. The new spend does not consume or mutate the release-eval ledger. A missing chapter, failed audit, active reservation, mixed source, or stale generated Markdown blocks review. Conservatively charged uncertain exposure remains visible and reduces headroom.
