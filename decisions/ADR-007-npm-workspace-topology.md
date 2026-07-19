# ADR-007 npm Workspace Topology

- Status: Accepted
- Date: 2026-07-19

## Decision

Root owns `package.json`, lockfile, scripts, and npm workspaces. `app/` is Next.js package and uses `src/app/` for App Router. `shared/` is framework-independent TypeScript package.

## Reason

Root commands need one owner. Sibling shared code needs explicit package boundary. `src/app/` avoids confusing repository `app/` package with Next App Router directory.

## Consequences

- Never run `create-next-app` with Git initialization.
- Root `npm run check` orchestrates both packages.
- `shared/` cannot import Next.js, React, database clients, or environment secrets.
