# ADR-020: Make any live-cap extension explicit and one-way

## Status

Accepted on 2026-07-21 for provider-free preparation. Spending still needs a new exact user authorization.

## Context

The original `$3` ledger already contains `$2.993429175` of durable exposure. Human review still rejects Elara chapter 1 and Lucan chapter 1. Their canon-preserving re-narration ceilings are `$0.0135` each, so the exact worst case is `$0.027` new provider exposure and `$3.020429175` total exposure.

Changing a constructor constant would mutate the budget before the authenticated source and current exposure were checked. A failed dry run could also load the API key or create a provider client before proving the command safe.

## Decision

- Only exact total caps `$3` and `$3.021` parse. Arbitrary values, duplicate flags, and cap decreases fail.
- The extended cap accepts only the registered failure report, sequential Flex mode, `$2.811082175` prior spend, `$0.0135` chapter ceiling, and ordered targets Elara chapter 1 then Lucan chapter 1.
- The ledger stays at `$3` during provider-free preflight. Preflight opens SQLite read-only, requires zero active reservations, authenticates the report baseline and exact `$2.993429175` exposure, and proves the two-target `$0.027` ceiling.
- `--preflight-only` returns before dotenv loading, API-key access, OpenAI client construction, report writes, or provider transport.
- A paid run may migrate only `$3` to `$3.021`, under the owned live-run lock, after the source baseline is synchronized and before any request reservation. The transaction preserves exposure exactly.
- Stale-run recovery may pass preflight only through its exact durable run ID. Interruption and settled-run checkpoints bind the cap used by their run. Historical checkpoints default to `$3`.
- The original automated release matrix remains evidence under the `$3` POC budget. The extra `$0.021` is a visible, user-authorized human-review correction allowance. Narrative, canon, audit, and chapter gates do not change.
- The current-prompt native smoke is not included. It needs a separate later cap and authorization after correction spend is known.

## Consequences

- Preparing and proving the command costs nothing and cannot silently raise the ledger.
- Once a paid command performs the migration, the ledger cannot reopen at `$3`.
- A crash after lock acquisition but before migration remains recoverable. A crash after a provider reservation still requires exact interruption reconciliation.
- A final report records `$3.021` as its actual cap. Historical reports cannot be rewritten to claim the extension.

## Rejected alternatives

- Raise the cap in the ledger constructor. It can mutate before source authentication.
- Accept any caller-provided cap. It turns the safety ceiling into an unbounded option.
- Fold the native smoke into the same allowance. The correction plan already consumes `$0.027` at worst case.
- Lower story-quality or canon gates. Human rejection must be corrected, not relabeled.
