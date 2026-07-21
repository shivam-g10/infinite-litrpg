import {
  BackgroundIntentCandidateSchema,
  CONTRACT_VERSION,
  IntentActionSchema,
  IntentBatchSchema,
  type IntentAction,
  type KnowledgeMutation,
  type PlayerAction,
  PlayerActionSchema,
  PROMPT_VERSION,
  type RejectionCode,
  type ResolvedEvent,
  type StateMutation,
  type WorldDelta,
  type WorldIntent,
  WorldIntentSchema,
  type WorldState,
} from "../contracts";
import { getClockPolicy } from "./clock";
import {
  type ValidationCode,
  type ValidationResult,
  validateIntent,
  validateWorldState,
} from "./validation";

export interface ResolvedTurn {
  readonly delta: WorldDelta;
  readonly intents: readonly WorldIntent[];
  readonly playerIntent: WorldIntent;
}

export interface CanonicalIntentDisposition {
  readonly accepted: readonly WorldIntent[];
  readonly intents: readonly WorldIntent[];
  readonly rejected: WorldDelta["rejectedIntents"];
}

const EXPERIENCE_BY_ACTION = {
  defend: 15,
  interact: 15,
  move: 10,
  rally: 15,
  use_item: 5,
  use_skill: 10,
  wait: 0,
} as const;

const ASH_ROAD_INVESTIGATION_CLAIMS = [
  "Boot prints on Ash Road split: raiders marched toward Black March while one barefoot trail returned to Cinder Village.",
  "Blue glass grit in the Ash Road wagon ruts forms a broken System seal keyed to the Guild Outpost.",
  "A snapped axle pin beside Ash Road bears a filed imperial crown mark beneath the soot.",
  "A charred survey stake on Ash Road points to a concealed supply route entering Black March.",
] as const;

export function canonicalizeBackgroundIntentCandidate(
  candidateInput: unknown,
  actorId: string,
  stateVersion: number,
  ordinal: number,
): WorldIntent {
  const candidate = BackgroundIntentCandidateSchema.parse(candidateInput);
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 3) {
    throw new Error("Background intent ordinal must be between one and three");
  }
  const action = canonicalizeBackgroundIntentAction(candidate.a);
  return WorldIntentSchema.parse({
    action,
    actorId,
    contractVersion: CONTRACT_VERSION,
    expectedEffect: candidate.e,
    goal: candidate.g,
    id: `intent-background-${stateVersion}-${ordinal}`,
    prerequisites: {
      requiredFactIds: candidate.r.f,
      requiredItemIds: candidate.r.i,
      requiredSkillIds: candidate.r.s,
    },
    promptVersion: PROMPT_VERSION,
    stateVersion,
  });
}

function canonicalizeBackgroundIntentAction(
  candidate: ReturnType<typeof BackgroundIntentCandidateSchema.parse>["a"],
): IntentAction {
  const args = candidate.v;
  switch (candidate.t) {
    case "move": {
      assertBackgroundActionArity(candidate.t, args, 1);
      return IntentActionSchema.parse({ destinationId: args[0], type: candidate.t });
    }
    case "use_item":
      assertBackgroundActionArity(candidate.t, args, 3);
      return IntentActionSchema.parse({
        itemId: args[0],
        quantity: args[1],
        targetId: args[2],
        type: candidate.t,
      });
    case "use_skill":
      assertBackgroundActionArity(candidate.t, args, 2);
      return IntentActionSchema.parse({
        skillId: args[0],
        targetId: args[1],
        type: candidate.t,
      });
    case "investigate":
      assertBackgroundActionArity(candidate.t, args, 1);
      return IntentActionSchema.parse({ subjectId: args[0], type: candidate.t });
    case "interact":
      assertBackgroundActionArity(candidate.t, args, 2);
      return IntentActionSchema.parse({
        approach: args[1],
        targetId: args[0],
        type: candidate.t,
      });
    case "defend":
      assertBackgroundActionArity(candidate.t, args, 1);
      return IntentActionSchema.parse({ targetId: args[0], type: candidate.t });
    case "rally":
      assertBackgroundActionArity(candidate.t, args, 2);
      return IntentActionSchema.parse({
        factionId: args[0],
        locationId: args[1],
        type: candidate.t,
      });
    case "wait":
      assertBackgroundActionArity(candidate.t, args, 0);
      return IntentActionSchema.parse({ type: candidate.t });
  }
}

