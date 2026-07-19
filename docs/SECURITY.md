# Security

## Secrets

- User places `OPENAI_API_KEY` in root `.env`.
- Server-side code reads key. Client code never receives it.
- `.env` and variants are ignored. Only `.env.example` is tracked.
- Never include headers, key, or raw environment in logs, traces, exports, fixtures, screenshots, or errors.
- Run secret scan before first push and before release.

## Model Output

- Treat every model response as untrusted.
- Parse strict schema.
- Reject unknown fields.
- Handle refusal and incomplete output without state mutation.
- Cap retries, timeout, concurrency, and cost.
- Validate all state mutations deterministically.

## Content and IP

- Mark generated prose as AI-generated.
- Use original characters, lore, and setting.
- Do not request living-author style or copy protected universes.
- Adult violent fantasy allowed. No explicit sexual content or sexual content involving minors.

## Release Gate

- Secret scan clean.
- Client bundle inspection clean.
- Error path does not echo request headers.
- Exports contain no hidden system state unless user explicitly selects God Mode export.
- Dependency licenses inventoried.
