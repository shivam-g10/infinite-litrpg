# ADR-024: Generated story genesis

Status: accepted

## Decision

The public creator sends `StorySetupV2` preferences only. Terra medium proposes `StoryGenesisCandidateV1`. Deterministic TypeScript assigns canonical IDs and validates every reference, graph, inventory, opening action, fact, milestone, and concrete guidance request. Terra low audits the compiled proposal. The workflow allows three candidate cycles.

The accepted genesis and exact initial world commit atomically before Chapter 1. Replay and re-narration load that snapshot. Genesis never runs again for a saved story. Later canon still changes only through accepted `WorldDelta` records.

Stories without a genesis record are legacy read-only. They can be read, activated, and exported. Mutation and restart return `LEGACY_STORY_READ_ONLY`.

## Consequences

- The client no longer owns cast or world canon.
- A road, fixed inventory, and Ash vocabulary are optional model choices, not templates.
- Provider-free fixtures cover structural diversity. Human review judges three fresh books and one ten-chapter trajectory.
- No paid eval runner or runtime fingerprint comparison is added.