function assertBackgroundActionArity(
  type: string,
  args: readonly unknown[],
  expected: number,
): void {
  if (args.length !== expected) {
    throw new Error(`Background ${type} action requires ${expected} arguments`);
  }
}

export function resolveTurn(
  stateInput: unknown,
  playerActionInput: unknown,
  backgroundIntentsInput: unknown,
): ValidationResult<ResolvedTurn> {
  const stateResult = validateWorldState(stateInput);
  if (!stateResult.ok) {
    return stateResult;
  }
  const state = stateResult.data;
  const policy = getClockPolicy(state.chapter);
  if (!policy.modelCallAllowed || state.terminal || policy.nextChapter === null) {
    return failure("STORY_TERMINAL", "Chapter 350 cannot resolve another turn", "chapter");
  }
  const nextChapter = policy.nextChapter;

  const playerActionResult = PlayerActionSchema.safeParse(playerActionInput);
  if (!playerActionResult.success) {
    return schemaFailure(playerActionResult.error.issues);
  }
  const batchResult = IntentBatchSchema.safeParse({ intents: backgroundIntentsInput });
  if (!batchResult.success) {
    return schemaFailure(batchResult.error.issues);
  }

  const playerAction = playerActionResult.data;
  if (state.lockedPovId === null) {
    return failure("POV_NOT_LOCKED", "Select and lock a viewpoint before resolving", "lockedPovId");
  }
  if (playerAction.actorId !== state.lockedPovId) {
    return failure("POV_MISMATCH", "Player action actor must match locked viewpoint", "actorId");
  }
  const actMilestone = state.arcClock.milestones.find(({ act }) => act === policy.currentAct);
  if (
    policy.choicesRequireMilestone &&
    (actMilestone === undefined ||
      playerAction.milestoneId !== actMilestone.id ||
      !actMilestone.compatibleActionTypes.includes(playerAction.action.type) ||
      (!actMilestone.completed && !actionAdvancesMilestone(playerAction.action, actMilestone)))
  ) {
    return failure(
      "MILESTONE_REQUIRED",
      `Chapter ${nextChapter} action must advance the act milestone`,
      "milestoneId",
    );
  }

  const playerIntent = toPlayerIntent(state, playerAction, nextChapter);
  if (batchResult.data.intents.some(({ id }) => id === playerIntent.id)) {
    return failure(
      "DUPLICATE_INTENT_RESULT",
      `Background intent collides with ${playerIntent.id}`,
      "intents",
    );
  }
  const playerValidation = validateIntent(state, playerIntent);
  if (!playerValidation.ok) {
    return playerValidation;
  }

  const disposition = resolveCanonicalIntentDisposition(state, [
    playerIntent,
    ...batchResult.data.intents,
  ]);
  if (disposition === null) {
    return failure("INTENT_UNKNOWN", "Turn lacks one canonical player intent", "intents");
  }
  const { accepted, intents, rejected } = disposition;

  const events: ResolvedEvent[] = [];
  const stateMutations: StateMutation[] = [];
  const knowledgeMutations: KnowledgeMutation[] = [];
  const surfacedClueFactIds: string[] = [];
  accepted.forEach((intent, index) => {
    const outcome = resolveIntentOutcome(state, intent, nextChapter, index, accepted);
    events.push(outcome.event);
    stateMutations.push(...outcome.mutations);
    knowledgeMutations.push(...outcome.knowledgeMutations);
    surfacedClueFactIds.push(...outcome.surfacedClueFactIds);
  });
  stateMutations.push(...resolveTurnLevelStateMutations(state, accepted));
  const earlyTerminal = stateMutations.some(({ type }) => type === "end_story");

  const delta: WorldDelta = {
    acceptedIntentIds: accepted.map(({ id }) => id),
    clock: {
      convergencePressure: policy.convergencePressure,
      fromAct: state.act,
      fromChapter: state.chapter,
      terminal: policy.terminal || earlyTerminal,
      toAct: policy.postCommitAct,
      toChapter: nextChapter,
      transitionRequired: policy.transitionRequired,
    },
    contractVersion: CONTRACT_VERSION,
    events,
    expectedWorldVersion: state.version,
    knowledgeMutations,
    promptVersion: PROMPT_VERSION,
    rejectedIntents: rejected,
    stateMutations,
    surfacedClueFactIds,
  };

  return { data: { delta, intents, playerIntent }, ok: true };
}

