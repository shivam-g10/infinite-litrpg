import {
  CONTRACT_VERSION,
  NARRATIVE_AUDIT_DIMENSIONS,
  NARRATIVE_AUDIT_ISSUE_CODES,
  PROMPT_VERSION,
  buildPovContext,
  getClockPolicy,
  type CharacterState,
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
      "You are one background character in Ashen Crown. Emit intent only. Never mutate canon.",
      "Use only this character's knowledge. Unknown private facts do not exist for you.",
      `Return exactly one strict WorldIntent for actor ${actor.id}.`,
      JSON.stringify({
        contractVersion: CONTRACT_VERSION,
        promptVersion: PROMPT_VERSION,
        stateVersion: state.version,
        legalActionTargets: legalActionTargets(state, actor.id),
        world: publicWorldContext(state),
        viewpoint: buildPovContext(state, actor.id),
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
    "Return one strict IntentBatch in the root final answer. No prose outside JSON.",
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
  const policy = getClockPolicy(state.chapter);
  const milestone = state.arcClock.milestones.find(({ act }) => act === policy.currentAct);
  return JSON.stringify({
    instruction:
      "Return a short chapter title and exactly two materially different, legal next attempts. A terminal state returns zero choices. Never reveal hidden facts. During a milestone lock, both choices copy milestone.id into milestoneId and use compatible action types. If completed is false, each action directly targets milestone.id through investigate.subjectId or a supported targetId; return two distinct action objects.",
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
    stateVersion: state.version,
    legalActionTargets: legalActionTargets(state, state.lockedPovId),
    terminal: state.terminal,
    viewpoint: buildPovContext(state, state.lockedPovId),
    world: publicWorldContext(state),
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
  return JSON.stringify({
    afterTurnViewpointCanon: compactPovContext(prospective, povId),
    beforeTurnEffectValues: beforeTurnEffectValues(before, delta, povId),
    chapter: prospective.chapter,
    currentChapterCanonicalEffects: canonicalEffectsForPov(delta, povId),
    currentChapterVisibleEvents: visibleEventsForPov(delta, povId),
    forbiddenAdditions: [
      "No extra action by the viewpoint character beyond playerAction and currentChapterCanonicalEffects.",
      "No unlisted skill or item use, mana or health change, inventory change, clue, discovery, reward, injury, relationship change, or new named person, group, object, symbol, quest, or enemy. Existing supplied names may be recalled but not used unless listed as an effect.",
      "Never claim a remote character knew, saw, heard, awaited, expected, received, noticed, answered, reacted to, or was affected by the viewpoint character unless currentChapterVisibleEvents explicitly includes that character as a participant or observer.",
      "A plan or goal to contact someone permits only the viewpoint character's intention. It does not permit contact, delivery, reception, awareness, or response.",
      "A canonical move permits the viewpoint character to arrive at the destination. It does not make anyone else notice the arrival.",
      "A visible event by another character permits only the supplied event summary. Never narrate what that character found, inferred, confirmed, or discovered unless the result appears in afterTurnViewpointCanon.facts.",
      "No elapsed time beyond the supplied calendar change.",
      "No new durable world fact beyond afterTurnViewpointCanon, world, currentChapterVisibleEvents, and currentChapterCanonicalEffects. Generic sensory texture may not assert new canon.",
      "The supplied canon fields are exhaustive. Never combine an identity, threat, location, plan, belief, goal, or public history into a new relationship. Shared names or themes do not license that relationship.",
      "Never narrate a background intent as an action performed by the viewpoint character.",
    ],
    instruction:
      "Write only the complete chapter prose. Use close-third viewpoint. Write 925 to 975 words and stop before 1000. The absolute valid range is 900 to 1300 words. Dramatize exactly the attempted action and currentChapterCanonicalEffects, not plausible extra actions. currentChapterCanonicalEffects and currentChapterVisibleEvents happen during this chapter. afterTurnViewpointCanon is the resulting state and already includes those changes. beforeTurnEffectValues contains only the prior values touched by those effects. Compare them when describing a listed change as newly happening. Show only supplied LitRPG changes. Knowledge whitelist: afterTurnViewpointCanon, currentChapterVisibleEvents, currentChapterCanonicalEffects, and world are exhaustive. Every field in world is established public canon; an exact restatement or faithful paraphrase is permitted. A relationship between any person, threat, place, event, or history is forbidden unless one whitelist field states that exact relationship. Never combine fields to invent a cause, mechanism, relationship, or remembered history. Never turn an identity, plan, goal, belief, or shared vocabulary into remembered history. Build depth with immediate sensory texture, existing beliefs and goals, and already-known facts. Use supplied facts at face value only: never extrapolate their causes, mechanisms, history, places, or consequences. These may add prose but never canon. Do not append choices or notes.",
    playerAction,
    stateTransition: {
      actAfter: prospective.act,
      chapterAfter: prospective.chapter,
      chapterBefore: before.chapter,
      convergencePressure: prospective.arcClock.convergencePressure,
      transitionRequired: prospective.arcClock.transitionRequired,
    },
    world: localWorldContext(before, prospective, povId, delta),
  });
}

export function buildAuditPrompt(
  before: WorldState,
  prospective: WorldState,
  playerAction: PlayerAction,
  delta: WorldDelta,
  chapterFrame: {
    readonly choices: readonly unknown[];
    readonly terminal: boolean;
    readonly title: string;
  },
  prose: string,
  proseHash: string,
): string {
  if (prospective.lockedPovId === null) throw new Error("POV must be locked");
  const povId = prospective.lockedPovId;
  const allowedFactIds = new Set(buildPovContext(prospective, povId).factIds);
  return JSON.stringify({
    afterTurnViewpointCanon: compactPovContext(prospective, povId),
    beforeTurnEffectValues: beforeTurnEffectValues(before, delta, povId),
    chapterFrame: { terminal: chapterFrame.terminal, title: chapterFrame.title },
    currentChapterCanonicalEffects: canonicalEffectsForPov(delta, povId),
    currentChapterVisibleEvents: visibleEventsForPov(delta, povId),
    forbiddenFacts: prospective.facts
      .filter(({ id }) => !allowedFactIds.has(id))
      .map(({ claim, id }) => ({ claim, id })),
    forbiddenRemoteEffects: {
      events: delta.events.filter((event) => !eventVisibleToPov(event, povId)),
      knowledgeMutations: delta.knowledgeMutations.filter(
        (mutation) => mutation.characterId !== povId,
      ),
      stateMutations: delta.stateMutations.filter(
        (mutation) => "characterId" in mutation && mutation.characterId !== povId,
      ),
    },
    instruction:
      "Audit only; never change canon. Audit title, nextChoices, and prose together. Score all seven rubricDimensions 0 to 2 in order. Return one matching evidence item per dimension, using an allowedIssueCode and detail under 18 words. Use pass iff its score is above zero. Any zero or leaked fact rejects; copy proseHash. choiceFulfillment judges only playerAction. nextChoices are future options and must not occur now; never penalize their absence. Current effects and visible events happen this chapter; after-turn canon already includes them and before-turn values are prior. Never call an exact listed effect pre-existing; compare its prior value. Every field in afterTurnViewpointCanon and world is established canon permitted in prose. Exact restatements or faithful paraphrases of world fields are not leaks. If text is fully supported by a world field, do not reject it solely because it overlaps a forbidden fact; reject only details exclusive to forbiddenFacts. Combining fields into an unlisted cause, mechanism, relationship, or history is forbidden. Referring to an intention from plan or goals does not claim completion. Participants and observers are witnesses, not motives or thoughts. Exact current mutations may appear as System notices. forbiddenFacts and forbiddenRemoteEffects are detection-only, never permitted knowledge. Asserting or paraphrasing any forbidden remote event or mutation, or any detail exclusive to forbiddenFacts, gives povSafety zero with hidden-knowledge. leakedFactIds may contain only matching forbiddenFacts IDs. Continuity is zero only for contradiction or unsupported durable canon, not sensory texture.",
    playerAction,
    prose,
    proseHash,
    nextChoices: chapterFrame.choices,
    rubricDimensions: NARRATIVE_AUDIT_DIMENSIONS,
    allowedIssueCodes: NARRATIVE_AUDIT_ISSUE_CODES,
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
  return {
    clock: delta.clock,
    knowledgeMutations: delta.knowledgeMutations.filter(
      (mutation) => mutation.characterId === povId,
    ),
    stateMutations: delta.stateMutations.filter(
      (mutation) => !("characterId" in mutation) || mutation.characterId === povId,
    ),
  };
}

function compactPovContext(state: WorldState, povId: string) {
  const context = buildPovContext(state, povId);
  return {
    facts: context.facts,
    observedEvents: context.observedEvents,
    povCharacter: context.povCharacter,
    publicCharacters: context.publicCharacters,
  };
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
  const locationIds = new Set([
    beforePov?.locationId,
    afterPov?.locationId,
    ...visibleEventsForPov(delta, povId).map(({ locationId }) => locationId),
  ]);
  locationIds.delete(undefined);
  return {
    act: prospective.act,
    calendar: prospective.calendar,
    chapter: prospective.chapter,
    factions: prospective.factions,
    locations: prospective.locations.filter(({ id }) => locationIds.has(id)),
    threat: prospective.threat,
    version: prospective.version,
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
