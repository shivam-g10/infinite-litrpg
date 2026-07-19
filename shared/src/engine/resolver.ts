import {
  CONTRACT_VERSION,
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
      !actMilestone.compatibleActionTypes.includes(playerAction.action.type))
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

  const backgroundIntents = [...batchResult.data.intents].sort(
    (left, right) => left.actorId.localeCompare(right.actorId) || left.id.localeCompare(right.id),
  );
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
    for (const key of keys) {
      claimedConflictKeys.add(key);
    }
  }

  const events: ResolvedEvent[] = [];
  const stateMutations: StateMutation[] = [];
  const knowledgeMutations: KnowledgeMutation[] = [];
  const surfacedClueFactIds: string[] = [];
  accepted.forEach((intent, index) => {
    const outcome = resolveIntentOutcome(state, intent, nextChapter, index);
    events.push(outcome.event);
    stateMutations.push(...outcome.mutations);
    knowledgeMutations.push(...outcome.knowledgeMutations);
    surfacedClueFactIds.push(...outcome.surfacedClueFactIds);
  });
  stateMutations.push({
    amount: 10,
    characterId: playerIntent.actorId,
    type: "grant_experience",
  });
  if (policy.choicesRequireMilestone && actMilestone && !actMilestone.completed) {
    stateMutations.push({ milestoneId: actMilestone.id, type: "complete_milestone" });
  }

  const delta: WorldDelta = {
    acceptedIntentIds: accepted.map(({ id }) => id),
    clock: {
      convergencePressure: policy.convergencePressure,
      fromAct: state.act,
      fromChapter: state.chapter,
      terminal: policy.terminal,
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
      knowledgeMutations.push({ characterId: actor.id, fact, type: "discover_fact" });
      surfacedClueFactIds.push(fact.id);
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

  const observerIds = state.characters
    .filter(
      ({ id, locationId: witnessLocation }) => id !== actor.id && witnessLocation === locationId,
    )
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

function investigationFact(
  state: WorldState,
  actor: WorldState["characters"][number],
  subjectId: string,
  chapter: number,
  ordinal: number,
): WorldState["facts"][number] {
  const location = state.locations.find(({ id }) => id === subjectId);
  const event = state.activeEvents.find(({ id }) => id === subjectId);
  const fact = state.facts.find(({ id }) => id === subjectId);
  const milestone = state.arcClock.milestones.find(({ id }) => id === subjectId);
  const subject =
    location?.name ?? event?.summary ?? fact?.claim ?? milestone?.description ?? subjectId;
  return {
    certainty: "likely",
    claim: shortText(`${actor.name} found corroborating traces tied to ${subject}`),
    discoveredChapter: chapter,
    id: `clue-${chapter}-${ordinal}-${actor.id}`,
    ownerCharacterId: actor.id,
    source: shortText(`Investigation of ${subjectId}`),
    visibility: "observed",
  };
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
