# Architecture

## Boundary

Deterministic application owns truth. Models propose structured data and prose. Models never own commits.

```mermaid
flowchart LR
    U["User action"] --> P["Choice validator"]
    S["Immutable WorldState vN"] --> A["Up to 3 Luna character agents"]
    P --> D["World Director"]
    A --> D
    D --> V["Deterministic validator"]
    V -->|valid| T["Prospective turn"]
    V -->|invalid| R["Bounded repair or reject"]
    T --> F["Validated Luna chapter frame"]
    T --> N["Terra POV narrator"]
    K["POV KnowledgeLedger"] --> N
    F --> Q["Narrative contract audit"]
    N --> Q["Narrative contract audit"]
    Q --> C["Atomic commit vN+1"]
    C --> H["Chapter and safe player state"]
```

## Chapter Pipeline

1. Load story, locked POV, immutable state version, arc clock, and relevant actors.
2. Validate user action against known abilities and current situation.
3. Run maximum three Luna background intents from same state version.
4. Resolve user attempt and intents into proposed `WorldDelta`.
5. Parse strict schema. Refusal or incomplete output causes no mutation.
6. Recompute canonical intent disposition and require events, state mutations, and knowledge mutations to exactly equal deterministic resolver output.
7. Stage prospective state in memory. Canon remains at current version.
8. Generate the title and next-choice frame with Luna, then run deterministic safety and legality checks.
9. Give Terra only POV-safe context and prospective visible events.
10. Target 900 to 925 words, reject outside the absolute 900 to 1,300 word range, and run the Luna narrative contract audit.
11. Atomically commit delta, knowledge, chapter, trace metadata, usage, cost, and next version.

Narration failure leaves canon unchanged. Accepted `WorldDelta` is sole source of new canon. Audit can reject prose but cannot add state mutations.

From chapter 48 through 50 of each act, choices stay milestone-compatible. An incomplete milestone requires a direct typed target. The locked POV can target the milestone through `investigate.subjectId` or a supported `targetId`; background agents cannot claim that abstract target.

## Model Routing

| Work                                      | Model           | Baseline effort |
| ----------------------------------------- | --------------- | --------------- |
| World blueprint and seven-act constraints | `gpt-5.6-sol`   | medium          |
| Hard recovery and finale                  | `gpt-5.6-sol`   | medium          |
| Custom-action translation and narration   | `gpt-5.6-terra` | none            |
| Character intents, frame, and fact audit  | `gpt-5.6-luna`  | none or low     |

Use Responses API. Use strict structured outputs for state-changing calls. Measure before changing effort.

## Multi-Agent Adapter

- Native beta SDK path uses `client.beta.responses.create`, `multi_agent.enabled`, `max_concurrent_subagents: 3`, and `betas: ["responses_multi_agent=v1"]`. Raw HTTP and WebSocket use `OpenAI-Beta: responses_multi_agent=v1`.
- Default and hard maximum concurrency: three.
- All runtime agents in one native tree share request model and tools.
- Preserve multi-agent output items and identities in trace.
- Sequential fallback runs same Luna prompts through same resolver and schemas.
- UI labels active path clearly. Never pretend sequential path was parallel.

## Storage

Initial target: local SQLite.

Required transaction:

- compare expected `world_version`.
- insert accepted delta.
- update world and character state.
- append knowledge changes.
- insert chapter record.
- insert trace metadata and usage.
- increment version once.

Rollback everything on failure.

## Trace Envelope

- run ID, Git SHA, fixture ID, seed.
- prompt and schema versions.
- exact model slug, reasoning settings, response IDs.
- state-before hash, intents, accepted delta, state-after hash.
- multi-agent output items.
- tokens, cached tokens, reasoning tokens, latency, estimated cost.
- refusal, retry, timeout, validation failure.
- final gate result.

Successful chapter traces include every attempt for that world version, including attempts from earlier failed retries. Fully failed turns persist a separate strict failure trace without mutating canon. Sequential Luna attempts retain the responsible character ID.

Never store API key or raw environment.

## Planning Envelope

- Estimated full chapter before retries: about `$0.075`.
- Estimated full chapter with 20 percent retry allowance: about `$0.09`.
- Estimated 350 chapters: about `$31.50`, plus genesis and user regenerations.
- POC live-eval budget: maximum `$3`.
- World tick p50 target: at most 15 seconds.
- Streamed full chapter p95 target: at most 60 seconds.

These are planning estimates. Runtime usage fields are token source of truth. OpenAI responses do not return cost, so UI must show actual tokens, latency, and estimated cost from a versioned pricing table after each call.

Each request reserves its maximum estimated exposure before transport. Known usage settles the reservation to measured estimated cost. Timeouts and transport failures retain the full reservation because provider billing is unknown. Failed exposure carries into every retry for the same world version.
