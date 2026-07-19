# ADR-004 Local BYOK

- Status: Accepted
- Date: 2026-07-19

## Decision

Run locally. User adds `OPENAI_API_KEY` to root `.env`. Server-side routes make API calls. Publish under MIT.

## Reason

Removes accounts, billing, hosted secret management, and challenge deployment risk.

## Consequences

- No shared judge key.
- Clean-clone instructions required.
- Root env loading required for app and eval runner.
