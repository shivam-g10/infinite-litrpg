# Shared

Framework-independent TypeScript workspace package. Root `package.json` owns npm workspaces and shared commands.

- `contracts/`: strict schemas and shared types.
- `engine/`: deterministic validation, resolver, clock, knowledge, and state transitions.
- `prompts/`: versioned prompt builders and model-role configuration.

No React, route handlers, database client, or secret access in shared domain modules.