export function resolveCanonicalIntentDisposition(
  state: WorldState,
  inputIntents: readonly WorldIntent[],
): CanonicalIntentDisposition | null {
  const policy = getClockPolicy(state.chapter);
  if (policy.nextChapter === null || state.lockedPovId === null) return null;
  const expectedPlayerIntentId = `intent-player-${policy.nextChapter}-${state.version}`;
  const playerMatches = inputIntents.filter(
    ({ actorId, id }) => id === expectedPlayerIntentId && actorId === state.lockedPovId,
  );
  if (
    playerMatches.length !== 1 ||
    new Set(inputIntents.map(({ id }) => id)).size !== inputIntents.length
  ) {
    return null;
  }
  const playerIntent = playerMatches[0];
  if (!playerIntent || !validateIntent(state, playerIntent).ok) return null;
  const backgroundIntents = inputIntents
    .filter((intent) => intent !== playerIntent)
    .sort(
      (left, right) => left.actorId.localeCompare(right.actorId) || left.id.localeCompare(right.id),
    );
  if (backgroundIntents.length > 3) return null;

  const intents = [playerIntent, ...backgroundIntents];
  const accepted: WorldIntent[] = [playerIntent];
  const rejected: WorldDelta["rejectedIntents"] = [];
  const claimedConflictKeys = new Set(conflictKeys(playerIntent));
  for (const intent of backgroundIntents) {
    const validation = validateIntent(state, intent);
    if (!validation.ok) {
      const firstIssue = validation.issues[0];
      rejected.push({
        code: rejectionCode(firstIssue?.code),
        intentId: intent.id,
        reason: firstIssue?.message ?? "Intent precondition failed",
      });
      continue;
    }
    const keys = conflictKeys(intent);
    if (keys.some((key) => claimedConflictKeys.has(key))) {
      rejected.push({
        code: "CONFLICT_LOST",
        intentId: intent.id,
        reason: "A higher-priority intent claimed the same actor or target",
      });
      continue;
    }
    accepted.push(intent);
    for (const key of keys) claimedConflictKeys.add(key);
  }
  return { accepted, intents, rejected };
}

export function resolveTurnLevelStateMutations(
  state: WorldState,
  accepted: readonly WorldIntent[],
): StateMutation[] {
  const policy = getClockPolicy(state.chapter);
  const playerIntent = accepted.find(
    (intent) =>
      intent.id === `intent-player-${String(policy.nextChapter)}-${state.version}` &&
      intent.actorId === state.lockedPovId,
  );
  if (!playerIntent) return [];

  const mutations: StateMutation[] = [];
  const experience = resolvePlayerExperienceAward(state, playerIntent, accepted);
  if (experience > 0) {
    mutations.push({
      amount: experience,
      characterId: playerIntent.actorId,
      type: "grant_experience",
    });
  }
  const milestone = state.arcClock.milestones.find(({ act }) => act === policy.currentAct);
  if (
    policy.choicesRequireMilestone &&
    milestone &&
    !milestone.completed &&
    actionAdvancesMilestone(playerIntent.action, milestone)
  ) {
    mutations.push({ milestoneId: milestone.id, type: "complete_milestone" });
  }
  if (!policy.terminal && canEndStoryEarly(state, playerIntent)) {
    mutations.push({
      reason: "The final choice resolved the Void, the Crown, and the chosen life.",
      resolvedEndingConstraints: [...state.endingConstraints],
      type: "end_story",
    });
  }
  return mutations;
}

