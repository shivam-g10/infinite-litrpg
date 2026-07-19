import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  CONTRACT_VERSION,
  FactSchema,
  FIXTURE_VERSION,
  IntentBatchSchema,
  KnowledgeLedgerSchema,
  PROMPT_VERSION,
  type WorldState,
  WorldIntentSchema,
  actForStateChapter,
  buildPovContext,
  contextContainsFact,
  getClockPolicy,
  resolveTurn,
  stageWorldDelta,
  validateIntent,
  validateWorldState,
} from "@infinite-litrpg/shared";
import { config } from "dotenv";

interface GateResult {
  readonly details: Readonly<Record<string, boolean | number | string>>;
  readonly name: string;
  readonly passed: boolean;
}

interface PovLeakCase {
  readonly forbiddenText?: string;
  readonly hiddenFact: string;
  readonly id: string;
  readonly pov: string;
}

interface ClockCase {
  readonly currentChapter: number;
  readonly expect: Readonly<Record<string, boolean | number | null>>;
  readonly id: string;
}

interface InvariantCase {
  readonly action?: Readonly<Record<string, unknown>>;
  readonly actor?: string;
  readonly expect: { readonly accepted: boolean; readonly code: string };
  readonly fixtureMutation?: Readonly<Record<string, unknown>>;
  readonly id: string;
  readonly kind: "intent" | "schema" | "world";
  readonly requiredFactId?: string;
  readonly stateVersion?: number;
  readonly target?: string;
}

config({ path: resolve(".env"), quiet: true });

const startedAt = Date.now();
const gates: GateResult[] = [];
const worldFixture = readJson("evals/fixtures/demon-king-world.json");
const factsFixture = readJson("evals/fixtures/facts.json");
const ledgersFixture = readJson("evals/fixtures/knowledge-ledgers.json");
const worldResult = validateWorldState(worldFixture);
const factsResult = FactSchema.array().safeParse(factsFixture);
const ledgersResult = KnowledgeLedgerSchema.array().safeParse(ledgersFixture);

gates.push({
  details: {
    factFixtureParsed: factsResult.success,
    ledgerFixtureParsed: ledgersResult.success,
    worldFixtureParsed: worldResult.ok,
  },
  name: "fixture-schema",
  passed: factsResult.success && ledgersResult.success && worldResult.ok,
});

const validIntent = {
  action: { type: "wait" },
  actorId: "rowan-ashborn",
  contractVersion: CONTRACT_VERSION,
  expectedEffect: "Rowan watches the road for one turn.",
  goal: "Learn who survived the raid.",
  id: "intent-schema-valid",
  prerequisites: { requiredFactIds: [], requiredItemIds: [], requiredSkillIds: [] },
  promptVersion: PROMPT_VERSION,
  stateVersion: 1,
};
const validIntentParsed = WorldIntentSchema.safeParse(validIntent).success;
const unknownIntentRejected = !WorldIntentSchema.safeParse({ ...validIntent, invented: true })
  .success;
const oversizedBatchRejected = !IntentBatchSchema.safeParse({
  intents: Array.from({ length: 4 }, (_, index) => ({
    ...validIntent,
    id: `intent-schema-${index}`,
  })),
}).success;

gates.push({
  details: { oversizedBatchRejected, unknownIntentRejected, validIntentParsed },
  name: "strict-contracts",
  passed: validIntentParsed && unknownIntentRejected && oversizedBatchRejected,
});

const invariantCases = parseJsonl<InvariantCase>("evals/cases/world-invariants.jsonl");
const transitionCases = parseJsonl<ClockCase>("evals/cases/chapter-transitions.jsonl");
const invariantFailures = worldResult.ok
  ? invariantCases.filter((evalCase) => !runInvariantCase(worldResult.data, evalCase, validIntent))
  : invariantCases;
