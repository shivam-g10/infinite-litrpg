# ADR-002 Single-Writer Canon

- Status: Accepted
- Date: 2026-07-19

## Context

Parallel character agents can conflict over locations, inventory, deaths, knowledge, and progression.

## Decision

Background agents read one immutable state version and emit intents only. One World Director proposes one delta. Deterministic validator and atomic transaction are sole commit gate.

## Reason

Matches independent Multi-agent work while protecting shared mutable state.

## Consequences

- Agents cannot write database.
- Stale version rejects full commit.
- Native and sequential paths share schemas and resolver.
