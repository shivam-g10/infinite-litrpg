# Living Plan

Updated: 2026-07-22

## Current goal

Build Week submission is complete. Extended human story review remains.

## Correction

The prior “generated world terms” implementation was a cosmetic reskin. Six client presets renamed one legacy fixture while topology, inventory, incident, threat, clues, and opening action stayed fixed. That path is removed from production.

## Implemented

- `StorySetupV2` contains preferences, optional protagonist name, and guidance only.
- Strict `StoryGenesisCandidateV1` owns cast, System, inventory, topology, factions, incident, threat, facts, relationships, milestones, ending constraints, and opening action.
- Terra medium proposes genesis. Deterministic code compiles stable IDs and validates it. Terra low audits it. Three cycles are allowed.
- Accepted genesis, exact initial world, opening action, setup and world hashes, model provenance, usage, latency, and cost persist atomically.
- One NDJSON creation request covers world generation, world checking, Chapter 1 generation, audit, commit, and activation.
- Browser disconnect does not cancel work. Creation request IDs deduplicate work in the active server process.
- Genesis failure removes temporary metadata. Chapter failure preserves accepted Chapter 0 for retry.
- Replay and re-narration use stored initial canon. Genesis never reruns.
- Missing genesis means legacy read-only. Read, activate, and export remain available. Mutation and restart return `LEGACY_STORY_READ_ONLY`.
- Generated discoverable facts replace production Ash Road clues.
- Provider-free evals cover palace, wilderness, dungeon, settlement, structural rejection, age and inventory, exact guidance, and ten-chapter trajectory.

## Acceptance gates

- [x] Fixed `STORY_WORLDS`, client name pools, `applyWorldFlavor`, fixed production opening, and Ash Road clue constants removed from production.
- [x] Provider-free unit and offline genesis gates pass.
- [x] Creator sends no world or supporting cast canon.
- [x] Browser creator path uses one creation stream and no second opening POST.
- [x] Full `npm run check` passes on the final tree.
- [x] Clean-clone verification passes on the full working tree, including new untracked files.
- [ ] Human creates three books with different ages and compares structure.
- [ ] Human continues one book for ten chapters and approves progression.
- [x] User supplied the final 2:48 demo URL.
- [x] User authorized push and final Devpost submission. Devpost submission `1112057` was accepted.

## Stop condition

Build Week release gate is complete. Do not add paid eval loops. Continue extended story judgment only when the user requests it.
