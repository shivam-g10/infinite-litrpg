# Execution Loop

Re-enter this loop after every context reset, failure, or milestone.

## 1. Orient

- Read `AGENTS.md`, this file, `docs/PLAN.md`, and `docs/STATUS.md`.
- Inspect Git status and recent history.
- Confirm current layer: research, design, implementation, review, or external coordination.
- Run current baseline checks. Record failures before edits.

## 2. Choose Milestone

- Pick smallest vertical slice producing observable behavior.
- Define outcome, constraints, files, and verification.
- Update `docs/PLAN.md` progress and `docs/STATUS.md` next action.
- Work on one milestone until green or proven blocked.

## 3. Close Unknowns

- Research only decisions that affect current milestone.
- Prefer primary sources. Date time-sensitive facts.
- Put durable findings in `research/`.
- Prototype uncertain API or concurrency behavior before broad implementation.
- Record durable tradeoffs in `decisions/`.

## 4. Define Proof First

- Add or select eval cases before changing AI behavior.
- Capture baseline result.
- Use deterministic checks for schemas, invariants, state transitions, secrets, and chapter bounds.
- Use human review for narrative quality. Model scores never become sole release authority.

## 5. Delegate Carefully

Delegate only bounded independent work that improves speed or context quality:

- researcher: official facts and focused codebase exploration.
- evaluator: run tests or evals and report evidence. No fixes.
- reviewer: inspect finished diff for correctness, security, regressions, and missing tests.

Root keeps write ownership by default. Never parallelize dependent steps or shared-file edits. Wait for required results, synthesize, then act.

## 6. Implement

- Build one vertical slice.
- Keep deterministic core separate from model adapters and UI.
- Make smallest change satisfying milestone.
- Preserve existing behavior and contracts.
- No fake implementation, disabled checks, silent fallback, or swallowed error.

## 7. Verify

Run relevant gates in this order:

1. format
2. lint
3. type check
4. unit and invariant tests
5. offline evals
6. integration tests
7. build
8. browser smoke and end-to-end tests
9. secret scan

Review diff after checks. Fix root cause. Convert every escaped defect into regression fixture.

## 8. Record

Keep `docs/PLAN.md` sections current:

- Progress
- Surprises and Discoveries
- Decision Log
- Outcomes and Retrospective

Update `docs/STATUS.md` with commands, results, cost, blockers, and next milestone. Commit green checkpoints. Never push or publish unless active goal explicitly requires it.

## 9. Continue

Repeat without asking for next task while safe work remains. Stop only when:

- full done bar passes, or
- required user authority is missing, or
- external blocker is reproduced and documented with smallest next action.

Time, difficulty, token use, or one failed attempt are not blockers.
