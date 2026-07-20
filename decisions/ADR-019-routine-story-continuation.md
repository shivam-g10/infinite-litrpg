# ADR-019: Continue routine chapters to meaningful decisions

## Status

Accepted on 2026-07-20.

## Context

The original reader asked for a choice after every chapter. Most choices do not change an act milestone, so this interrupted reading without adding useful agency. The demo must prove a coherent path through chapter 100 while retaining one canonical writer, one atomic chapter per request, bounded cost, and the full chapter-350 engine.

## Decision

- Shared deterministic policy requires player input for the opening action and an incomplete act milestone lock. Routine chapters do not require input.
- `continue_story` uses the persisted application-owned `choice-1`. That option was model-ranked when the previous chapter committed, but its action, description, target, and legality remain application-owned.
- The server rejects automatic continuation at a meaningful decision before model access.
- One reader click runs sequential single-chapter requests. Every chapter receives a new request ID and the current expected world version, then commits atomically before the next request starts.
- Before the run, the reader shows the exact chapter count, approved stop chapter, per-chapter cap, and worst-case total, then requires explicit confirmation. Every continuation command carries that approved stop chapter; the server rejects stale or broader approval before provider work.
- The run stops on a decision, error, terminal state, explicit `Stop after this chapter`, or chapter 100.
- Chapter 100 is a demo horizon only. It does not mark the world terminal and does not change the chapter-350 guard.
- The reader keeps committed prose visible, announces current work through a polite status region, and hides choices until input is required.
- Browser-led continuation is foreground work. The UI tells the reader to keep the tab open and never claims background durability or cancellation of the active provider request.
- Every generated chapter still uses the configured per-chapter cost cap. The confirmed worst case is therefore chapter count multiplied by that cap. This slice adds no background spend reservation and changes no prompt or model configuration.

## Consequences

- The normal loop becomes read, continue, decide at a milestone, then continue.
- Through chapter 100, an uncompleted story pauses before chapters 48 and 98, then stops after chapter 100 commits.
- Retry reuses the exact failed request descriptor and request ID. A lost response can therefore recover a committed chapter without another model call.
- A direct automatic-continuation request cannot cross the current meaningful decision or chapter 100 without supplying a new, matching approval boundary.
- Closing or reloading the tab stops browser orchestration. The last atomic commit remains safe, but unattended generation is out of scope.

## Rejected alternatives

- Ask for input every chapter. It adds friction without a deterministic signal that the choice matters.
- Submit one request for many chapters. It breaks per-chapter atomicity, progress visibility, and current retry semantics.
- Run a durable background job. It adds leases, cumulative reservations, recovery state, and new endpoints beyond the demo need.
- Let the browser choose arbitrary option text. It duplicates domain policy and weakens server enforcement.
