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
      "Translate the user's attempted action into one strict PlayerAction. Do not make it succeed. Preserve intent honestly. Use only supplied context.",
    milestone:
      policy.choicesRequireMilestone && milestone
        ? {
            compatibleActionTypes: milestone.compatibleActionTypes,
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
      "Return a short chapter title and exactly two materially different, legal next attempts. A terminal state returns zero choices. Never reveal hidden facts.",
    milestone:
      policy.choicesRequireMilestone && milestone
        ? {
            compatibleActionTypes: milestone.compatibleActionTypes,
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
    acceptedEvents: visibleEventsForPov(delta, povId),
    canonicalEffects: canonicalEffectsForPov(delta, povId),
    chapter: prospective.chapter,
    forbiddenAdditions: [
      "No extra action by the viewpoint character beyond playerAction and canonicalEffects.",
      "No unlisted skill or item use, mana or health change, inventory change, clue, discovery, reward, injury, relationship change, or new named person, group, object, symbol, quest, or enemy. Existing supplied names may be recalled but not used unless listed as an effect.",
      "Never claim a remote character knew, saw, heard, awaited, expected, received, noticed, answered, reacted to, or was affected by the viewpoint character unless acceptedEvents explicitly includes that character as a participant or observer.",
      "A plan or goal to contact someone permits only the viewpoint character's intention. It does not permit contact, delivery, reception, awareness, or response.",
      "A canonical move permits the viewpoint character to arrive at the destination. It does not make anyone else notice the arrival.",
      "A visible event by another character permits only the supplied event summary. Never narrate what that character found, inferred, confirmed, or discovered unless the result appears in viewpointCanon.facts.",
      "No elapsed time beyond the supplied calendar change.",
      "No durable world fact beyond acceptedEvents. Generic sensory texture may not assert new canon.",
      "Never narrate a background intent as an action performed by the viewpoint character.",
    ],
    instruction:
      "Write only the complete chapter prose. Use close-third viewpoint. Write 975 to 1025 words and stop before 1100. The absolute valid range is 900 to 1300 words. Dramatize exactly the attempted action and canonical effects, not plausible extra actions. viewpointCanon is established after-turn knowledge; playerAction and canonicalEffects define the transition. Show only supplied LitRPG changes. Build depth with immediate sensory texture, existing beliefs and goals, and already-known facts. Use supplied facts at face value only: never extrapolate their causes, mechanisms, history, places, or consequences. These may add prose but never canon. Do not append choices or notes.",
    playerAction,
    stateTransition: {
      actAfter: prospective.act,
      chapterAfter: prospective.chapter,
      chapterBefore: before.chapter,
      convergencePressure: prospective.arcClock.convergencePressure,
      transitionRequired: prospective.arcClock.transitionRequired,
    },
    viewpointCanon: compactPovContext(prospective, povId),
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
    allowedCanonicalEffects: canonicalEffectsForPov(delta, povId),
    chapterFrame: { terminal: chapterFrame.terminal, title: chapterFrame.title },
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
      "Audit only. Never change canon. Audit the title, nextChoices, and prose as one artifact. choiceFulfillment scores whether prose fulfills playerAction. nextChoices are future options and must not occur in this prose; never penalize them for not occurring. forbiddenFacts and forbiddenRemoteEffects exist only for leak detection; never treat them as permitted knowledge. Asserting or paraphrasing any forbidden remote event or mutation gives povSafety zero with issueCode hidden-knowledge, even when true canon. Only an item in forbiddenFacts can appear in leakedFactIds. Every field in viewpointCanon is established POV canon, including plan, goals, beliefs, relationships, inventory, and observed events. Referring to an intention from plan or goals does not claim completion. Every field in visibleCanonicalEvents and allowedCanonicalEffects is permitted POV knowledge. Event participantIds and observerIds establish witnesses, not motives or private thoughts. A System notice that exactly restates allowed canonical mutations is permitted. Score every rubric dimension 0 to 2. Return seven evidence objects in rubricDimensions order. Each object copies its dimension, uses one allowed issueCode, and gives detail under 25 words. Use issueCode pass only when that dimension score is above zero. Continuity is zero for a contradiction or unsupported durable canon, not generic sensory texture. Any zero or leaked fact rejects. Copy proseHash exactly.",
    playerAction,
    prose,
    proseHash,
    nextChoices: chapterFrame.choices,
    rubricDimensions: NARRATIVE_AUDIT_DIMENSIONS,
    allowedIssueCodes: NARRATIVE_AUDIT_ISSUE_CODES,
    viewpointCanon: compactPovContext(prospective, povId),
    visibleCanonicalEvents: visibleEventsForPov(delta, povId),
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
  const milestoneId = policy.choicesRequireMilestone
    ? (state.arcClock.milestones.find(({ act }) => act === policy.currentAct)?.id ?? null)
    : null;
  return {
    defend: [...localCharacterIds, actor.locationId, actor.factionId, ...visibleEventIds],
    interact: localCharacterIds.filter((id) => id !== actor.id),
    investigate: [
      actor.locationId,
      ...visibleEventIds,
      ...context.factIds,
      ...(milestoneId ? [milestoneId] : []),
    ],
    move: state.locations.find(({ id }) => id === actor.locationId)?.adjacentLocationIds ?? [],
    rally: [{ factionId: actor.factionId, locationId: actor.locationId }],
    targetableCharacters: localCharacterIds,
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
