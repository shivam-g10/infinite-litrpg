# Human Review

## Start

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

Add the OpenAI key to `.env`, then open `http://127.0.0.1:3000`.

## Review path

1. Create three books with different setup choices. Leave one protagonist blank, type one name, and use different starting ages.
2. Compare opening archetype, topology, incident, inventory, System mechanics, cast roles, relationships, and Chapter 1 action. Reject any repeated structural seed.
3. Read each Chapter 1. It must show the old-life ending, reincarnation, immediate world, System pressure, and the protagonist's first response.
4. Generate the next chapter in one book. While it runs, open another book. It must remain usable.
5. Return to the generating book. Progress must identify the active chapter and phase. The reader must remain on the current chapter until commit.
6. Continue one book for at least ten chapters. Reject three identical action signatures, more than two consecutive clock-or-XP-only chapters, or fewer than three meaningful change categories.
7. Reroll the latest chapter. Confirm the prose changes while committed canon stays stable.
8. Reject a weak book, start another, then reopen the rejected draft if needed.
9. Export Markdown and reader JSON. Confirm neither contains prompts, costs, hidden facts, audit instructions, or internal deadlines.
10. Inspect `stories/<story-id>/`. Confirm `story.db` and one Markdown file per committed chapter.

## Pass bar

- No frozen library or page during background generation.
- No repeated fixed world structure, inventory, incident, or passive progression loop.
- No chapter starts from a canned sentence.
- No visible internal planning text.
- Chapter titles and scenes do not loop.
- Dialogue changes a decision or relationship pressure when characters meet.
- The protagonist's goals, beliefs, limitations, and choices develop across chapters.
- The System creates pressure, tradeoffs, progression, or consequences.
- Each chapter changes the situation and creates a stronger next problem.
- No contradiction with previously committed state.

Record failures with story ID, chapter number, exact quote, expected behavior, and screenshot. Do one review stretch. Do not start an automated eval loop.
