# Submission Packet

## Fields

| Field            | Value                                                    | State     |
| ---------------- | -------------------------------------------------------- | --------- |
| Project          | Infinite LitRPG                                          | Ready     |
| Track            | Apps for Your Life                                       | Ready     |
| Tagline          | Create one reincarnated life. The world moves around it. | Ready     |
| Repository       | `https://github.com/shivam-g10/infinite-litrpg`          | Published |
| License          | MIT                                                      | Ready     |
| Demo video       | `https://youtu.be/Mmb5XsgcF_0`                           | Ready     |
| Devpost          | `https://devpost.com/software/infinite-litrpg`           | Submitted |
| Submission ID    | `1112057`                                                | Submitted |
| Codex Session ID | `019f7b02-c7fd-7da2-bbd8-a063184c2311`                   | Ready     |

## Description

LitRPG readers often want a specific reincarnation, System, power curve, and character shape that no finished series provides. Other series stop before their story resolves. Infinite LitRPG gives one reader a private, continuing book without asking them to become its author.

The reader chooses preferences only. Terra generates full genesis, deterministic TypeScript compiles canonical IDs and validates it, Terra audits it, and the atomic chapter pipeline writes Chapter 1.

Up to three GPT-5.6 Luna background-character calls propose intent concurrently. GPT-5.6 Sol frames and narrates the chapter. GPT-5.6 Terra translates custom actions and audits the result. Strict schemas and deterministic TypeScript code remain the only authority over canon. A chapter commits its world delta, knowledge, prose, trace, usage, and version in one SQLite transaction.

Generation continues server-side across refreshes. Different books remain usable because locks are per story. Every story is stored locally with a SQLite database and one readable Markdown file per chapter. The demo stops at Chapter 100. Chapter 350 is terminal and Chapter 351 is rejected before a model call.

The recorded Cael story demonstrates generated world structure rather than a renamed fixture: a Covenant Ledger, hidden oath dais, succession purge, competing witnesses, and a next action involving Ilyra Voss all emerge from accepted genesis and chapter state.

## Codex collaboration

The repository began on July 19, 2026, during the challenge. Codex implemented the app from the product and engineering contracts, ran provider-free gates, exercised the browser path, recorded decisions, and converted failures into regressions. Human review rejected the first cosmetic-reskin approach. Codex then replaced it with strict server-generated genesis and caught a later bug where normalization silently removed an unknown map reference before validation.

Human judgment fixed the product scope, canon rules, local-first boundary, three-agent cap, reader experience, and prose release bar. GPT-5.6 powers the shipped product: Terra creates and audits genesis, Luna proposes character intent, Sol frames and narrates chapters, and Terra translates actions and audits prose. Runtime uses the OpenAI Responses API only.

## Judge path

1. Run `npm ci`.
2. Copy `.env.example` to `.env` and add an OpenAI key.
3. Run `npm run dev`.
4. Open `http://127.0.0.1:3000`.
5. Create a story with a blank protagonist name.
6. Read the generated origin chapter.
7. Start the next chapter and switch books during generation.
8. Return to see progress and the committed chapter.
9. Reroll the latest chapter and export Markdown.
10. Inspect `stories/<story-id>/` and [Architecture](ARCHITECTURE.md).

## Final gates

- [x] `npm run check` passes.
- [x] Clean-clone setup passes with tracked and untracked working-tree files.
- [ ] User approves a fresh ten-chapter progression.
- [x] User supplies the final 2:48 demo.
- [x] Current branch is pushed with user authority.
- [x] Feedback session ID supplied.
- [x] Submission authorized and accepted by Devpost.
