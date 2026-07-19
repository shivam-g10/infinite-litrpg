# Codex Agent Loop

## Question

How should GPT-5.6 Sol Ultra run this repository to completion without wasteful agent fan-out?

## Sources

- [OpenAI Codex long-running work](https://learn.chatgpt.com/docs/long-running-work), accessed 2026-07-19.
- [OpenAI AGENTS.md guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md), accessed 2026-07-19.
- [OpenAI subagent guidance](https://learn.chatgpt.com/docs/agent-configuration/subagents), accessed 2026-07-19.
- [OpenAI multi-hour execution plans](https://developers.openai.com/cookbook/articles/codex_exec_plans), accessed 2026-07-19.
- [OpenAI Codex AI-app eval workflow](https://developers.openai.com/codex/use-cases/ai-app-evals), accessed 2026-07-19.

## Facts

- Goal text becomes first prompt and completion criteria. Long instructions should live in repository file referenced by goal.
- Goal needs outcome, constraints, and verifiable completion.
- Codex automatically loads `AGENTS.md`. Short, practical guidance beats large vague policy.
- Subagents help with independent exploration, tests, triage, and review. Parallel write-heavy work creates conflicts and higher token use.
- Ultra may delegate proactively.
- Default subagent depth is one. Deeper fan-out increases cost and unpredictability.
- Long execution plans should stay self-contained and update progress, discoveries, decisions, and outcomes.
- Evals should exercise real user path and establish baseline before prompt changes.

## Inference

- Root Sol Ultra should remain sole coordinator and default writer.
- Cap at three workers. Use Terra for bounded research and eval runs. Use Sol High for final review.
- `LOOP.md` should force reorientation, smallest vertical slice, proof-first work, review, status update, and repeat.
- One stable offline command must gate every milestone. Live evals need separate cost cap.

## Unknowns

- Whether selected Codex surface honors project custom-agent files identically.
- Exact interruption behavior during multi-hour local Goal run.

## Decision Impact

- Use `AGENTS.md`, `LOOP.md`, living `docs/PLAN.md`, and `docs/STATUS.md`.
- Configure maximum four total threads and depth one.
- Keep researcher and reviewer read-only.
