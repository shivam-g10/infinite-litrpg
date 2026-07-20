# Submission Evidence

[`non-live-gates.md`](non-live-gates.md) records the current full local gate, browser QA, screenshot hashes, and zero-vulnerability audit.

## Complete Trace

[`rowan-chapter-1-trace.json`](rowan-chapter-1-trace.json) is the strict God Mode trace from Rowan chapter 1 in the first prompt `1.4.11` Flex matrix.

- Source report SHA-256: `447f860a0e918198d246fef37671f16db3664ef76887fba390eaaabc77f9eddd`
- Source Git SHA: `4d47dfb7c748b9d620a81f37a849bf4c96b14edb`
- Result: passed
- Words: 918
- Streaming latency: 20,361 ms
- Estimated generation cost: `$0.007248`
- Requested and returned tier: Flex on all five calls
- State-before SHA-256: `d2074736cba4f3cf3941a5a02d6926717ddced6e10ea8d211cc3273532e834bd`
- State-after SHA-256: `6d2260fab7f34d65ae5b135d1e735e6eddf0197f2279c486127a4ce23f0b9caa`

The committed artifact contains full accepted delta, player and background intents, every attempt and call, response identity, usage, cost, latency, model, tier, prompt and schema versions, state hashes, and final gate result. A regression parses it through the production persisted-trace schema and recomputes attempt totals.

Chapter prose and full canonical input remain in the authenticated ignored live report. Final six-POV review packets will carry those fields after the twelve-cycle gate passes.
