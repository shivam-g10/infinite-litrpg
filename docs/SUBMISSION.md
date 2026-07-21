# Submission Packet

## Fields

| Field            | Value                                                    | State          |
| ---------------- | -------------------------------------------------------- | -------------- |
| Project          | Infinite LitRPG                                          | Ready          |
| Track            | Apps for Your Life                                       | Ready          |
| Tagline          | Create one reincarnated life. The world moves around it. | Ready          |
| Repository       | `https://github.com/shivam-g10/infinite-litrpg`          | User push gate |
| License          | MIT                                                      | Ready          |
| Demo video       | Public YouTube URL                                       | User gate      |
| Codex Session ID | Primary build feedback ID                                | User gate      |

## Description

Infinite LitRPG is a local, bring-your-own-key story engine for personalized reincarnation LitRPG. The reader uses simple controls to shape a new life, then the app generates a fresh cast, System world, and origin chapter.

Up to three GPT-5.6 Luna background-character calls propose intent concurrently. GPT-5.6 Sol frames and narrates the chapter. GPT-5.6 Terra translates custom actions and audits the result. Strict schemas and deterministic TypeScript code remain the only authority over canon. A chapter commits its world delta, knowledge, prose, trace, usage, and version in one SQLite transaction.

Generation continues server-side across refreshes. Different books remain usable because locks are per story. Every story is stored locally with a SQLite database and one readable Markdown file per chapter. The demo stops at Chapter 100. Chapter 350 is terminal and Chapter 351 is rejected before a model call.

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

- [ ] `npm run check` passes.
- [ ] Clean-clone setup passes.
- [ ] User approves a fresh ten-chapter progression.
- [ ] User approves the recorded demo.
- [ ] Current branch is pushed with user authority.
- [ ] Feedback session ID supplied.
- [ ] Submission authorized.