const transitionFailures = transitionCases.filter((evalCase) => !runClockCase(evalCase));
gates.push({
  details: {
    invariantFailures: invariantFailures.length,
    invariantCases: invariantCases.length,
    requiredTransitionCases: 35,
    transitionFailures: transitionFailures.length,
    transitionCases: transitionCases.length,
  },
  name: "case-coverage",
  passed:
    invariantCases.length >= 10 &&
    transitionCases.length >= 35 &&
    invariantFailures.length === 0 &&
    transitionFailures.length === 0,
});

let povCasesChecked = 0;
let povLeaks = 0;
if (worldResult.ok) {
  const povCases = parseJsonl<PovLeakCase>("evals/cases/pov-leaks.jsonl");
  for (const evalCase of povCases) {
    const context = buildPovContext(worldResult.data, evalCase.pov as never);
    povCasesChecked += 1;
    const semanticLeak =
      evalCase.forbiddenText !== undefined &&
      JSON.stringify(context)
        .toLocaleLowerCase("en-US")
        .includes(evalCase.forbiddenText.toLocaleLowerCase("en-US"));
    if (contextContainsFact(context, evalCase.hiddenFact) || semanticLeak) {
      povLeaks += 1;
    }
  }
}

gates.push({
  details: { checked: povCasesChecked, leaks: povLeaks, requiredViewpoints: 6 },
  name: "pov-knowledge",
  passed: povCasesChecked >= 6 && povLeaks === 0,
});

let simulations = 0;
let invalidSimulations = 0;
const simulationFailureReasons: Record<string, number> = {};
if (worldResult.ok) {
  for (let seed = 0; seed < 1_000; seed += 1) {
    simulations += 1;
    const failureReason = runSeededSimulation(worldResult.data, seed);
    if (failureReason !== null) {
      invalidSimulations += 1;
      simulationFailureReasons[failureReason] = (simulationFailureReasons[failureReason] ?? 0) + 1;
    }
  }
}

gates.push({
  details: {
    failureReasons: JSON.stringify(simulationFailureReasons),
    invalidSimulations,
    requiredSimulations: 1_000,
    simulations,
  },
  name: "seeded-simulations",
  passed: simulations >= 1_000 && invalidSimulations === 0,
});

const terminalSimulation = worldResult.ok
  ? runTerminalSimulation(worldResult.data)
  : { blockedChapter351: false, commits: 0, terminalAt350: false };
gates.push({
  details: terminalSimulation,
  name: "terminal-horizon",
  passed:
    terminalSimulation.commits === 350 &&
    terminalSimulation.terminalAt350 &&
    terminalSimulation.blockedChapter351,
});

const passed = gates.every((gate) => gate.passed);
const report = {
  contractVersion: CONTRACT_VERSION,
  durationMs: Date.now() - startedAt,
  fixtureVersion: FIXTURE_VERSION,
  gates,
  generatedAt: new Date().toISOString(),
  passed,
};
const reportPath = join("evals", "reports", "offline.json");

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

for (const gate of gates) {
  console.log(`${gate.passed ? "PASS" : "FAIL"} ${gate.name} ${JSON.stringify(gate.details)}`);
}
console.log(`Offline eval ${passed ? "passed" : "failed"}. Report: ${reportPath}`);

