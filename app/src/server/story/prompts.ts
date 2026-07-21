import {
  CONTRACT_VERSION,
  PROMPT_VERSION,
  RUNTIME_SCHEMA_VERSION,
  buildChapterChoiceOptions,
  buildPovContext,
  getClockPolicy,
  type CharacterState,
  type Choice,
  type PlayerAction,
  type WorldDelta,
  type WorldState,
} from "@infinite-litrpg/shared";

import type { LunaAgentInput } from "../openai";

export function selectBackgroundActors(state: WorldState): CharacterState[] {
  if (state.lockedPovId === null) return [];
  const pov = state.characters.find(({ id }) => id === state.lockedPovId);
  if (!pov) return [];
  const currentLocation = state.locations.find(({ id }) => id === pov.locationId);

  return state.characters
    .filter(
      ({ id, status }) =>
        id !== pov.id && status !== "dead" && status !== "terminal" && status !== "incapacitated",
    )
    .map((character) => ({
      character,
      score: relevanceScore(state, pov, currentLocation, character),
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.character.id.localeCompare(right.character.id),
    )
    .slice(0, 3)
    .map(({ character }) => character);
}

export function buildLunaAgentInputs(
  state: WorldState,
  actors: readonly CharacterState[],
): LunaAgentInput[] {
  return actors.map((actor) => ({
    actorId: actor.id,
    instructions: [
      `Ashen Crown ${actor.id}. Return BackgroundIntent.`,
      "Intent only. Never mutate canon. Use only supplied facts.",
      'Output={"a":{"t":type,"v":[args]},"g":goal,"e":expectedEffect,"r":{"f":factIds,"i":itemIds,"s":skillIds}}. goal/expectedEffect <=12 words. Shortest JSON.',
      "action args order: move dest; use_item item,qty,target; use_skill skill,target; investigate subject; interact target,approach; defend target; rally faction,location; wait none.",
      JSON.stringify({
        legalActionTargets: legalActionTargets(state, actor.id),
        world: compactPublicWorldContext(state),
        viewpoint: compactCompletePovContext(state, actor.id),
      }),
    ].join("\n"),
  }));
}

export function buildLunaCoordinatorInstructions(actors: readonly CharacterState[]): string {
  return [
    "Coordinate only the approved Ashen Crown background characters.",
    `Approved actors: ${actors.map(({ id }) => id).join(", ")}.`,
    "Spawn at most one direct subagent per approved actor. Never spawn descendants.",
    "Each character emits intent only from its supplied private context.",
    "Return one strict BackgroundIntentBatch in the root final answer. No prose outside JSON.",
  ].join("\n");
}

export function buildCustomActionPrompt(state: WorldState, description: string): string {
  if (state.lockedPovId === null) throw new Error("POV must be locked");
  const policy = getClockPolicy(state.chapter);
  const milestone = state.arcClock.milestones.find(({ act }) => act === policy.currentAct);
  return JSON.stringify({
    allowedActionTypes: [
      "move",
      "use_item",
      "use_skill",
      "investigate",
      "interact",
      "defend",
      "rally",
      "wait",
    ],
    contractVersion: CONTRACT_VERSION,
    customDescription: description,
    instruction:
      "Translate the user's attempted action into one strict PlayerAction. Do not make it succeed. Preserve intent honestly. Never replace an explicit investigation with wait: investigate, inspect, examine, search, scan, and look for require action.type investigate. For an unnamed immediate area or local tracks, use the first legalActionTargets.investigate ID, which is the POV character's current location. Use only supplied context. During a milestone lock, copy milestone.id into milestoneId and use a compatible action. If completed is false, the action must directly target milestone.id through investigate.subjectId or a supported targetId.",
    milestone:
      policy.choicesRequireMilestone && milestone
        ? {
            compatibleActionTypes: milestone.compatibleActionTypes,
            completed: milestone.completed,
            completionTargetRule:
              "When incomplete, directly target id through investigate.subjectId or targetId. Move and rally cannot complete a milestone.",
            description: milestone.description,
            id: milestone.id,
          }
        : null,
    promptVersion: PROMPT_VERSION,
    legalActionTargets: legalActionTargets(state, state.lockedPovId),
    source: "custom",
    stateVersion: state.version,
    viewpoint: buildPovContext(state, state.lockedPovId),
    world: publicWorldContext(state),
  });
}

export function buildChapterFramePrompt(state: WorldState): string {
  if (state.lockedPovId === null) throw new Error("POV must be locked");
  return JSON.stringify({
    optionsByIdAsDescription: Object.fromEntries(
      buildChapterChoiceOptions(state).map(({ description, id }) => [id, description]),
    ),
    terminal: state.terminal,
    viewpoint: compactCompletePovContext(state, state.lockedPovId),
    world: compactPublicWorldContext(state),
  });
}

export function buildNarrationPrompt(
  before: WorldState,
  prospective: WorldState,
  playerAction: PlayerAction,
  delta: WorldDelta,
): string {
  if (prospective.lockedPovId === null) throw new Error("POV must be locked");
  const povId = prospective.lockedPovId;
  const movement = narrationMovement(before, prospective, delta, povId);
  const exhaustiveWhitelist = movement
    ? "afterCanon, visibleEvents, currentEffects, movement, and world"
    : "afterCanon, visibleEvents, currentEffects, and world";
  return JSON.stringify({
    afterCanon: compactPovContext(prospective, povId, currentEventIds(delta)),
    beforeValues: beforeTurnEffectValues(before, delta, povId),
    currentEffects: canonicalEffectsForPov(delta, povId),
    movement,
    rules: [
      "No viewpoint action beyond playerAction and currentEffects; a background intent is never a viewpoint action.",
      "No unlisted skill or item use, resource or inventory change, clue, discovery, reward, injury, relationship change, or new named entity. Supplied names may be recalled, not acted on unless an effect.",
      "Remote characters act only in visibleEvents. Participants and observers witness only. Plans and goals permit intention only, never contact, delivery, awareness, response, or effect. A move permits arrival only, never notice by others. Another character event permits only its summary; any result requires afterCanon.allowedPovFactsByIdAsCertaintyClaim.",
      "No time beyond calendar. No durable fact beyond the whitelist. Sensory texture adds no canon. Never combine identity, threat, location, plan, belief, goal, history, names, or themes into an unlisted relationship, cause, mechanism, or memory.",
      ...(movement
        ? [
            "movement is the authoritative route. Start in movement.departed, travel away, and end in movement.destination. The departed location stays behind and is never ahead or the destination.",
          ]
        : []),
    ],
    instruction: `Write only complete close-third chapter prose, 900 to 925 words. Never stop before 900; stop before 950. Valid range is 900 to 1300. Dramatize exactly playerAction and currentEffects. currentEffects and visibleEvents happen now; afterCanon includes their results; beforeValues are prior and must be compared for a new change. Show only supplied LitRPG changes. ${exhaustiveWhitelist} are the exhaustive whitelist. Every world field is public canon and may be restated or paraphrased. POV-private afterCanon may appear internally in close third; reader access is not an in-world disclosure, but never reveal it to another character without an allowed currentEffects knowledge mutation or visibleEvent. Avoid character-sheet recap or repeated identity exposition; mention allowed identity, stats, skills, and inventory only when scene-relevant. Any relationship between people, threats, places, events, or history requires one exact whitelist field. Never infer causes, mechanisms, relationships, consequences, or remembered history from identities, plans, beliefs, goals, shared terms, or facts. Build depth only with immediate sensory texture, supplied beliefs, goals, and facts at face value. Append no choices or notes.`,
    playerAction: compactPlayerAction(playerAction),
    visibleEvents: visibleEventsForPov(delta, povId),
    world: localWorldContext(before, prospective, povId, delta),
  });
}

function narrationMovement(
  before: WorldState,
  prospective: WorldState,
  delta: WorldDelta,
  povId: string,
) {
  const mutation = delta.stateMutations.find(
    (
      candidate,
    ): candidate is Extract<WorldDelta["stateMutations"][number], { type: "set_location" }> =>
      candidate.type === "set_location" && candidate.characterId === povId,
  );
  if (!mutation) return undefined;
  const destinationId = mutation.toLocationIds[0];
  const beforePov = before.characters.find(({ id }) => id === povId);
  const afterPov = prospective.characters.find(({ id }) => id === povId);
  if (
    mutation.toLocationIds.length !== 1 ||
    destinationId === undefined ||
    beforePov?.locationId !== mutation.fromLocationId ||
    afterPov?.locationId !== destinationId
  ) {
    throw new Error("Narration movement does not match the staged viewpoint route");
  }
  const departed = before.locations.find(({ id }) => id === mutation.fromLocationId);
  const destination = prospective.locations.find(({ id }) => id === destinationId);
  if (!departed || !destination)
    throw new Error("Narration movement references a missing location");
  return {
    departed: [departed.id, departed.name],
    destination: [destination.id, destination.name],
    direction:
      "Start in departed; travel away from departed; end at destination; departed stays behind.",
  };
}

export const MAX_NARRATION_RECOVERY_PROMPT_BYTES = 1_200;
export const MIN_NARRATION_RECOVERY_DRAFT_WORDS = 750;
export const MAX_NARRATION_RECOVERY_DRAFT_WORDS = 899;
export const MAX_NARRATION_RECOVERY_MERGED_WORDS = 949;
export const NARRATION_RECOVERY_INSTRUCTIONS = "Return continuation only.";

export interface NarrationRecoveryPrompt {
  readonly acceptanceMaximumAdditionalWords: number;
  readonly input: string;
  readonly instructions: string;
  readonly maxOutputTokens: number;
  readonly maximumAdditionalWords: number;
  readonly minimumAdditionalWords: number;
}

export function buildNarrationRecoveryPrompt(prose: string): NarrationRecoveryPrompt {
  const words = prose.trim().split(/\s+/u).filter(Boolean);
  if (
    words.length < MIN_NARRATION_RECOVERY_DRAFT_WORDS ||
    words.length > MAX_NARRATION_RECOVERY_DRAFT_WORDS
  ) {
    throw new Error(
      `Narration recovery requires a draft between ${MIN_NARRATION_RECOVERY_DRAFT_WORDS} and ${MAX_NARRATION_RECOVERY_DRAFT_WORDS} words`,
    );
  }
  const minimumAdditionalWords = 900 - words.length;
  const maximumAdditionalWords = 925 - words.length;
  const acceptanceMaximumAdditionalWords = MAX_NARRATION_RECOVERY_MERGED_WORDS - words.length;
  const maxOutputTokens = Math.min(230, maximumAdditionalWords * 2);
  let excerptWords = words.slice(-120);
  const serialize = () =>
    JSON.stringify({
      existingEnding: excerptWords.join(" "),
      instruction:
        "Return only a seamless continuation. Add no new action, event, entity, dialogue, mechanic, fact, relationship, cause, discovery, decision, time passage, or state change. Reuse only established details from existingEnding. No title, heading, note, or choices.",
      maximumAdditionalWords,
      minimumAdditionalWords,
    });
  let input = serialize();
  while (
    recoveryPromptBytes(input) > MAX_NARRATION_RECOVERY_PROMPT_BYTES &&
    excerptWords.length > 1
  ) {
    excerptWords = excerptWords.slice(1);
    input = serialize();
  }
  if (recoveryPromptBytes(input) > MAX_NARRATION_RECOVERY_PROMPT_BYTES) {
    throw new Error("Narration recovery prompt exceeds its byte cap");
  }
  return {
    acceptanceMaximumAdditionalWords,
    input,
    instructions: NARRATION_RECOVERY_INSTRUCTIONS,
    maxOutputTokens,
    maximumAdditionalWords,
    minimumAdditionalWords,
  };
}

function recoveryPromptBytes(input: string): number {
  return new TextEncoder().encode(`${NARRATION_RECOVERY_INSTRUCTIONS}\n${input}\n`).byteLength;
}

export function buildAuditPrompt(
  before: WorldState,
  prospective: WorldState,
  playerAction: PlayerAction,
  delta: WorldDelta,
  chapterFrame: {
    readonly choices: readonly Choice[];
    readonly terminal: boolean;
    readonly title: string;
  },
  prose: string,
): string {
  if (prospective.lockedPovId === null) throw new Error("POV must be locked");
  const povId = prospective.lockedPovId;
  const allowedFactIds = new Set(buildPovContext(prospective, povId).factIds);
  return JSON.stringify({
    afterCanon: compactPovContext(prospective, povId, currentEventIds(delta)),
    beforeValues: beforeTurnEffectValues(before, delta, povId),
    currentEffects: canonicalEffectsForPov(delta, povId),
    forbiddenFacts: Object.fromEntries(
      prospective.facts
        .filter(({ id }) => !allowedFactIds.has(id))
        .map(({ claim, id }) => [id, claim]),
    ),
    forbiddenRemote: compactForbiddenRemoteEffects(delta, povId),
    frame: { terminal: chapterFrame.terminal, title: chapterFrame.title },
    instruction:
      "Audit frame, nextChoices, prose; do not alter canon. nextChoices tuples=[action,description,milestoneId]. scores/evidence order: choiceFulfillment, characterAutonomy, povSafety, litrpgMechanics, continuity, arcProgress, prose. Scores 0-2. For each score 0, copy an exact prose substring into matching evidence. Set every positive evidence string to pass. Any 0 or leak rejects. choiceFulfillment judges only playerAction; nextChoices are future and may be absent. currentEffects/visibleEvents happen now; afterCanon is the result; beforeValues are prior; a listed effect is not pre-existing. Allowed canon is exactly afterCanon, visibleEvents, currentEffects, world. afterCanon is selected POV knowledge, including private facts, identity, role, beliefs, goals, and plan; internal close-third reader access is not a leak. Another character learning it requires allowed currentEffects or visibleEvents; forbiddenRemote never licenses narration. Allowed fields take precedence: never score povSafety 0 for an exact restatement or faithful paraphrase of one allowed field. World fields may be restated or paraphrased despite forbiddenFacts overlap; reject only exclusive details. Never combine fields to invent cause, mechanism, relationship, motive, thought, or history. A plan or goal permits intent only; participants/observers witness only. Listed mutations may be System notices. forbiddenFacts and forbiddenRemote are detection-only. For content exclusive to forbiddenFacts, set povSafety to 0 and add leakEvidence with its factId and an exact proseQuote. Every leakEvidence factId must come from forbiddenFacts. Score unsupported synthesis under continuity. continuity 0 only for contradiction or unsupported durable canon, not sensory texture.",
    playerAction: compactPlayerAction(playerAction),
    prose,
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    nextChoices: chapterFrame.choices.map(({ action, description, milestoneId }) => [
      action,
      description,
      milestoneId,
    ]),
    visibleEvents: visibleEventsForPov(delta, povId),
    world: localWorldContext(before, prospective, povId, delta),
  });
}

function legalActionTargets(state: WorldState, actorId: string) {
  const context = buildPovContext(state, actorId);
  const actor = context.povCharacter;
  const localCharacterIds = state.characters
    .filter(({ locationId }) => locationId === actor.locationId)
    .map(({ id }) => id);
  const visibleEventIds = context.observedEvents
    .filter(({ locationId }) => locationId === actor.locationId)
    .map(({ id }) => id);
  const policy = getClockPolicy(state.chapter);
  const milestoneId =
    policy.choicesRequireMilestone && actorId === state.lockedPovId
      ? (state.arcClock.milestones.find(({ act }) => act === policy.currentAct)?.id ?? null)
      : null;
  const milestoneTargets = milestoneId ? [milestoneId] : [];
  return {
    defend: [
      ...localCharacterIds,
      actor.locationId,
      actor.factionId,
      ...visibleEventIds,
      ...milestoneTargets,
    ],
    interact: [...localCharacterIds.filter((id) => id !== actor.id), ...milestoneTargets],
    investigate: [
      actor.locationId,
      ...visibleEventIds,
      ...context.factIds,
      ...(milestoneId ? [milestoneId] : []),
    ],
    move: state.locations.find(({ id }) => id === actor.locationId)?.adjacentLocationIds ?? [],
    rally: [{ factionId: actor.factionId, locationId: actor.locationId }],
    targetableCharacters: localCharacterIds,
    use_item: [...localCharacterIds, ...milestoneTargets],
    use_skill: [...localCharacterIds, ...milestoneTargets],
  };
}

function visibleEventsForPov(delta: WorldDelta, povId: string): WorldDelta["events"] {
  return delta.events.filter((event) => eventVisibleToPov(event, povId));
}

function eventVisibleToPov(event: WorldDelta["events"][number], povId: string): boolean {
  return (
    event.visibility === "public" ||
    event.participantIds.includes(povId) ||
    event.observerIds.includes(povId)
  );
}

function canonicalEffectsForPov(delta: WorldDelta, povId: string) {
  const {
    fromAct,
    fromChapter,
    toAct,
    toChapter,
    terminal,
    convergencePressure,
    transitionRequired,
  } = delta.clock;
  return {
    clockAsFromActFromChapterToActToChapterTerminalConvergenceTransition: [
      fromAct,
      fromChapter,
      toAct,
      toChapter,
      terminal,
      convergencePressure,
      transitionRequired,
    ],
    knowledgeMutations: delta.knowledgeMutations
      .filter((mutation) => mutation.characterId === povId)
      .map(compactCurrentKnowledgeMutation),
    stateMutations: delta.stateMutations.filter(
      (mutation) => !("characterId" in mutation) || mutation.characterId === povId,
    ),
  };
}

function compactCurrentKnowledgeMutation(mutation: WorldDelta["knowledgeMutations"][number]) {
  if (mutation.type === "learn_existing_fact") {
    return {
      certainty: mutation.certainty,
      discoveredChapter: mutation.discoveredChapter,
      factId: mutation.factId,
      source: mutation.source,
      type: mutation.type,
    };
  }
  return {
    discoveredChapter: mutation.fact.discoveredChapter,
    factId: mutation.fact.id,
    ownerCharacterId: mutation.fact.ownerCharacterId,
    source: mutation.fact.source,
    type: mutation.type,
    visibility: mutation.fact.visibility,
  };
}

function compactPlayerAction({ action, actorId, description, milestoneId }: PlayerAction) {
  return { action, actorId, description, milestoneId };
}

function compactPovContext(state: WorldState, povId: string, excludedEventIds = new Set<string>()) {
  const context = buildPovContext(state, povId);
  const {
    beliefs,
    characterClassId,
    characterClassName,
    conditions,
    experience,
    factionId,
    goals,
    health,
    id,
    inventory,
    level,
    locationId,
    mana,
    name,
    plan,
    publicRole,
    relationships,
    role,
    skills,
    stats,
    status,
  } = context.povCharacter;
  return {
    allowedPovFactsByIdAsCertaintyClaim: Object.fromEntries(
      context.facts.map(({ certainty, claim, id: factId }) => [factId, [certainty, claim]]),
    ),
    observedEventsByIdAsLocationObserversParticipantsSummary: Object.fromEntries(
      context.observedEvents
        .filter(({ id: eventId }) => !excludedEventIds.has(eventId))
        .map(({ id: eventId, locationId, observerIds, participantIds, summary }) => [
          eventId,
          [locationId, observerIds, participantIds, summary],
        ]),
    ),
    povCharacter: {
      beliefs,
      classAsIdName: [characterClassId, characterClassName],
      experience,
      factionId,
      goals,
      healthAsCurrentMaximum: [health.current, health.maximum],
      identityAsIdNameRolePublicRole: [id, name, role, publicRole],
      inventoryAsItemIdNameQuantityEquippedUnique: inventory.map(
        ({ equipped, itemId, name: itemName, quantity, unique }) => [
          itemId,
          itemName,
          quantity,
          equipped,
          unique,
        ],
      ),
      level,
      locationId,
      manaAsCurrentMaximum: [mana.current, mana.maximum],
      plan,
      relationshipsAsCharacterIdLabelScore: relationships.map(({ characterId, label, score }) => [
        characterId,
        label,
        score,
      ]),
      skillsAsIdNameRankManaCost: skills.map(({ id: skillId, manaCost, name: skillName, rank }) => [
        skillId,
        skillName,
        rank,
        manaCost,
      ]),
      stats,
      status,
      ...(conditions.length > 0 ? { conditions } : {}),
    },
    publicCharacterNamesById: Object.fromEntries(
      context.publicCharacters.map(({ id: characterId, name: characterName }) => [
        characterId,
        characterName,
      ]),
    ),
  };
}

function compactCompletePovContext(state: WorldState, povId: string) {
  const context = buildPovContext(state, povId);
  const character = context.povCharacter;
  return {
    factsByIdAsCertaintyClaimChapterOwnerSourceVisibility: Object.fromEntries(
      context.facts.map(
        ({ certainty, claim, discoveredChapter, id, ownerCharacterId, source, visibility }) => [
          id,
          [certainty, claim, discoveredChapter, ownerCharacterId, source, visibility],
        ],
      ),
    ),
    observedEventsByIdAsLocationObserversParticipantsSummaryVisibility: Object.fromEntries(
      context.observedEvents.map(
        ({ id, locationId, observerIds, participantIds, summary, visibility }) => [
          id,
          [locationId, observerIds, participantIds, summary, visibility],
        ],
      ),
    ),
    povCharacter: {
      beliefs: character.beliefs,
      classAsIdName: [character.characterClassId, character.characterClassName],
      conditions: character.conditions,
      equipmentItemIds: character.equipmentItemIds,
      experience: character.experience,
      factionId: character.factionId,
      goals: character.goals,
      healthAsCurrentMaximum: [character.health.current, character.health.maximum],
      identityAsIdNameRolePublicRole: [
        character.id,
        character.name,
        character.role,
        character.publicRole,
      ],
      inventoryAsItemIdNameQuantityEquippedUnique: character.inventory.map(
        ({ equipped, itemId, name, quantity, unique }) => [
          itemId,
          name,
          quantity,
          equipped,
          unique,
        ],
      ),
      level: character.level,
      locationId: character.locationId,
      manaAsCurrentMaximum: [character.mana.current, character.mana.maximum],
      plan: character.plan,
      relationshipsAsCharacterIdLabelScore: character.relationships.map(
        ({ characterId, label, score }) => [characterId, label, score],
      ),
      secretFactIds: character.secretFactIds,
      skillsAsIdNameRankManaCostMinimumLevelPrerequisitesRequiredClass: character.skills.map(
        ({ id, manaCost, minimumLevel, name, prerequisiteSkillIds, rank, requiredClassId }) => [
          id,
          name,
          rank,
          manaCost,
          minimumLevel,
          prerequisiteSkillIds,
          requiredClassId,
        ],
      ),
      stats: character.stats,
      status: character.status,
    },
    publicCharacterNamesById: Object.fromEntries(
      context.publicCharacters.map(({ id, name }) => [id, name]),
    ),
  };
}

function currentEventIds(delta: WorldDelta): Set<string> {
  return new Set(delta.events.map(({ id }) => id));
}

function compactForbiddenRemoteEffects(delta: WorldDelta, povId: string) {
  const remoteKnowledge = delta.knowledgeMutations.filter(
    (mutation) => mutation.characterId !== povId,
  );
  return {
    discoveredFactsAsActorIdFactIdCertaintyClaimChapterOwnerSourceVisibility:
      remoteKnowledge.flatMap((mutation) =>
        mutation.type === "discover_fact"
          ? [
              [
                mutation.characterId,
                mutation.fact.id,
                mutation.fact.certainty,
                mutation.fact.claim,
                mutation.fact.discoveredChapter,
                mutation.fact.ownerCharacterId,
                mutation.fact.source,
                mutation.fact.visibility,
              ],
            ]
          : [],
      ),
    eventsByIdAsKindLocationObserversParticipantsSummaryVisibility: Object.fromEntries(
      delta.events
        .filter((event) => !eventVisibleToPov(event, povId))
        .map(({ id, kind, locationId, observerIds, participantIds, summary, visibility }) => [
          id,
          [kind, locationId, observerIds, participantIds, summary, visibility],
        ]),
    ),
    learnedFactsAsActorIdFactIdCertaintyChapterSource: remoteKnowledge.flatMap((mutation) =>
      mutation.type === "learn_existing_fact"
        ? [
            [
              mutation.characterId,
              mutation.factId,
              mutation.certainty,
              mutation.discoveredChapter,
              mutation.source,
            ],
          ]
        : [],
    ),
    state: delta.stateMutations.flatMap((mutation) =>
      "characterId" in mutation && mutation.characterId !== povId
        ? [compactRemoteStateMutation(mutation)]
        : [],
    ),
  };
}

function compactRemoteStateMutation(
  mutation: Extract<WorldDelta["stateMutations"][number], { characterId: string }>,
) {
  const actorId = mutation.characterId;
  switch (mutation.type) {
    case "adjust_inventory":
      return {
        actorId,
        itemId: mutation.itemId,
        name: mutation.name,
        quantityDelta: mutation.quantityDelta,
        type: mutation.type,
        unique: mutation.unique,
      };
    case "adjust_resource":
      return { actorId, delta: mutation.delta, resource: mutation.resource, type: mutation.type };
    case "grant_experience":
      return { actorId, amount: mutation.amount, type: mutation.type };
    case "learn_skill":
      return { actorId, skill: mutation.skill, type: mutation.type };
    case "set_location":
      return {
        actorId,
        from: mutation.fromLocationId,
        to: mutation.toLocationIds,
        type: mutation.type,
      };
    case "set_relationship":
      return {
        actorId,
        label: mutation.label,
        score: mutation.score,
        targetId: mutation.targetCharacterId,
        type: mutation.type,
      };
    case "set_status":
      return { actorId, status: mutation.status, type: mutation.type };
  }
}

function beforeTurnEffectValues(state: WorldState, delta: WorldDelta, povId: string) {
  const character = state.characters.find(({ id }) => id === povId);
  if (!character) return {};
  const values: Record<string, unknown> = {};
  for (const mutation of delta.stateMutations) {
    if ("characterId" in mutation && mutation.characterId !== povId) continue;
    switch (mutation.type) {
      case "grant_experience":
        values.experience = character.experience;
        values.level = character.level;
        break;
      case "set_location":
        values.locationId = character.locationId;
        break;
      case "adjust_inventory":
        values.inventoryStack =
          character.inventory.find(({ itemId }) => itemId === mutation.itemId) ?? null;
        break;
      case "adjust_resource":
        values[mutation.resource] = character[mutation.resource];
        break;
      case "set_relationship":
        values.relationship =
          character.relationships.find(
            ({ characterId }) => characterId === mutation.targetCharacterId,
          ) ?? null;
        break;
      case "learn_skill":
        values.skillIds = character.skills.map(({ id }) => id);
        break;
      case "set_status":
        values.status = character.status;
        break;
      case "complete_milestone":
      case "end_story":
      case "set_threat":
        break;
    }
  }
  return values;
}

function localWorldContext(
  before: WorldState,
  prospective: WorldState,
  povId: string,
  delta: WorldDelta,
) {
  const beforePov = before.characters.find(({ id }) => id === povId);
  const afterPov = prospective.characters.find(({ id }) => id === povId);
  const factionIds = new Set([beforePov?.factionId, afterPov?.factionId]);
  factionIds.delete(undefined);
  const locationIds = new Set([
    beforePov?.locationId,
    afterPov?.locationId,
    ...visibleEventsForPov(delta, povId).map(({ locationId }) => locationId),
  ]);
  locationIds.delete(undefined);
  return {
    calendarAsDayLabel: [prospective.calendar.day, prospective.calendar.label],
    factionsByIdAsNameGoal: Object.fromEntries(
      prospective.factions
        .filter(({ id }) => factionIds.has(id))
        .map(({ id, name, publicGoal }) => [id, [name, publicGoal]]),
    ),
    locationsByIdAsNameDescriptionAdjacentIds: Object.fromEntries(
      prospective.locations
        .filter(({ id }) => locationIds.has(id))
        .map(({ adjacentLocationIds, id, name, publicDescription }) => [
          id,
          [name, publicDescription, adjacentLocationIds],
        ]),
    ),
    threat: prospective.threat,
  };
}

function publicWorldContext(state: WorldState) {
  return {
    act: state.act,
    calendar: state.calendar,
    chapter: state.chapter,
    factions: state.factions,
    locations: state.locations,
    threat: state.threat,
    version: state.version,
  };
}

function compactPublicWorldContext(state: WorldState) {
  return {
    act: state.act,
    calendarAsDayLabel: [state.calendar.day, state.calendar.label],
    chapter: state.chapter,
    factionsByIdAsNameGoal: Object.fromEntries(
      state.factions.map(({ id, name, publicGoal }) => [id, [name, publicGoal]]),
    ),
    locationsByIdAsNameDescriptionAdjacentIds: Object.fromEntries(
      state.locations.map(({ adjacentLocationIds, id, name, publicDescription }) => [
        id,
        [name, publicDescription, adjacentLocationIds],
      ]),
    ),
    threat: state.threat,
    version: state.version,
  };
}

function relevanceScore(
  state: WorldState,
  pov: CharacterState,
  currentLocation: WorldState["locations"][number] | undefined,
  candidate: CharacterState,
): number {
  let score = 0;
  if (candidate.locationId === pov.locationId) score += 1_000;
  if (currentLocation?.adjacentLocationIds.includes(candidate.locationId)) score += 500;
  score += Math.abs(
    pov.relationships.find(({ characterId }) => characterId === candidate.id)?.score ?? 0,
  );
  if (
    state.activeEvents.some(
      (event) =>
        event.participantIds.includes(candidate.id) || event.observerIds.includes(candidate.id),
    )
  ) {
    score += 100;
  }
  return score;
}
