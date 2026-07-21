# Infinite LitRPG

Local, bring-your-own-key LitRPG creator. Pick a reincarnation setup, generate a fresh cast and System world, then read and steer the story chapter by chapter.

![Story creator](docs/screenshots/story-creator-desktop.png)

## Run

Requirements: Node.js 24 or newer, npm 11 or newer, and an OpenAI API key with GPT-5.6 Sol, Terra, and Luna access.

```powershell
npm ci
Copy-Item .env.example .env
```

Set the key in `.env`:

```dotenv
OPENAI_API_KEY=
OPENAI_MAX_BACKGROUND_AGENTS=3
OPENAI_NATIVE_MULTI_AGENT=false
```

Then run:

```powershell
npm run dev
```

Open `http://127.0.0.1:3000`.

## Product flow

1. Name the book.
2. Pick starting age, power path, genres, background, personality, rebirth cause, memory, System focus, and optional guidance.
3. Enter a protagonist name or let the app generate a fresh cast and world vocabulary.
4. Generate Chapter 1. It covers the prior-life ending, reincarnation, immediate world, first System pressure, and a consequential response.
5. Read, choose when a decision matters, reroll the latest chapter, or let routine chapters continue in the background.
6. Switch books while another book generates. The demo stops at Chapter 100. The engine ends at Chapter 350 and rejects Chapter 351 before any model call.

Generation is server-owned. Reloading does not cancel it. The reader stays on the open chapter until the next chapter commits.

## Story files

Stories are local and Git-ignored:

```text
stories/
  library.json
  <story-id>/
    story.db
    chapter-001.md
    chapter-002.md
```

SQLite is canonical. Markdown files are readable chapter projections. Rejecting a draft removes it from the active library without deleting its directory.

## AI roles

| Work                                   | Model         |
| -------------------------------------- | ------------- |
| Background character intents           | GPT-5.6 Luna  |
| Story frame and narration              | GPT-5.6 Sol   |
| Action translation and narrative audit | GPT-5.6 Terra |

The app uses the OpenAI Responses API only. With native Multi-agent disabled, up to three Luna requests run concurrently in the application. The optional native adapter uses the same schemas and resolver.

Models propose intent and prose. Deterministic code owns canon, validates every mutation, filters POV knowledge, audits the finished chapter, and performs one atomic commit.

Read [Architecture](docs/ARCHITECTURE.md), [Product contract](docs/PRODUCT.md), and [Security](docs/SECURITY.md).

## Commands

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run evals
npm run build
npm run test:e2e
npm run check
```

`npm run check` is provider-free. It runs the local quality gate once. No paid eval command is part of the repository.

## Demo

Use [Human review](docs/HUMAN_REVIEW.md) and the [three-minute script](docs/DEMO_SCRIPT.md).

## License

[MIT](LICENSE)
