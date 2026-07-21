import {
  CONTRACT_VERSION,
  PROMPT_VERSION,
  RUNTIME_SCHEMA_VERSION,
  buildChapterChoiceOptions,
  buildPovContext,
  buildTenChapterQualityPlan,
  getClockPolicy,
  type CharacterState,
  type Choice,
  type PlayerAction,
  type PersistedTraceEnvelope,
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
  history: readonly BackgroundStoryHistoryEntry[] = [],
): LunaAgentInput[] {
  assertCompleteBackgroundHistory(state, history);
  return actors.map((actor) => ({
    actorId: actor.id,
    instructions: [
      `Ashen Crown ${actor.id}. Return BackgroundIntent.`,
      "Intent only. Never mutate canon. Use only supplied facts.",
      "povSafeChapterHistory is ordered memory, not omniscience. Continue from the actor's own intent results, known events, learned facts, and canonical changes. Empty fields license no inference. Never reconstruct selected-viewpoint prose or hidden facts.",
      'Output={"a":{"t":type,"v":[args]},"g":goal,"e":expectedEffect,"r":{"f":factIds,"i":itemIds,"s":skillIds}}. goal/expectedEffect <=12 words. Shortest JSON.',
      "action args order: move dest; use_item item,qty,target; use_skill skill,target; investigate subject; interact target,approach; defend target; rally faction,location; wait none.",
      JSON.stringify({
        legalActionTargets: legalActionTargets(state, actor.id),
        povSafeChapterHistory: compactPovSafeChapterHistory(state, actor.id, history),
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

export interface StoryHistoryEntry {
  readonly action: PlayerAction["action"];
  readonly actionDescription: string;
  readonly chapter: number;
  readonly prose: string;
  readonly title: string;
}

export interface BackgroundStoryHistoryEntry {
  readonly chapter: number;
  readonly delta: PersistedTraceEnvelope["acceptedDelta"];
  readonly intents: PersistedTraceEnvelope["intents"];
}

export function buildChapterFramePrompt(
  state: WorldState,
  history: readonly StoryHistoryEntry[] = [],
): string {
  if (state.lockedPovId === null) throw new Error("POV must be locked");
  const presentCharacters = presentCharactersForPov(state, state.lockedPovId);
  const options = buildChapterChoiceOptions(state);
  return JSON.stringify({
    ...(history.length > 0
      ? {
          storyHistory: compactStoryHistory(history),
          titleRules:
            "Return a concrete title unlike every prior title. Do not reuse a recent title's main verb, object, or template.",
        }
      : {}),
    optionsByIdAsDescription: Object.fromEntries(
      options.map(({ description, id }) => [id, description]),
    ),
    optionActionsById: Object.fromEntries(options.map(({ action, id }) => [id, action])),
    serialArc: serialArcGuide(Math.max(1, state.chapter)),
    tenChapterQualityPlan: buildTenChapterQualityPlan(
      Math.max(1, state.chapter),
      presentCharacters.length > 0,
    ),
    terminal: state.terminal,
    presentCharacters,
    viewpoint: compactCompletePovContext(state, state.lockedPovId),
    world: compactPublicWorldContext(state),
  });
}

export function buildNarrationPrompt(
  before: WorldState,
  prospective: WorldState,
  playerAction: PlayerAction,
  delta: WorldDelta,
  history: readonly StoryHistoryEntry[] = [],
): string {
  if (prospective.lockedPovId === null) throw new Error("POV must be locked");
  const povId = prospective.lockedPovId;
  const presentCharacters = presentCharactersForPov(prospective, povId);
  const movement = narrationMovement(before, prospective, delta, povId);
  const exhaustiveWhitelist = movement
    ? "afterCanon, visibleEvents, currentEffects, movement, and world"
    : "afterCanon, visibleEvents, currentEffects, and world";
  return JSON.stringify({
    ...(history.length > 0 ? { storyHistory: compactStoryHistory(history) } : {}),
    afterCanon: compactPovContext(prospective, povId, currentEventIds(delta)),
    beforeValues: beforeTurnEffectValues(before, delta, povId),
    currentEffects: canonicalEffectsForPov(delta, povId),
    characterAnchors: characterTurnAnchors(prospective, povId),
    movement,
    presentCharacters,
    rules: [
      "Use non-canonical scene craft for gestures, sensory detail, moment-to-moment movement, natural speech, reactions, and failed tactical beats consistent with canon. No consequential viewpoint action beyond playerAction and currentEffects; a background intent is never a viewpoint action.",
      "No unlisted skill or item use, resource or inventory change, clue, discovery, reward, injury, relationship change, or new named entity. Supplied names may be recalled, not acted on unless an effect.",
      "Remote characters act only in visibleEvents. Participants and observers witness only. Plans and goals permit intention only, never contact, delivery, awareness, response, or effect. A move permits arrival only, never notice by others. Another character event permits only its summary; any result requires afterCanon.allowedPovFactsByIdAsCertaintyClaim.",
      "No time beyond calendar. No durable fact beyond the whitelist. Sensory texture adds no canon. Never combine identity, threat, location, plan, belief, goal, history, names, or themes into an unlisted relationship, cause, mechanism, or memory.",
      ...(movement
        ? [
            "movement is the authoritative route. Start in movement.departed, travel away, and end in movement.destination. The departed location stays behind and is never ahead or the destination.",
          ]
        : []),
    ],
    serialArc: serialArcGuide(delta.clock.toChapter),
    tenChapterQualityPlan: buildTenChapterQualityPlan(
      delta.clock.toChapter,
      presentCharacters.length > 0,
    ),
    instruction: `Write only a complete scene in close third at the natural length needed to dramatize playerAction and currentEffects. The scene needs a clear immediate goal, resistance, a meaningful choice, a consequence, and a forward hook. Follow serialArc and tenChapterQualityPlan: advance their phase and scheduled beats instead of repeating the last scene. currentEffects and visibleEvents happen now; afterCanon includes their results; beforeValues are prior and must be compared for a new change. Make the LitRPG System active rather than decorative: show supplied quest, stat, resource, skill, class, or progression information only when it creates pressure, a tradeoff, or a decision. Show every supplied mechanical change as a concise in-world System notice. Treat world.systemQuest as the named current System quest, but never complete it unless currentEffects says so. ${exhaustiveWhitelist} are the exhaustive whitelist. Every world field is public canon and may be restated or paraphrased. POV-private afterCanon may appear internally in close third; reader access is not an in-world disclosure, but never reveal it to another character without an allowed currentEffects knowledge mutation or visibleEvent. Use storyHistory as exact continuity: advance rather than recap it, preserve established voices, and never repeat a prior opening, title pattern, scene structure, or paragraph. Follow tenChapterQualityPlan.beats.consequentialDialogue. When it is true and presentCharacters is nonempty, use distinct present-character voices in an exchange that changes the current plan, supplied relationship pressure, or conflict. When it is true and presentCharacters is empty, never invent a remote speaker: have the viewpoint speak a consequential choice aloud to the canonical System; the System may answer only with exact supplied quest or mechanic language, never personality or a new fact. Make nextChoices route toward a reachable character. When it is false, dialogue is optional and the scene shape must still vary. Ground every character turn in characterAnchors and earlier behavior in storyHistory. Show a choice, hesitation, admission, refusal, tactical adjustment, or reaction that tests or confirms supplied beliefs, goals, plan, relationships, or currentEffects. Do not invent a durable belief, promise, relationship change, memory, or later behavior. A durable change may appear only when currentEffects or afterCanon supplies it; otherwise the turn is momentary behavior consistent with canon. End after a concrete consequence and stronger next problem. Avoid character-sheet recap or repeated identity exposition; mention allowed identity, stats, skills, and inventory only when scene-relevant. Use non-canonical scene craft for gestures, sensory detail, moment-to-moment movement, tactical failed attempts, natural dialogue, and reactions consistent with canon. Non-canonical scene craft cannot add a durable fact, relationship, state, resource, capability, discovery, named entity, or consequence. Any relationship between people, threats, places, events, or history requires one exact whitelist field. Never infer causes, mechanisms, relationships, consequences, or remembered history from identities, plans, beliefs, goals, shared terms, or facts. Append no choices or notes.`,
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
  history: readonly StoryHistoryEntry[] = [],
): string {
  if (prospective.lockedPovId === null) throw new Error("POV must be locked");
  const povId = prospective.lockedPovId;
  const presentCharacters = presentCharactersForPov(prospective, povId);
  const allowedFactIds = new Set(buildPovContext(prospective, povId).factIds);
  return JSON.stringify({
    ...(history.length > 0 ? { storyHistory: compactStoryHistory(history) } : {}),
    afterCanon: compactPovContext(prospective, povId, currentEventIds(delta)),
    beforeValues: beforeTurnEffectValues(before, delta, povId),
    currentEffects: canonicalEffectsForPov(delta, povId),
    characterAnchors: characterTurnAnchors(prospective, povId),
    forbiddenFacts: Object.fromEntries(
      prospective.facts
        .filter(({ id }) => !allowedFactIds.has(id))
        .map(({ claim, id }) => [id, claim]),
    ),
    forbiddenRemote: compactForbiddenRemoteEffects(delta, povId),
    frame: { terminal: chapterFrame.terminal, title: chapterFrame.title },
    presentCharacters,
    serialArc: serialArcGuide(delta.clock.toChapter),
    tenChapterQualityPlan: buildTenChapterQualityPlan(
      delta.clock.toChapter,
      presentCharacters.length > 0,
    ),
    instruction:
      "Audit frame, nextChoices, prose, storyHistory, serialArc, and tenChapterQualityPlan; do not alter canon. Reject an incomplete or abruptly cut-off scene. nextChoices tuples=[action,description,milestoneId]. scores/evidence order: choiceFulfillment, characterAutonomy, povSafety, litrpgMechanics, continuity, arcProgress, prose. Scores 0-2. For each score 0, copy an exact prose substring into matching evidence. Set every positive evidence string to pass. Any 0 or leak rejects. choiceFulfillment judges only playerAction; nextChoices are future and may be absent. characterAutonomy is 0 when the viewpoint has no dramatized choice or vulnerable reaction anchored to characterAnchors, currentEffects, or prior behavior. Do not invent a durable belief, promise, relationship change, memory, or later behavior, and do not demand or approve one unless currentEffects supplies it. When tenChapterQualityPlan.beats.consequentialDialogue is true and presentCharacters is nonempty, characterAutonomy is 0 if their exchange does not change the current plan, supplied relationship pressure, or conflict. When the dialogue beat is due and presentCharacters is empty, reject an invented remote speaker; accept only the viewpoint speaking a consequential choice aloud to the canonical System and a System answer copied from supplied quest or mechanic language. Reject System personality or a new fact. litrpgMechanics is 0 when a supplied mechanical change lacks an explicit in-world System notice, a scheduled System consequence changes nothing, or a scheduled System tradeoff lacks both a decision and cost, risk, sacrifice, or foregone option. arcProgress is 0 when the scene misses serialArc or tenChapterQualityPlan requirements or fails to move a concrete objective, thread, relationship, knowledge state, threat, location, resource, or capability beyond storyHistory. prose is 0 for a missing scheduled dialogue beat, repeated opening, title pattern or scene construction, recap, scene-loop, copied language from storyHistory, missing consequence, or missing forward hook. currentEffects/visibleEvents happen now; afterCanon is the result; beforeValues are prior; a listed effect is not pre-existing. Allowed canon is exactly afterCanon, visibleEvents, currentEffects, world, and storyHistory. afterCanon is selected POV knowledge, including private facts, identity, role, beliefs, goals, and plan; internal close-third reader access is not a leak. Another character learning it requires allowed currentEffects or visibleEvents; forbiddenRemote never licenses narration. Allowed fields take precedence: never score povSafety 0 for an exact restatement or faithful paraphrase of one allowed field. World fields may be restated or paraphrased despite forbiddenFacts overlap; reject only exclusive details. Never combine fields to invent cause, mechanism, relationship, motive, thought, or history. A plan or goal permits intent only; participants/observers witness only. Listed mutations may be System notices. Non-canonical scene craft such as gestures, sensory detail, moment-to-moment movement, natural speech, reactions, and failed tactical beats is allowed when it adds no durable canon. forbiddenFacts and forbiddenRemote are detection-only. For content exclusive to forbiddenFacts, set povSafety to 0 and add leakEvidence with its factId and an exact proseQuote. Every leakEvidence factId must come from forbiddenFacts. Score unsupported synthesis under continuity. continuity 0 only for contradiction or unsupported durable canon, not scene craft.",
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

function serialArcGuide(chapter: number) {
  const position = ((Math.max(1, chapter) - 1) % 10) + 1;
  const arcNumber = Math.ceil(Math.max(1, chapter) / 10);
  if (position === 1) {
    return {
      arcNumber,
      phase: "commitment",
      position,
      requirements: [
        "Apply immediate System pressure.",
        "Expose the viewpoint's present want or flaw through a choice.",
        "Commit the viewpoint to a concrete short-term problem.",
      ],
    };
  }
  if (position <= 3) {
    return {
      arcNumber,
      phase: "setup",
      position,
      requirements: [
        "Deepen the problem instead of restating it.",
        "Test a supplied relationship or System tradeoff that can pay off later.",
        "Change the next objective.",
      ],
    };
  }
  if (position <= 7) {
    return {
      arcNumber,
      phase: "escalation",
      position,
      requirements: [
        "Increase cost, danger, or relationship friction.",
        "Force a consequential choice using current System information.",
        "Deliver a reversal or close one route forward.",
      ],
    };
  }
  if (position <= 9) {
    return {
      arcNumber,
      phase: "convergence",
      position,
      requirements: [
        "Bring prior choices and relationship pressure into the same conflict.",
        "Spend or risk something accumulated earlier.",
        "Prepare a specific payoff without delaying the scene's own consequence.",
      ],
    };
  }
  return {
    arcNumber,
    phase: "payoff",
    position,
    requirements: [
      "Pay off a setup from this ten-chapter arc.",
      "Materially change situation, relationship, capability, knowledge, objective, or threat.",
      "End on a stronger next problem rather than resetting the premise.",
    ],
  };
}

function presentCharactersForPov(state: WorldState, povId: string) {
  const pov = state.characters.find(({ id }) => id === povId);
  if (!pov) return [];
  return state.characters
    .filter(
      ({ id, locationId, status }) =>
        id !== povId && locationId === pov.locationId && status !== "dead" && status !== "terminal",
    )
    .map(({ id, name, publicRole }) => {
      const relationship = pov.relationships.find(({ characterId }) => characterId === id);
      return {
        id,
        name,
        publicRole,
        relationship: relationship
          ? { label: relationship.label, score: relationship.score }
          : null,
      };
    });
}

function assertCompleteBackgroundHistory(
  state: WorldState,
  history: readonly BackgroundStoryHistoryEntry[],
): void {
  if (history.length !== state.chapter) {
    throw new Error("Background chapter memory must cover every prior chapter");
  }
  for (const [index, entry] of history.entries()) {
    if (entry.chapter !== index + 1 || entry.delta.clock.toChapter !== entry.chapter) {
      throw new Error("Background chapter memory must be contiguous and match canonical deltas");
    }
  }
}

function compactPovSafeChapterHistory(
  state: WorldState,
  povId: string,
  history: readonly BackgroundStoryHistoryEntry[],
) {
  const context = buildPovContext(state, povId);
  const knownFacts = new Map(context.facts.map((fact) => [fact.id, fact] as const));
  return history.map(({ chapter, delta, intents }) => {
    const ownIntent = intents.find(({ actorId }) => actorId === povId);
    const rejection = ownIntent
      ? delta.rejectedIntents.find(({ intentId }) => intentId === ownIntent.id)
      : undefined;
    return {
      actorStateChanges: delta.stateMutations.filter((mutation) =>
        stateMutationVisibleToActor(mutation, povId),
      ),
      chapter,
      learnedFacts: context.facts
        .filter(({ discoveredChapter }) => discoveredChapter === chapter)
        .map(({ certainty, claim, id, source }) => [id, certainty, claim, source]),
      learnedFactChanges: delta.knowledgeMutations
        .filter(({ characterId }) => characterId === povId)
        .map((mutation) => {
          if (mutation.type === "discover_fact") {
            return [
              mutation.fact.id,
              mutation.fact.certainty,
              mutation.fact.claim,
              mutation.fact.source,
            ];
          }
          const known = knownFacts.get(mutation.factId);
          return [mutation.factId, mutation.certainty, known?.claim ?? null, mutation.source];
        }),
      observedEvents: delta.events
        .filter((event) => eventVisibleToPov(event, povId))
        .map(({ id, kind, locationId, summary }) => [id, kind, locationId, summary]),
      ownIntent: ownIntent
        ? {
            action: ownIntent.action,
            expectedEffect: ownIntent.expectedEffect,
            goal: ownIntent.goal,
            prerequisites: ownIntent.prerequisites,
            ...(rejection
              ? {
                  rejection: { code: rejection.code, reason: rejection.reason },
                  result: "rejected" as const,
                }
              : {
                  result: delta.acceptedIntentIds.includes(ownIntent.id)
                    ? ("accepted" as const)
                    : ("not-applied" as const),
                }),
          }
        : null,
    };
  });
}

function stateMutationVisibleToActor(
  mutation: PersistedTraceEnvelope["acceptedDelta"]["stateMutations"][number],
  actorId: string,
): boolean {
  if ("characterId" in mutation) return mutation.characterId === actorId;
  return (
    mutation.type === "complete_milestone" ||
    mutation.type === "end_story" ||
    mutation.type === "set_threat"
  );
}

function characterTurnAnchors(state: WorldState, povId: string) {
  const character = state.characters.find(({ id }) => id === povId);
  if (!character) throw new Error("POV character is missing");
  return {
    beliefs: character.beliefs,
    goals: character.goals,
    plan: character.plan,
    relationships: character.relationships.map(({ characterId, label, score }) => ({
      characterId,
      label,
      score,
    })),
  };
}

function compactStoryHistory(history: readonly StoryHistoryEntry[]) {
  return history.map(({ action, actionDescription, chapter, prose, title }) => ({
    action,
    actionDescription,
    chapter,
    prose,
    title,
  }));
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
  const milestone = prospective.arcClock.milestones.find(({ act }) => act === prospective.act);
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
    systemQuest: milestone
      ? {
          act: milestone.act,
          completed: milestone.completed,
          id: milestone.id,
          objective: milestone.description,
          requiredByChapter: milestone.requiredByChapter,
        }
      : null,
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
