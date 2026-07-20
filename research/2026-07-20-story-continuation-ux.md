# Story Continuation UX

Date: 2026-07-20

## Question

How should Infinite LitRPG let a reader create a long story through chapter 100 without forcing an inconsequential choice after every chapter?

## Facts

- Progressive disclosure keeps the first screen focused on the most important action and reveals advanced controls only when requested. This improves learnability and reduces visible complexity. Source: [Nielsen Norman Group](https://www.nngroup.com/articles/progressive-disclosure/).
- Long operations need immediate, truthful status. Determinate progress is appropriate only when completion can be measured. Source: [Nielsen Norman Group](https://www.nngroup.com/articles/visibility-system-status/), [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/progress-indicators), and [Material Design](https://m2.material.io/components/progress-indicators).
- Normal progress updates should be programmatically announced without moving focus. Source: [W3C status messages](https://www.w3.org/WAI/WCAG21/Understanding/status-messages.html) and [W3C ARIA25](https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA25).
- Interruptive alerts should be rare and actionable. Source: [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/alerts).
- Long tasks should save progress and support returning later. Source: [GOV.UK task list pattern](https://design-system.service.gov.uk/components/task-list/).
- The current deterministic engine locks choices only when an act milestone must be resolved. Through chapter 100, those locks occur before chapters 48 and 98 when the relevant milestone is incomplete.
- The current server commits one chapter atomically per request. It already rejects stale versions, replays duplicate request IDs, and never calls the model for chapter 351.
- Stopping the browser response does not prove that provider work or the atomic commit stopped. The UI must not promise cancellation.

## Inference

- Default flow should be `read -> continue -> milestone decision -> continue`.
- Routine continuation must be a deterministic, server-validated action. The browser must never choose an arbitrary visible option.
- One click may run sequential single-chapter requests, updating after each commit. This preserves current idempotency and atomicity.
- A truthful stop control means `Stop after this chapter`. The active request finishes; no later request starts.
- A multi-chapter action must show its exact chapter count, per-chapter cap, and worst-case authorization before it starts. The server must reject a stale or broader approved stop chapter.
- Reader mode should show prose, chapter progress to 100, one primary action, and compact status. Canon details and God Mode remain optional disclosures.
- The full 350-chapter engine remains unchanged. Chapter 100 is a demo horizon, not a terminal story mutation.

## Unknowns

- No user study proves chapter 100 is the best first horizon.
- Provider latency varies, so the UI must not promise an ETA.
- The product has a per-chapter cost cap and a server-validated approved stop chapter, but no durable background job. A browser-led run therefore cannot safely promise unattended generation across reloads.

## Decision Impact

1. Add a strict `continue_story` command that resolves only the deterministic routine action and rejects milestone locks before provider work.
2. Add an exact nullable continuation plan to the reader view from the same shared policy.
3. Show the exact next-decision plan and worst-case cost, require explicit confirmation, then continue sequentially until that approved chapter, an error, a stop request, terminal state, or chapter 100.
4. Keep the last committed chapter visible during work and announce current chapter progress in a polite status region.
5. Show two story choices only when continuation is not legal. Keep custom action behind a disclosure.
6. Remove disabled, duplicate, and default-on controls that do not support the core path.
7. Do not alter prompts or model configuration for this UX slice. Existing AI eval baselines remain authoritative.
8. Reject automatic continuation at chapter 100 and reject any command whose approved stop chapter differs from the current deterministic plan before provider work.
