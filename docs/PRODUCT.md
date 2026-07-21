# Product Contract

## Scope

Infinite LitRPG creates original reincarnation stories with an explicit System. The current creator fixes those two foundations and lets the reader choose the rest.

The reader sets the title, starting life, gender, power path, genres, backgrounds, personality, rebirth cause, memory state, System focus, protagonist name, and optional guidance. The server generates the cast, System mechanics, topology, factions, inventory, incident, threat, discoveries, relationships, opening action, milestones, and ending constraints.

## Reader loop

1. Create or open a local book.
2. Generate, validate, audit, and save story genesis, then generate Chapter 1 in one server workflow.
3. Read the committed chapter without developer telemetry.
4. Choose when the story reaches a meaningful decision.
5. Let routine chapters continue in the background.
6. Reroll the latest chapter when its prose is weak. Canon remains fixed.
7. Reject a book and try another setup without deleting its files.
8. Stop the demo at Chapter 100. The complete engine ends at Chapter 350.

## Narrative contract

- Close-third viewpoint.
- Chapter 1 dramatizes the prior-life ending, reincarnation, new body, immediate world, first System pressure, and a consequential response.
- The System affects decisions, tradeoffs, progress, or risk. It is not decoration.
- Dialogue and character behavior must alter a plan, relationship pressure, conflict, or choice when the scene supports another speaker.
- Every chapter advances a concrete objective, location, threat, relationship, capability, resource, or knowledge state.
- Titles, openings, scene shapes, and paragraph language must not loop.
- Internal milestones, deadlines, prompt fields, audit language, and model instructions never appear in reader prose.
- Models cannot invent durable canon outside an accepted `WorldDelta`.
- Genesis is the one initialization exception: only the accepted, compiled genesis creates Chapter 0 canon.

## Product limits

- Local only. No account, payment, hosted library, analytics, public feed, image, audio, or mobile app.
- Bring your own OpenAI key in `.env`.
- One active generation per story. Different stories remain independent.
- At most three background intent agents per chapter.
- Chapter 100 is the demo stop. Chapter 350 is terminal.