export function resolvePlayerExperienceAward(
  state: WorldState,
  playerIntent: WorldIntent,
  accepted: readonly WorldIntent[],
): number {
  if (playerIntent.action.type === "investigate") {
    const nextChapter = getClockPolicy(state.chapter).nextChapter;
    const ordinal = accepted.findIndex(({ id }) => id === playerIntent.id);
    if (nextChapter === null || ordinal < 0) return 0;
    const outcome = resolveIntentOutcome(state, playerIntent, nextChapter, ordinal, accepted);
    return outcome.knowledgeMutations.some(({ type }) => type === "discover_fact") ? 15 : 0;
  }
  return EXPERIENCE_BY_ACTION[playerIntent.action.type];
}

export function actionAdvancesMilestone(
  action: IntentAction,
  milestone: WorldState["arcClock"]["milestones"][number],
): boolean {
  if (!milestone.compatibleActionTypes.includes(action.type)) return false;
  switch (action.type) {
    case "investigate":
      return action.subjectId === milestone.id;
    case "interact":
    case "defend":
      return action.targetId === milestone.id;
    case "use_item":
    case "use_skill":
      return action.targetId === milestone.id;
    default:
      return false;
  }
}

function canEndStoryEarly(state: WorldState, playerIntent: WorldIntent): boolean {
  if (
    state.act !== 7 ||
    state.chapter < 301 ||
    !state.arcClock.milestones.every(({ completed }) => completed)
  ) {
    return false;
  }
  const finaleMilestone = state.arcClock.milestones.find(({ act }) => act === 7);
  return (
    finaleMilestone !== undefined && actionAdvancesMilestone(playerIntent.action, finaleMilestone)
  );
}

function toPlayerIntent(state: WorldState, action: PlayerAction, nextChapter: number): WorldIntent {
  return {
    action: action.action,
    actorId: action.actorId,
    contractVersion: CONTRACT_VERSION,
    expectedEffect: action.description,
    goal: action.description,
    id: `intent-player-${nextChapter}-${state.version}`,
    prerequisites: { requiredFactIds: [], requiredItemIds: [], requiredSkillIds: [] },
    promptVersion: PROMPT_VERSION,
    stateVersion: action.stateVersion,
  };
}

function conflictKeys(intent: WorldIntent): string[] {
  const keys = [`actor:${intent.actorId}`];
  switch (intent.action.type) {
    case "interact":
    case "defend":
      keys.push(`target:${intent.action.targetId}`);
      break;
    case "rally":
      keys.push(`rally:${intent.action.locationId}:${intent.action.factionId}`);
      break;
    default:
      break;
  }
  return keys;
}

