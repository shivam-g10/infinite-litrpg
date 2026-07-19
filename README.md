# Infinite LitRPG

Open-source, local-first LitRPG engine for one viewpoint inside a living multi-character world.

## Premise

- Scenario: reincarnated Demon King.
- Six existing characters compete, cooperate, and progress.
- Player locks one viewpoint for the full story.
- Other characters act off-screen through bounded background agents.
- One canonical resolver owns world state.
- Story ends early or at chapter 350. Chapter 351 is impossible.

## Build Status

Planning scaffold ready. Next.js app not initialized.

Read in order:

1. `AGENTS.md`
2. `LOOP.md`
3. `docs/PLAN.md`
4. `docs/STATUS.md`

## Start Codex Goal

Select GPT-5.6 Sol with Ultra. Then run:

```text
/goal Complete Infinite LitRPG end to end. Follow AGENTS.md, LOOP.md, and docs/PLAN.md. Keep docs/STATUS.md and the living plan current. Research unknowns, establish eval baselines before changing AI behavior, implement verifiable vertical slices, use subagents only for bounded independent work, and continue until every documented acceptance gate passes or an external blocker is proven.
```

Goal mode keeps existing permissions. Add `OPENAI_API_KEY` to root `.env` before live API evals.

## Runtime Model Roles

| Role | Model |
| --- | --- |
| World genesis, arc recovery, finale | `gpt-5.6-sol` |
| POV choices and chapter narration | `gpt-5.6-terra` |
| Background intents and chapter fact audit | `gpt-5.6-luna` |

No other model family is allowed.

## Remote

`git@github.com:shivam-g10/infinite-litrpg.git`

## License

MIT
