# Offline evaluation

`npm run evals` is provider-free. It checks deterministic behavior, not prose taste.

Gates:

- strict schemas reject unknown or incomplete state changes;
- 1,000 seeded simulations preserve world invariants;
- POV cases produce zero hidden-fact leaks;
- arc transitions and long-horizon checkpoints stay valid;
- Chapter 350 terminates and Chapter 351 is blocked;
- accepted deltas remain the only source of new canon.
- four provider-free generated openings differ in topology, incident, inventory, System, and action;
- generated maps, references, equipment, opening actions, facts, and milestones compile strictly;
- ten-chapter trajectories reject repeated actions, passive clock-or-XP loops, and narrow change.

Run once with the normal repository gate:

```powershell
npm run check
```

Live paid eval runners, cost ledgers, resume checkpoints, release matrices, and generated review packets were removed. They were Build Week experiments and were not part of the product runtime. Use the app itself for current narrative review.

Human prose criteria remain in [RUBRIC.md](RUBRIC.md). See [Human review](../docs/HUMAN_REVIEW.md) for the demo path.