export function resolveIntentOutcome(
  state: WorldState,
  intent: WorldIntent,
  chapter: number,
  ordinal: number,
  turnIntents: readonly WorldIntent[] = [intent],
): {
  readonly event: ResolvedEvent;
  readonly knowledgeMutations: KnowledgeMutation[];
  readonly mutations: StateMutation[];
  readonly surfacedClueFactIds: string[];
} {
  const actor = state.characters.find(({ id }) => id === intent.actorId);
  if (!actor) {
    throw new Error(`Resolved intent has missing actor ${intent.actorId}`);
  }

  const mutations: StateMutation[] = [];
  const knowledgeMutations: KnowledgeMutation[] = [];
  const surfacedClueFactIds: string[] = [];
  let locationId = actor.locationId;
  if (intent.action.type === "move") {
    locationId = intent.action.destinationId;
    mutations.push({
      characterId: actor.id,
      fromLocationId: actor.locationId,
      toLocationIds: [intent.action.destinationId],
      type: "set_location",
    });
  } else if (intent.action.type === "use_item") {
    const action = intent.action;
    const item = actor.inventory.find(({ itemId }) => itemId === action.itemId);
    if (!item) {
      throw new Error(`Resolved item intent has missing item ${action.itemId}`);
    }
    mutations.push({
      characterId: actor.id,
      itemId: item.itemId,
      name: item.name,
      quantityDelta: -action.quantity,
      type: "adjust_inventory",
      unique: item.unique,
    });
  } else if (intent.action.type === "use_skill") {
    const action = intent.action;
    const skill = actor.skills.find(({ id }) => id === action.skillId);
    if (!skill) {
      throw new Error(`Resolved skill intent has missing skill ${action.skillId}`);
    }
    mutations.push({
      characterId: actor.id,
      delta: -skill.manaCost,
      resource: "mana",
      type: "adjust_resource",
    });
  } else if (intent.action.type === "investigate") {
    const ledger = state.knowledgeLedgers.find(({ characterId }) => characterId === actor.id);
    const hasFactCapacity = state.facts.length + ordinal < 1_000;
    const hasLedgerCapacity = ledger !== undefined && ledger.entries.length < 500;
    if (hasFactCapacity && hasLedgerCapacity) {
      const fact = investigationFact(state, actor, intent.action.subjectId, chapter, ordinal);
      if (fact) {
        knowledgeMutations.push({ characterId: actor.id, fact, type: "discover_fact" });
        surfacedClueFactIds.push(fact.id);
      }
    }
  } else if (intent.action.type === "interact" || intent.action.type === "defend") {
    const targetId = intent.action.targetId;
    const target = state.characters.find(({ id }) => id === targetId);
    if (target && target.id !== actor.id) {
      const relationship = actor.relationships.find(({ characterId }) => characterId === target.id);
      mutations.push({
        characterId: actor.id,
        label:
          relationship?.label ??
          (intent.action.type === "interact" ? "new acquaintance" : "protected ally"),
        score: Math.min(100, (relationship?.score ?? 0) + 1),
        targetCharacterId: target.id,
        type: "set_relationship",
      });
    }
  }

  const locationsAfterTurn = resolvedCharacterLocations(state, turnIntents);
  const observerIds = state.characters
    .filter(({ id }) => id !== actor.id && locationsAfterTurn.get(id) === locationId)
    .map(({ id }) => id);
  return {
    event: {
      id: `event-${chapter}-${ordinal}-${actor.id}`,
      kind: intent.action.type.replaceAll("_", "-"),
      locationId,
      observerIds,
      participantIds: [actor.id],
      summary: summarizeAction(actor.name, intent.action),
      visibility: "participants",
    },
    knowledgeMutations,
    mutations,
    surfacedClueFactIds,
  };
}

function resolvedCharacterLocations(
  state: WorldState,
  intents: readonly WorldIntent[],
): ReadonlyMap<string, string> {
  const locations = new Map(state.characters.map(({ id, locationId }) => [id, locationId]));
  for (const intent of intents) {
    if (intent.action.type === "move") {
      locations.set(intent.actorId, intent.action.destinationId);
    }
  }
  return locations;
}

