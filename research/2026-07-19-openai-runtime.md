# OpenAI Runtime

## Question

What current OpenAI architecture best supports persistent multi-character LitRPG simulation?

## Sources

- [GPT-5.6 guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6), accessed 2026-07-19.
- [GPT-5.6 models](https://developers.openai.com/api/docs/models), accessed 2026-07-19.
- [GPT-5.6 Sol model](https://developers.openai.com/api/docs/models/gpt-5.6-sol), accessed 2026-07-19.
- [GPT-5.6 Terra model](https://developers.openai.com/api/docs/models/gpt-5.6-terra), accessed 2026-07-19.
- [GPT-5.6 Luna model](https://developers.openai.com/api/docs/models/gpt-5.6-luna), accessed 2026-07-19.
- [Responses Multi-agent](https://developers.openai.com/api/docs/guides/responses-multi-agent), accessed 2026-07-19.
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), accessed 2026-07-19.
- [Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices), accessed 2026-07-19.
- [Agent evals](https://developers.openai.com/api/docs/guides/agent-evals), accessed 2026-07-19.
- [Trace grading](https://developers.openai.com/api/docs/guides/trace-grading), accessed 2026-07-19.
- [API key safety](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety), accessed 2026-07-19.

## Facts

- `gpt-5.6` maps to Sol. Terra balances cost and quality. Luna targets high-volume work.
- GPT-5.6 supports Responses API, streaming, functions, and structured outputs.
- Exact runtime IDs are `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`; `gpt-5.6` aliases Sol.
- Listed token prices per million tokens are Sol `$5` input and `$30` output, Terra `$2.50` input and `$15` output, and Luna `$1` input and `$6` output.
- Cached input prices per million tokens are Sol `$0.50`, Terra `$0.25`, and Luna `$0.10`. Cache writes cost `1.25x` the uncached input rate.
- Structured Outputs enforce schema adherence. Refusals still need explicit handling.
- Multi-agent beta supports GPT-5.6. Recommended concurrency is three.
- TypeScript native Multi-agent uses `client.beta.responses.create` with `multi_agent.enabled`, `max_concurrent_subagents: 3`, and `betas: ["responses_multi_agent=v1"]`; raw HTTP and WebSocket use the beta header.
- Agents in one native tree share request model and tools.
- Multi-agent fits independent bounded tasks. Ordered chains and shared mutable resources fit one coordinator better.
- Replay and tracing must preserve multi-agent calls, outputs, identities, and message direction.
- OpenAI recommends early task-specific evals, logging, objective automation, continuous corpus growth, and human calibration.
- API keys must stay server-side and outside repositories.
- Response usage reports input, cached-input, output, reasoning, and total tokens. It does not report cost; cost must be estimated from a versioned pricing table.

## Inference

- Luna agents should read one immutable snapshot and emit intent only.
- One Director and deterministic validator should own canonical delta.
- Sol should frame and narrate from staged prospective state and POV-safe context.
- Terra should translate custom actions and audit the buffered narration before one atomic commit.
- Native Multi-agent needs an adapter and a concurrent application fallback for Luna intents.
- Trace every call and convert failures into local regression cases.

## Unknowns

- Native beta availability for challenge account.
- Actual subagent token accounting and latency.
- Best reasoning effort after representative evals.
- Current beta SDK surface at implementation time.
- Account access to native Multi-agent and exact per-agent usage attribution.

## Decision Impact

- Responses API only.
- Strict schemas on state-changing calls.
- Maximum three background agents.
- Concurrent application fallback when native Multi-agent is unavailable.
- Single-writer world state.
- Local in-repo eval corpus. No legacy Evals platform dependency.
