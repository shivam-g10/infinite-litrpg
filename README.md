# Infinite LitRPG

Infinite LitRPG is a local, bring-your-own-key story engine for one locked viewpoint inside a living six-character world. The original Ashen Crown setting follows a reincarnated Demon King through seven acts. The story ends by chapter 350. Chapter 351 cannot run.

AI generates chapter prose and background-character intents. Deterministic application code validates actions, owns canon, audits every chapter, and commits the accepted world delta atomically.

![Reader view](docs/screenshots/reader-desktop.png)

## Requirements

- Node.js 24 or newer
- npm 11 or newer
- An OpenAI API key with GPT-5.6 Terra and Luna access

## Run locally

```powershell
git clone https://github.com/shivam-g10/infinite-litrpg.git
Set-Location infinite-litrpg
npm ci
Copy-Item .env.example .env
```

Put the key in root `.env`:

```dotenv
OPENAI_API_KEY=
OPENAI_MAX_COST_USD_PER_CHAPTER=0.10
OPENAI_MAX_BACKGROUND_AGENTS=3
OPENAI_NATIVE_MULTI_AGENT=false
```

Paste the key after the first equals sign.

Start the app:

```powershell
npm run dev
```

Open `http://127.0.0.1:3000`. Choose one of six characters. The viewpoint locks for that local world. After the opening action, the reader can create routine chapters one at a time until the next meaningful act decision. The demo flow pauses after chapters 47 and 97 and stops at chapter 100. Runtime state stays in ignored `data/ashen-crown.db`.

For a no-cost seeded review, the exact chapter-100 behavior proof, and the live cost boundary, use the [human review guide](docs/HUMAN_REVIEW.md). Six authenticated POV samples are ready in [SAMPLE_STORIES.md](docs/SAMPLE_STORIES.md).

Set `OPENAI_NATIVE_MULTI_AGENT=true` to use the native Multi-agent beta. The default sequential Luna adapter preserves the same intent schema and deterministic resolver.

Product requests explicitly use Standard processing. Flex is isolated to the release eval command and cannot change product runtime behavior.

## Architecture

```mermaid
flowchart LR
    U["Player decision or routine continuation"] --> V["Deterministic validation"]
    L["Up to 3 Luna intent agents"] --> R["Single world resolver"]
    V --> R
    R --> S["Prospective state"]
    S --> O["Luna title and option ranking"]
    O --> F["App-owned legal choices"]
    S --> T["Luna POV chapter"]
    K["POV-safe knowledge"] --> T
    T --> X["Bounded Luna length recovery when needed"]
    X --> A
    T --> A["Luna narrative audit"]
    F --> A
    A --> C["Atomic SQLite commit"]
    C --> P["Reader and God Mode"]
```

Models emit intent or prose. They never mutate canonical state. Accepted `WorldDelta` is the only source of new canon. Narration sees only the selected character's knowledge. Rejected prose never reaches the reader because generation is buffered, audited, then replayed as NDJSON.

See [architecture](docs/ARCHITECTURE.md), [domain model](docs/DOMAIN_MODEL.md), and [security](docs/SECURITY.md).

## Built with Codex

Codex supported the project from source research through release evidence. It created visual concepts before frontend work, implemented strict TypeScript contracts and deterministic state transitions, built both OpenAI adapters, exercised the real UI in desktop and mobile browsers, reviewed security and cost accounting, and maintained the living plan and evidence log.

AI behavior changed only after a recorded baseline. Every escaped live defect became a named regression. Independent Codex agents handled bounded research, evaluation, and review while the root build task kept implementation ownership and final decisions.

Key product decisions stayed human-readable in `decisions/`: one canonical state writer, accepted `WorldDelta` as the sole source of new canon, permanent POV knowledge boundaries, hard chapter-351 rejection, local bring-your-own-key operation, and no hosted service. GPT-5.6 Terra and Luna have bounded roles; deterministic application code retains authority.

See the [living plan](docs/PLAN.md), [decision records](decisions/), [verified status](docs/STATUS.md), and [submission packet](docs/SUBMISSION.md).

## Model roles

| Work                                                           | Model           |
| -------------------------------------------------------------- | --------------- |
| Custom-action translation                                      | `gpt-5.6-terra` |
| Background intents, option ranking, narration, recovery, audit | `gpt-5.6-luna`  |

Only the OpenAI Responses API is used.

## Verify

```powershell
npm run check
```

This runs format, lint, strict type checks, unit tests, 1,000 deterministic simulations, POV and chapter-350 evals, production build, desktop and mobile E2E tests, secret and client-bundle scans, license checks, the six-story packet check, dependency audit, and diff hygiene.

Live API evals are separate and capped:

```powershell
npm run evals:live:smoke
npm run evals:live:full
npm run evals:live:full:preflight
```

The smoke command defaults to Standard. The full npm script requires explicit cost confirmation and selects Flex. Preflight authenticates a full resume and its cost ceiling without loading an API key, creating a provider client, writing a report, or changing the spend ledger. Reports stay in ignored `evals/reports/`. See [eval gates](evals/README.md) and [current status](docs/STATUS.md).

## Safety

- The API key stays server-side and is never written to traces or exports.
- Reader JSON excludes hidden world facts and other characters' private ledgers.
- God Mode JSON is an explicit full-canon export.
- Every request carries a UUID and expected world version for replay safety.
- Multi-chapter continuation shows exact chapter count and worst-case cost, requires confirmation, and carries a server-validated stop chapter. Automatic continuation cannot cross a meaningful decision or chapter 100.
- Per-chapter cost, retries, timeout, and background concurrency are bounded. Generation uses a tier-priced byte worst case first. When that bound would falsely block, the official input-token counter supplies an exact count plus a 512-token margin at the same tier. Counter failure keeps the byte bound. Returned tier mismatch fails, unknown response cost keeps its reservation, and failed exposure carries into later chapter retries.

## Build Week

Track: Apps for Your Life. See [Build Week notes](docs/BUILD_WEEK.md), [timed demo script](docs/DEMO_SCRIPT.md), and [submission packet](docs/SUBMISSION.md).

## License

[MIT](LICENSE)