function investigationFact(
  state: WorldState,
  actor: WorldState["characters"][number],
  subjectId: string,
  chapter: number,
  ordinal: number,
): WorldState["facts"][number] | null {
  const location = state.locations.find(({ id }) => id === subjectId);
  const event = state.activeEvents.find(({ id }) => id === subjectId);
  const fact = state.facts.find(({ id }) => id === subjectId);
  const milestone = state.arcClock.milestones.find(({ id }) => id === subjectId);
  const subject =
    location?.name ?? event?.summary ?? fact?.claim ?? milestone?.description ?? subjectId;
  const source = shortText(`Investigation of ${subjectId}`);
  const clueIndex = state.facts.filter(
    (candidate) => candidate.ownerCharacterId === actor.id && candidate.source === source,
  ).length;
  const claim = investigationClaim(state, actor, subjectId, subject, clueIndex);
  if (claim === null) return null;
  return {
    certainty: "likely",
    claim: shortText(claim),
    discoveredChapter: chapter,
    id: `clue-${chapter}-${ordinal}-${actor.id}`,
    ownerCharacterId: actor.id,
    source,
    visibility: "observed",
  };
}

function investigationClaim(
  state: WorldState,
  actor: WorldState["characters"][number],
  subjectId: string,
  subject: string,
  clueIndex: number,
): string | null {
  if (subjectId === "ash-road") return ASH_ROAD_INVESTIGATION_CLAIMS[clueIndex] ?? null;
  const location = state.locations.find(({ id }) => id === subjectId);
  const leadId =
    location?.adjacentLocationIds[clueIndex % (location.adjacentLocationIds.length || 1)];
  const lead = state.locations.find(({ id }) => id === leadId)?.name ?? actor.locationId;
  const claims = [
    `${actor.name} found corroborating traces tied to ${subject}`,
    `A System appraisal at ${subject} marked altered mana residue beneath the obvious trail.`,
    `Tool marks at ${subject} showed organized preparation by someone who expected pursuit.`,
    `The final recoverable trail from ${subject} pointed toward ${lead}.`,
  ] as const;
  return claims[clueIndex] ?? null;
}

function shortText(value: string): string {
  return value.length <= 240 ? value : `${value.slice(0, 237)}...`;
}

function summarizeAction(actorName: string, action: IntentAction): string {
  switch (action.type) {
    case "move":
      return `${actorName} moved to ${action.destinationId}.`;
    case "use_item":
      return `${actorName} used ${action.quantity} ${action.itemId}.`;
    case "use_skill":
      return `${actorName} used ${action.skillId}.`;
    case "investigate":
      return `${actorName} investigated ${action.subjectId}.`;
    case "interact":
      return `${actorName} approached ${action.targetId}: ${action.approach}`;
    case "defend":
      return `${actorName} defended ${action.targetId}.`;
    case "rally":
      return `${actorName} rallied ${action.factionId} at ${action.locationId}.`;
    case "wait":
      return `${actorName} waited and watched.`;
  }
}

function rejectionCode(code: ValidationCode | undefined): RejectionCode {
  switch (code) {
    case "CHARACTER_DEAD":
    case "CHARACTER_MISSING":
    case "INVALID_SCHEMA":
    case "ITEM_MISSING":
    case "KNOWLEDGE_MISSING":
    case "LOCATION_MISSING":
    case "LOCATION_NOT_ADJACENT":
    case "MANA_INSUFFICIENT":
    case "SKILL_LOCKED":
    case "STALE_WORLD_VERSION":
    case "STORY_TERMINAL":
    case "TARGET_MISSING":
      return code;
    default:
      return "PRECONDITION_FAILED";
  }
}

function failure<T>(code: ValidationCode, message: string, path: string): ValidationResult<T> {
  return { issues: [{ code, message, path }], ok: false };
}

function schemaFailure<T>(
  issues: readonly { readonly message: string; readonly path: readonly PropertyKey[] }[],
): ValidationResult<T> {
  return {
    issues: issues.map((entry) => ({
      code: "INVALID_SCHEMA",
      message: entry.message,
      path: entry.path.map(String).join("."),
    })),
    ok: false,
  };
}