if (!passed) {
  process.exitCode = 1;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function parseJsonl<T = unknown>(path: string): T[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function runClockCase(evalCase: ClockCase): boolean {
  const policy = getClockPolicy(evalCase.currentChapter) as unknown as Record<
    string,
    boolean | number | null
  >;
  return Object.entries(evalCase.expect).every(([key, expected]) => policy[key] === expected);
}

function runInvariantCase(
  seedState: Extract<ReturnType<typeof validateWorldState>, { ok: true }>["data"],
  evalCase: InvariantCase,
  intentTemplate: Readonly<Record<string, unknown>>,
): boolean {
  if (evalCase.kind === "schema") {
    const result =
      evalCase.target === "intent-batch"
        ? IntentBatchSchema.safeParse({
            intents: Array.from({ length: 4 }, (_, index) => ({
              ...intentTemplate,
              id: `intent-overflow-${index}`,
            })),
          })
        : WorldIntentSchema.safeParse({ ...intentTemplate, invented: true });
    return !result.success && evalCase.expect.code === "INVALID_SCHEMA";
  }

  const state = structuredClone(seedState);
  applyFixtureMutation(state, evalCase);
  const result =
    evalCase.kind === "world"
      ? validateWorldState(state)
      : validateIntent(state, {
          ...intentTemplate,
          action: normalizeAction(evalCase.action),
          actorId: evalCase.actor,
          id: evalCase.id,
          prerequisites: {
            requiredFactIds: evalCase.requiredFactId ? [evalCase.requiredFactId] : [],
            requiredItemIds: [],
            requiredSkillIds: [],
          },
          stateVersion: evalCase.stateVersion ?? state.version,
        });

  if (evalCase.expect.accepted) {
    return result.ok;
  }
  return !result.ok && result.issues.some(({ code }) => code === evalCase.expect.code);
}

function normalizeAction(action: Readonly<Record<string, unknown>> | undefined): unknown {
  if (!action) {
    return { type: "wait" };
  }
  if (action.type === "use_item") {
    return { ...action, targetId: null };
  }
  if (action.type === "use_skill") {
    return { ...action, targetId: null };
  }
  return action;
}

function applyFixtureMutation(
  state: Extract<ReturnType<typeof validateWorldState>, { ok: true }>["data"],
  evalCase: InvariantCase,
): void {
  const mutation = evalCase.fixtureMutation;
  if (!mutation) {
    return;
  }

  if (typeof mutation.act === "number") {
    state.act = mutation.act as never;
  }
  if (typeof mutation.chapter === "number") {
    state.chapter = mutation.chapter;
  }
  if (typeof mutation.terminal === "boolean") {
    state.terminal = mutation.terminal;
  }

  const characterId =
    typeof mutation.characterId === "string" ? mutation.characterId : evalCase.actor;
  const character = state.characters.find(({ id }) => id === characterId);
  if (!character) {
    return;
  }
  if (typeof mutation.status === "string") {
    character.status = mutation.status as never;
  }
  if (typeof mutation.locationId === "string") {
    character.locationId = mutation.locationId;
  }
  if (typeof mutation.itemId === "string" && typeof mutation.quantity === "number") {
    const item = character.inventory.find(({ itemId }) => itemId === mutation.itemId);
    if (item) {
      item.quantity = mutation.quantity;
    }
  }
  if (typeof mutation.equipmentItemId === "string") {
    character.equipmentItemIds.push(mutation.equipmentItemId);
  }
}

function runSeededSimulation(seedState: WorldState, seed: number): string | null {
  const state = structuredClone(seedState);
  const currentChapter = seed % 350;
  const currentLocalChapter = currentChapter === 0 ? 0 : ((currentChapter - 1) % 50) + 1;
  state.act = actForStateChapter(currentChapter);
  state.arcClock.convergencePressure = currentLocalChapter >= 40;
  state.arcClock.transitionRequired = currentLocalChapter === 50;
  state.calendar.day = currentChapter + 1;
  state.calendar.label = `Year 1, Ashfall ${state.calendar.day}`;
  state.chapter = currentChapter;
  state.lockedPovId = "rowan-ashborn";
  state.terminal = false;
  state.terminalReason = null;
  state.version = seed + 1;
  for (const milestone of state.arcClock.milestones) {
    milestone.completed = milestone.requiredByChapter <= currentChapter;
  }

  const before = JSON.stringify(state);
  const policy = getClockPolicy(state.chapter);
  const milestone = state.arcClock.milestones.find(({ act }) => act === policy.currentAct);
  const action = policy.choicesRequireMilestone
    ? {
        subjectId: milestone?.completed ? "cinder-village" : (milestone?.id ?? "missing"),
        type: "investigate" as const,
      }
    : seededPlayerAction(seed);
  const milestoneId = policy.choicesRequireMilestone ? (milestone?.id ?? null) : null;
  const backgroundCount = seed % 4;
  const backgroundActors = ["nyra-vale", "elara-voss", "maelin-rook"] as const;
  const backgroundIntents = backgroundActors.slice(0, backgroundCount).map((actorId, index) => ({
    action: { type: "wait" as const },
    actorId,
    contractVersion: CONTRACT_VERSION,
    expectedEffect: "Watch the world change.",
    goal: "Protect current interests.",
    id: `intent-sim-${seed}-${index}`,
    prerequisites: { requiredFactIds: [], requiredItemIds: [], requiredSkillIds: [] },
    promptVersion: PROMPT_VERSION,
    stateVersion: state.version,
  }));
  const resolved = resolveTurn(
    state,
    {
      action,
      actorId: "rowan-ashborn",
      description: "Take one deterministic simulation action.",
      milestoneId,
      source: "suggested",
      stateVersion: state.version,
    },
    backgroundIntents,
  );
  if (!resolved.ok) {
    return `resolve:${resolved.issues.map(({ code }) => code).join(",")}`;
  }
  const staged = stageWorldDelta(state, resolved.data.intents, resolved.data.delta);
  if (!staged.ok) {
    return `stage:${staged.issues.map(({ code }) => code).join(",")}`;
  }
  if (JSON.stringify(state) !== before) {
    return "input-mutated";
  }
  if (staged.data.state.chapter !== currentChapter + 1) {
    return "chapter-not-incremented";
  }
  if (staged.data.state.version !== state.version + 1) {
    return "version-not-incremented";
  }
  const finalValidation = validateWorldState(staged.data.state);
  return finalValidation.ok
    ? null
    : `final:${finalValidation.issues.map(({ code }) => code).join(",")}`;
}

function seededPlayerAction(seed: number): Readonly<Record<string, unknown>> {
  switch (seed % 4) {
    case 0:
      return { destinationId: "ash-road", type: "move" };
    case 1:
      return { itemId: "copper-coin", quantity: 1, targetId: null, type: "use_item" };
    case 2:
      return { skillId: "ember-sense", targetId: null, type: "use_skill" };
    default:
      return { type: "wait" };
  }
}

function runTerminalSimulation(seedState: WorldState): {
  readonly blockedChapter351: boolean;
  readonly commits: number;
  readonly terminalAt350: boolean;
} {
  let state = structuredClone(seedState);
  state.lockedPovId = "rowan-ashborn";
  let commits = 0;
  while (state.chapter < 350) {
    const policy = getClockPolicy(state.chapter);
    const milestone = state.arcClock.milestones.find(({ act }) => act === policy.currentAct);
    const milestoneId = policy.choicesRequireMilestone ? (milestone?.id ?? null) : null;
    const resolved = resolveTurn(
      state,
      {
        action: policy.choicesRequireMilestone
          ? {
              subjectId: milestone?.completed ? "cinder-village" : (milestone?.id ?? "missing"),
              type: "investigate",
            }
          : { type: "wait" },
        actorId: "rowan-ashborn",
        description: "Advance the deterministic horizon simulation.",
        milestoneId,
        source: "suggested",
        stateVersion: state.version,
      },
      [],
    );
    if (!resolved.ok) {
      break;
    }
    const staged = stageWorldDelta(state, resolved.data.intents, resolved.data.delta);
    if (!staged.ok) {
      break;
    }
    state = staged.data.state;
    commits += 1;
  }

  const forbidden = resolveTurn(
    state,
    {
      action: { type: "wait" },
      actorId: "rowan-ashborn",
      description: "This action must never resolve.",
      milestoneId: null,
      source: "suggested",
      stateVersion: state.version,
    },
    [],
  );
  return {
    blockedChapter351:
      !forbidden.ok && forbidden.issues.some(({ code }) => code === "STORY_TERMINAL"),
    commits,
    terminalAt350: state.chapter === 350 && state.terminal && state.act === 7,
  };
}
