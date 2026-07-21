# AGENTS

## Mission

Finish Infinite LitRPG as a tested OpenAI Build Week project. Build working software, not plans alone.

## Read Order

1. `LOOP.md`
2. `docs/PLAN.md`
3. `docs/STATUS.md`
4. Relevant `docs/`, `decisions/`, `research/`, and `evals/` files

## Scope Locks

- LitRPG only.
- Original reincarnated Demon King setting.
- Six existing selectable characters.
- Viewpoint locks after selection.
- Maximum three active background character agents per chapter.
- One canonical state writer.
- Seven acts, at most 50 chapters each.
- Chapter 350 terminal. Never call model for chapter 351.
- OpenAI Responses API only.
- Runtime models limited to GPT-5.6 Sol, Terra, and Luna.
- Local-first, MIT, bring-your-own API key.
- No auth, payments, hosted service, analytics, public feed, images, audio, or mobile app.

## Engineering Rules

- TypeScript strict mode.
- Keep domain logic framework-independent under `shared/`.
- Treat model output as untrusted input. Parse strict schemas and run deterministic validation.
- Agents emit intent only. They never mutate canonical state.
- Stage prospective delta, generate and validate chapter, then commit world delta, knowledge delta, chapter, usage, and version atomically.
- Accepted `WorldDelta` is sole source of new canon. Narration and canon audit cannot invent state mutations.
- Keep POV prompts limited to selected character knowledge.
- Hide Multi-agent beta behind adapter. Keep sequential Luna fallback.
- API key stays server-side. Never log, expose, or commit secrets.
- Preserve prompt, schema, and fixture versions in traces.
- Add regression case for every discovered defect.
- Never weaken an eval to make code pass.

## Agent Use

- Root agent owns plan, synthesis, implementation, and final decisions.
- Use subagents only for independent research, exploration, test runs, log analysis, or review.
- Maximum three subagents at once. No recursive delegation.
- Default subagent work is read-only. Give exclusive file ownership before any delegated edit.
- Never let two agents edit same files or shared mutable state.
- Require concise evidence with file references. Root verifies every result.
- Do not spawn agent for small serial work root can finish directly.
- Codex build subagents are separate from product background-character agents.

## Commands

App not bootstrapped yet. During bootstrap, create and keep these stable root commands:

```text
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run evals
npm run build
npm run test:e2e
npm run check
```

`npm run check` must run all non-live gates. Live API evals need a separate explicit command and authorization. Record usage and estimated cost, but do not impose an application-side token, prose-size, prompt-size, or cost ceiling.

## Autonomous Build Done Bar

- All acceptance checks in `docs/PLAN.md` complete.
- All hard gates in `evals/README.md` pass.
- Clean-clone setup verified.
- Core user path verified in browser.
- Six POV review packets generated and agent-reviewed.
- Multi-agent path and sequential fallback tested.
- No hidden-knowledge leaks or chapter 351 path.
- Secret scan clean.
- README, architecture, screenshots, demo script, and submission evidence packet complete.
- `docs/STATUS.md` records commands, results, remaining limits, and final outcome.

## User-Owned Release Gates

- User approves six POV review packets.
- User records or approves public demo video.
- User supplies Codex feedback session ID.
- User authorizes push, publication, and challenge submission.

Prepare everything needed for these gates. Stop only when user authority or judgment is required.

Do not declare completion with failing gates, unrun required checks, placeholder behavior, or undocumented blockers.
