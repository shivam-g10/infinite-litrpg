import {
  type StateMutation,
  type WorldDelta,
  WorldDeltaSchema,
  type WorldIntent,
  type WorldState,
} from "../contracts";
import { getClockPolicy } from "./clock";
import {
  actionAdvancesMilestone,
  resolveCanonicalIntentDisposition,
  resolveIntentOutcome,
  resolveTurnLevelStateMutations,
  type CanonicalIntentDisposition,
} from "./resolver";
import {
  type ValidationCode,
  type ValidationIssue,
  type ValidationResult,
  validateIntent,
  validateWorldState,
} from "./validation";

export interface StagedWorldDelta {
  readonly delta: WorldDelta;
  readonly state: WorldState;
}

export function stageWorldDelta(
  state: WorldState,
  intents: readonly WorldIntent[],
  input: unknown,
): ValidationResult<StagedWorldDelta> {
  const parsed = WorldDeltaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((entry) =>
        makeIssue("INVALID_SCHEMA", entry.message, entry.path.map(String).join(".")),
      ),
      ok: false,
    };
  }

  const delta = parsed.data;
  const issues: ValidationIssue[] = [];
  const policy = getClockPolicy(state.chapter);
  const canonicalDisposition = resolveCanonicalIntentDisposition(state, intents);
  const canonicalAccepted = canonicalDisposition?.accepted ?? [];

  if (!policy.modelCallAllowed || state.terminal) {
    issues.push(
      makeIssue("STORY_TERMINAL", "Terminal state cannot stage another delta", "chapter"),
    );
  }
  if (delta.expectedWorldVersion !== state.version) {
    issues.push(
      makeIssue(
        "STALE_WORLD_VERSION",
        `Expected world version ${delta.expectedWorldVersion}, current version is ${state.version}`,
        "expectedWorldVersion",
      ),
    );
  }
  if (delta.clock.fromChapter !== state.chapter || delta.clock.toChapter !== policy.nextChapter) {
    issues.push(
      makeIssue(
        "CHAPTER_SEQUENCE",
        `Clock must advance once from ${state.chapter} to ${String(policy.nextChapter)}`,
        "clock",
      ),
    );
  }
  if (delta.clock.fromAct !== state.act || delta.clock.toAct !== policy.postCommitAct) {
    issues.push(
      makeIssue(
        "ACT_SEQUENCE",
        `Clock act must advance from ${state.act} to ${policy.postCommitAct}`,
        "clock",
      ),
    );
  }
  if (
    delta.clock.convergencePressure !== policy.convergencePressure ||
    delta.clock.transitionRequired !== policy.transitionRequired
  ) {
    issues.push(makeIssue("CHAPTER_SEQUENCE", "Clock policy flags do not match chapter", "clock"));
  }
  const earlyTerminal = delta.clock.terminal && !policy.terminal;
  if (!delta.clock.terminal && policy.terminal) {
    issues.push(makeIssue("STORY_TERMINAL", "Chapter 350 must be terminal", "clock.terminal"));
  }
  if (
    earlyTerminal &&
    (!delta.stateMutations.some(
      (mutation) =>
        mutation.type === "end_story" &&
        sameStrings(mutation.resolvedEndingConstraints, state.endingConstraints),
    ) ||
      !canEndEarly(state, canonicalAccepted))
  ) {
    issues.push(
      makeIssue(
        "MUTATION_UNSUPPORTED",
        "Early ending must resolve every ending constraint",
        "stateMutations",
      ),
    );
  }

  validateIntentDisposition(state, intents, delta, canonicalDisposition, issues);
  validateMutationEntailment(state, canonicalAccepted, delta, issues);
  validateKnowledgeEntailment(state, canonicalAccepted, delta, issues);
  if (issues.length > 0) {
    return { issues, ok: false };
  }

  const staged = structuredClone(state);
  for (const mutation of delta.stateMutations) {
    applyStateMutation(staged, mutation, issues);
  }
  applyKnowledgeMutations(staged, delta, issues);
  applyEvents(staged, delta, issues);

  if (issues.length > 0 || policy.nextChapter === null) {
    return {
      issues:
        issues.length > 0
          ? issues
          : [makeIssue("STORY_TERMINAL", "No next chapter exists", "clock.toChapter")],
      ok: false,
    };
  }

  staged.act = policy.postCommitAct;
  staged.arcClock.convergencePressure = policy.convergencePressure;
  staged.arcClock.transitionRequired = policy.transitionRequired;
  staged.calendar.day += 1;
  staged.calendar.label = `${calendarPrefix(staged.calendar.label)} ${staged.calendar.day}`;
  staged.chapter = policy.nextChapter;
  staged.terminal = delta.clock.terminal;
  staged.terminalReason = staged.terminal
    ? (staged.terminalReason ?? "Chapter 350 terminal resolution")
    : null;
  staged.version += 1;

  const finalValidation = validateWorldState(staged);
  if (!finalValidation.ok) {
    return finalValidation;
  }

  return { data: { delta, state: finalValidation.data }, ok: true };
}

function calendarPrefix(label: string): string {
  const prefix = label.replace(/\s+\d+$/u, "").trim();
  return prefix || "Year 1";
}

function validateIntentDisposition(
  state: WorldState,
  intents: readonly WorldIntent[],
  delta: WorldDelta,
  canonical: CanonicalIntentDisposition | null,
  issues: ValidationIssue[],
): void {
  if (canonical === null) {
    issues.push(makeIssue("INTENT_UNKNOWN", "Turn lacks one canonical player intent", "intents"));
  } else {
    if (JSON.stringify(intents) !== JSON.stringify(canonical.intents)) {
      issues.push(
        makeIssue("INTENT_UNKNOWN", "Intent order must match deterministic priority", "intents"),
      );
    }
    if (
      JSON.stringify(delta.acceptedIntentIds) !==
        JSON.stringify(canonical.accepted.map(({ id }) => id)) ||
      JSON.stringify(delta.rejectedIntents) !== JSON.stringify(canonical.rejected)
    ) {
      issues.push(
        makeIssue(
          "INTENT_UNKNOWN",
          "Accepted and rejected intents must match deterministic disposition",
          "acceptedIntentIds",
        ),
      );
    }
  }
  const known = new Map(intents.map((intent) => [intent.id, intent]));
  const seen = new Set<string>();
  const accepted = new Set(delta.acceptedIntentIds);

  for (const intentId of [
    ...delta.acceptedIntentIds,
    ...delta.rejectedIntents.map(({ intentId }) => intentId),
  ]) {
    if (seen.has(intentId)) {
      issues.push(
        makeIssue(
          "DUPLICATE_INTENT_RESULT",
          `Intent ${intentId} resolved twice`,
          "acceptedIntentIds",
        ),
      );
    }
    seen.add(intentId);
    if (!known.has(intentId)) {
      issues.push(makeIssue("INTENT_UNKNOWN", `Unknown intent ${intentId}`, "acceptedIntentIds"));
    }
  }

  for (const intent of intents) {
    if (!seen.has(intent.id)) {
      issues.push(
        makeIssue("INTENT_UNKNOWN", `Intent ${intent.id} has no result`, "acceptedIntentIds"),
      );
    }
    if (accepted.has(intent.id)) {
      const intentValidation = validateIntent(state, intent);
      if (!intentValidation.ok) {
        issues.push(...intentValidation.issues);
      }
    }
  }
}

function applyStateMutation(
  state: WorldState,
  mutation: StateMutation,
  issues: ValidationIssue[],
): void {
  if (mutation.type === "set_threat") {
    state.threat = mutation.threat;
    return;
  }

  if (mutation.type === "complete_milestone") {
    const milestone = state.arcClock.milestones.find(({ id }) => id === mutation.milestoneId);
    if (!milestone) {
      issues.push(
        makeIssue(
          "MILESTONE_MISSING",
          `Missing milestone ${mutation.milestoneId}`,
          "stateMutations.milestoneId",
        ),
      );
      return;
    }
    milestone.completed = true;
    return;
  }

  if (mutation.type === "end_story") {
    state.terminalReason = mutation.reason;
    return;
  }

  const character = state.characters.find(({ id }) => id === mutation.characterId);
  if (!character) {
    issues.push(
      makeIssue(
        "CHARACTER_MISSING",
        `Mutation references missing character ${mutation.characterId}`,
        "stateMutations",
      ),
    );
    return;
  }

  switch (mutation.type) {
    case "set_location": {
      if (mutation.toLocationIds.length !== 1) {
        issues.push(
          makeIssue(
            "MULTIPLE_LOCATIONS",
            `${character.id} must end in exactly one location`,
            "stateMutations.toLocationIds",
          ),
        );
        return;
      }
      if (character.locationId !== mutation.fromLocationId) {
        issues.push(
          makeIssue(
            "LOCATION_MISMATCH",
            `${character.id} is not at ${mutation.fromLocationId}`,
            "stateMutations.fromLocationId",
          ),
        );
        return;
      }
      const destinationId = mutation.toLocationIds[0];
      if (!destinationId || !state.locations.some(({ id }) => id === destinationId)) {
        issues.push(
          makeIssue(
            "LOCATION_MISSING",
            `Missing destination ${String(destinationId)}`,
            "stateMutations.toLocationIds",
          ),
        );
        return;
      }
      character.locationId = destinationId;
      return;
    }
    case "adjust_inventory": {
      let item = character.inventory.find(({ itemId }) => itemId === mutation.itemId);
      if (!item && mutation.quantityDelta > 0) {
        item = {
          equipped: false,
          itemId: mutation.itemId,
          name: mutation.name,
          quantity: 0,
          unique: mutation.unique,
        };
        character.inventory.push(item);
      }
      if (!item) {
        issues.push(
          makeIssue(
            "ITEM_MISSING",
            `${character.id} lacks ${mutation.itemId}`,
            "stateMutations.itemId",
          ),
        );
        return;
      }
      const quantity = item.quantity + mutation.quantityDelta;
      if (quantity < 0) {
        issues.push(
          makeIssue(
            "INVENTORY_NEGATIVE",
            `${mutation.itemId} would fall below zero`,
            "stateMutations.quantityDelta",
          ),
        );
        return;
      }
      if ((item.unique || mutation.unique) && quantity > 1) {
        issues.push(
          makeIssue(
            "DUPLICATE_UNIQUE_ITEM",
            `${mutation.itemId} would duplicate a unique item`,
            "stateMutations.quantityDelta",
          ),
        );
        return;
      }
      item.quantity = quantity;
      return;
    }
    case "adjust_resource": {
      const pool = character[mutation.resource];
      const current = pool.current + mutation.delta;
      if (current < 0 || current > pool.maximum) {
        issues.push(
          makeIssue(
            "RESOURCE_OUT_OF_RANGE",
            `${mutation.resource} would become ${current}`,
            "stateMutations.delta",
          ),
        );
        return;
      }
      pool.current = current;
      return;
    }
    case "grant_experience": {
      character.experience += mutation.amount;
      while (character.level < 100 && character.experience >= character.level * 100) {
        character.experience -= character.level * 100;
        character.level += 1;
      }
      return;
    }
    case "learn_skill": {
      const hasPrerequisites = mutation.skill.prerequisiteSkillIds.every((id) =>
        character.skills.some((skill) => skill.id === id),
      );
      if (
        character.skills.some(({ id }) => id === mutation.skill.id) ||
        mutation.skill.minimumLevel > character.level ||
        mutation.skill.requiredClassId !== character.characterClassId ||
        !hasPrerequisites
      ) {
        issues.push(
          makeIssue(
            "ILLEGAL_PROGRESSION",
            `${character.id} cannot learn ${mutation.skill.id}`,
            "stateMutations.skill",
          ),
        );
        return;
      }
      character.skills.push(mutation.skill);
      return;
    }
    case "set_status": {
      character.status = mutation.status;
      return;
    }
    case "set_relationship": {
      if (!state.characters.some(({ id }) => id === mutation.targetCharacterId)) {
        issues.push(
          makeIssue(
            "RELATIONSHIP_TARGET_MISSING",
            `Missing relationship target ${mutation.targetCharacterId}`,
            "stateMutations.targetCharacterId",
          ),
        );
        return;
      }
      const relationship = character.relationships.find(
        ({ characterId }) => characterId === mutation.targetCharacterId,
      );
      if (relationship) {
        relationship.label = mutation.label;
        relationship.score = mutation.score;
      } else {
        character.relationships.push({
          characterId: mutation.targetCharacterId,
          label: mutation.label,
          score: mutation.score,
        });
      }
      return;
    }
  }
}

function applyKnowledgeMutations(
  state: WorldState,
  delta: WorldDelta,
  issues: ValidationIssue[],
): void {
  for (const mutation of delta.knowledgeMutations) {
    const ledger = state.knowledgeLedgers.find(
      ({ characterId }) => characterId === mutation.characterId,
    );
    if (!ledger) {
      issues.push(
        makeIssue(
          "LEDGER_MISSING",
          `Missing ledger ${mutation.characterId}`,
          "knowledgeMutations.characterId",
        ),
      );
      continue;
    }
    const discoveredChapter =
      mutation.type === "discover_fact"
        ? mutation.fact.discoveredChapter
        : mutation.discoveredChapter;
    if (discoveredChapter !== delta.clock.toChapter) {
      issues.push(
        makeIssue(
          "KNOWLEDGE_CHAPTER",
          `Knowledge must be discovered in chapter ${delta.clock.toChapter}`,
          "knowledgeMutations.discoveredChapter",
        ),
      );
      continue;
    }

    const fact =
      mutation.type === "discover_fact"
        ? mutation.fact
        : state.facts.find(({ id }) => id === mutation.factId);
    if (!fact) {
      const missingFactId =
        mutation.type === "learn_existing_fact" ? mutation.factId : mutation.fact.id;
      issues.push(
        makeIssue("FACT_MISSING", `Missing fact ${missingFactId}`, "knowledgeMutations.factId"),
      );
      continue;
    }
    const existingFact = state.facts.find(({ id }) => id === fact.id);
    if (mutation.type === "discover_fact" && existingFact) {
      issues.push(
        makeIssue(
          "KNOWLEDGE_FACT_CONFLICT",
          `Fact ${fact.id} already exists in canon`,
          "knowledgeMutations.fact",
        ),
      );
      continue;
    }
    if (!existingFact) {
      state.facts.push(fact);
    }
    if (!ledger.entries.some(({ factId }) => factId === fact.id)) {
      ledger.entries.push({
        certainty: mutation.type === "discover_fact" ? fact.certainty : mutation.certainty,
        discoveredChapter,
        factId: fact.id,
        source: mutation.type === "discover_fact" ? fact.source : mutation.source,
      });
    }
  }

  for (const factId of delta.surfacedClueFactIds) {
    if (!state.facts.some(({ id }) => id === factId)) {
      issues.push(
        makeIssue(
          "FACT_MISSING",
          `Surfaced clue references missing fact ${factId}`,
          "surfacedClueFactIds",
        ),
      );
    }
  }
}

function validateMutationEntailment(
  state: WorldState,
  accepted: readonly WorldIntent[],
  delta: WorldDelta,
  issues: ValidationIssue[],
): void {
  const acceptedActors = new Set<string>();
  const turnLevelMutations = resolveTurnLevelStateMutations(state, accepted);
  for (const intent of accepted) {
    if (acceptedActors.has(intent.actorId)) {
      issues.push(
        makeIssue(
          "DUPLICATE_INTENT_RESULT",
          `Actor ${intent.actorId} has multiple accepted intents`,
          "acceptedIntentIds",
        ),
      );
    }
    acceptedActors.add(intent.actorId);
  }
  for (const mutation of delta.stateMutations) {
    if (mutation.type === "set_location") {
      if (mutation.toLocationIds.length !== 1) {
        issues.push(
          makeIssue(
            "MULTIPLE_LOCATIONS",
            `${mutation.characterId} must end in exactly one location`,
            "stateMutations.toLocationIds",
          ),
        );
        continue;
      }
      const destinationId = mutation.toLocationIds[0];
      const supported = accepted.some(
        (intent) =>
          intent.actorId === mutation.characterId &&
          intent.action.type === "move" &&
          intent.action.destinationId === destinationId &&
          mutation.toLocationIds.length === 1,
      );
      if (!supported) {
        issues.push(
          makeIssue(
            "MUTATION_UNSUPPORTED",
            `No accepted move supports ${mutation.characterId}'s location mutation`,
            "stateMutations",
          ),
        );
      }
    }
    if (mutation.type === "adjust_inventory") {
      const supported =
        mutation.quantityDelta < 0 &&
        accepted.some(
          (intent) =>
            intent.actorId === mutation.characterId &&
            intent.action.type === "use_item" &&
            intent.action.itemId === mutation.itemId &&
            intent.action.quantity === -mutation.quantityDelta,
        );
      if (!supported) {
        issues.push(
          makeIssue(
            "MUTATION_UNSUPPORTED",
            "Inventory spend lacks an accepted item intent",
            "stateMutations",
          ),
        );
      }
    }
    if (mutation.type === "adjust_resource") {
      const supported =
        mutation.resource === "mana" &&
        mutation.delta < 0 &&
        accepted.some((intent) => {
          if (intent.actorId !== mutation.characterId || intent.action.type !== "use_skill") {
            return false;
          }
          const action = intent.action;
          const actor = state.characters.find(({ id }) => id === intent.actorId);
          const skill = actor?.skills.find(({ id }) => id === action.skillId);
          return skill !== undefined && skill.manaCost === -mutation.delta;
        });
      if (!supported) {
        issues.push(
          makeIssue(
            "MUTATION_UNSUPPORTED",
            "Mana spend lacks an accepted skill intent",
            "stateMutations",
          ),
        );
      }
    }
    if (mutation.type === "complete_milestone") {
      const milestone = state.arcClock.milestones.find(({ id }) => id === mutation.milestoneId);
      const policy = getClockPolicy(state.chapter);
      const supportingIntent = accepted.find(
        (intent) =>
          intent.id.startsWith("intent-player-") &&
          milestone !== undefined &&
          actionAdvancesMilestone(intent.action, milestone),
      );
      if (
        !policy.choicesRequireMilestone ||
        milestone?.act !== delta.clock.fromAct ||
        milestone.completed ||
        !supportingIntent
      ) {
        issues.push(
          makeIssue(
            "MUTATION_UNSUPPORTED",
            `Milestone ${mutation.milestoneId} cannot complete outside its transition`,
            "stateMutations",
          ),
        );
      }
    }
    if (mutation.type === "end_story") {
      if (
        !delta.clock.terminal ||
        !sameStrings(mutation.resolvedEndingConstraints, state.endingConstraints)
      ) {
        issues.push(
          makeIssue(
            "MUTATION_UNSUPPORTED",
            "Ending mutation must resolve the canonical ending constraints",
            "stateMutations",
          ),
        );
      }
    }
    if (mutation.type === "grant_experience") {
      const supported = turnLevelMutations.some(
        (expected) =>
          expected.type === "grant_experience" &&
          JSON.stringify(expected) === JSON.stringify(mutation),
      );
      if (!supported) {
        issues.push(
          makeIssue(
            "MUTATION_UNSUPPORTED",
            "Experience grant lacks the deterministic player-action rule",
            "stateMutations",
          ),
        );
      }
    }
    if (mutation.type === "set_relationship") {
      const supported = accepted.some((intent, index) =>
        resolveIntentOutcome(state, intent, delta.clock.toChapter, index, accepted).mutations.some(
          (expected) => JSON.stringify(expected) === JSON.stringify(mutation),
        ),
      );
      if (!supported) {
        issues.push(
          makeIssue(
            "MUTATION_UNSUPPORTED",
            "Relationship change lacks an accepted local interaction or defense",
            "stateMutations",
          ),
        );
      }
    }
    if (
      mutation.type === "learn_skill" ||
      mutation.type === "set_status" ||
      mutation.type === "set_threat"
    ) {
      issues.push(
        makeIssue(
          "MUTATION_UNSUPPORTED",
          `Mutation ${mutation.type} has no deterministic rule`,
          "stateMutations",
        ),
      );
    }
  }

  const expectedStateMutations = accepted.flatMap(
    (intent, index) =>
      resolveIntentOutcome(state, intent, delta.clock.toChapter, index, accepted).mutations,
  );
  expectedStateMutations.push(...turnLevelMutations);
  if (JSON.stringify(delta.stateMutations) !== JSON.stringify(expectedStateMutations)) {
    issues.push(
      makeIssue(
        "MUTATION_UNSUPPORTED",
        "State mutations must exactly match deterministic turn resolution",
        "stateMutations",
      ),
    );
  }

  if (delta.events.length !== accepted.length) {
    issues.push(
      makeIssue("EVENT_MISSING", "Resolved event count must equal accepted intent count", "events"),
    );
  }
  accepted.forEach((intent, index) => {
    const expectedEvent = resolveIntentOutcome(
      state,
      intent,
      delta.clock.toChapter,
      index,
      accepted,
    ).event;
    const actualEvent = delta.events[index];
    if (!actualEvent || JSON.stringify(actualEvent) !== JSON.stringify(expectedEvent)) {
      issues.push(
        makeIssue(
          "EVENT_MISSING",
          `Accepted intent ${intent.id} lacks its exact canonical event`,
          "events",
        ),
      );
    }

    if (!hasRequiredMutation(state, intent, delta, index, accepted)) {
      issues.push(
        makeIssue(
          "MUTATION_MISSING",
          `Accepted intent ${intent.id} lacks its required state mutation`,
          "stateMutations",
        ),
      );
    }
    if (intent.id.startsWith("intent-player-")) {
      const expectedExperience = turnLevelMutations.find(
        (mutation) =>
          mutation.type === "grant_experience" && mutation.characterId === intent.actorId,
      );
      const actualExperience = delta.stateMutations.filter(
        (mutation) =>
          mutation.type === "grant_experience" && mutation.characterId === intent.actorId,
      );
      const hasExactExperienceResult =
        expectedExperience === undefined
          ? actualExperience.length === 0
          : actualExperience.length === 1 &&
            JSON.stringify(actualExperience[0]) === JSON.stringify(expectedExperience);
      if (!hasExactExperienceResult) {
        issues.push(
          makeIssue(
            "MUTATION_MISSING",
            `Player intent ${intent.id} lacks its exact experience result`,
            "stateMutations",
          ),
        );
      }
    }
  });
}

function validateKnowledgeEntailment(
  state: WorldState,
  accepted: readonly WorldIntent[],
  delta: WorldDelta,
  issues: ValidationIssue[],
): void {
  const expectedOutcomes = accepted.map((intent, index) =>
    resolveIntentOutcome(state, intent, delta.clock.toChapter, index, accepted),
  );
  const expectedMutations = expectedOutcomes.flatMap(
    ({ knowledgeMutations }) => knowledgeMutations,
  );
  const expectedClues = expectedOutcomes.flatMap(({ surfacedClueFactIds }) => surfacedClueFactIds);
  if (JSON.stringify(delta.knowledgeMutations) !== JSON.stringify(expectedMutations)) {
    issues.push(
      makeIssue(
        "MUTATION_UNSUPPORTED",
        "Knowledge mutations must exactly match deterministic investigations",
        "knowledgeMutations",
      ),
    );
  }
  if (JSON.stringify(delta.surfacedClueFactIds) !== JSON.stringify(expectedClues)) {
    issues.push(
      makeIssue(
        "MUTATION_UNSUPPORTED",
        "Surfaced clues must exactly match deterministic investigations",
        "surfacedClueFactIds",
      ),
    );
  }
  const seen = new Set<string>();
  for (const mutation of delta.knowledgeMutations) {
    const factId = mutation.type === "discover_fact" ? mutation.fact.id : mutation.factId;
    const key = `${mutation.characterId}:${factId}`;
    if (seen.has(key)) {
      issues.push(
        makeIssue("DUPLICATE_FACT", `Duplicate knowledge mutation ${key}`, "knowledgeMutations"),
      );
    }
    seen.add(key);
    if (!delta.surfacedClueFactIds.includes(factId)) {
      issues.push(
        makeIssue(
          "MUTATION_UNSUPPORTED",
          `Knowledge fact ${factId} was not surfaced by the resolved turn`,
          "knowledgeMutations",
        ),
      );
    }
    const witnessed = delta.events.some(
      (event) =>
        event.participantIds.includes(mutation.characterId) ||
        event.observerIds.includes(mutation.characterId),
    );
    if (!witnessed) {
      issues.push(
        makeIssue(
          "MUTATION_UNSUPPORTED",
          `${mutation.characterId} did not witness the fact-bearing turn`,
          "knowledgeMutations",
        ),
      );
    }
  }
}

function hasRequiredMutation(
  state: WorldState,
  intent: WorldIntent,
  delta: WorldDelta,
  ordinal: number,
  accepted: readonly WorldIntent[],
): boolean {
  const expected = resolveIntentOutcome(
    state,
    intent,
    delta.clock.toChapter,
    ordinal,
    accepted,
  ).mutations;
  return expected.every(
    (wanted) =>
      delta.stateMutations.filter((actual) => JSON.stringify(actual) === JSON.stringify(wanted))
        .length === 1,
  );
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function canEndEarly(state: WorldState, accepted: readonly WorldIntent[]): boolean {
  if (
    state.act !== 7 ||
    state.chapter < 301 ||
    !state.arcClock.milestones.every(({ completed }) => completed)
  ) {
    return false;
  }
  const finaleMilestone = state.arcClock.milestones.find(({ act }) => act === 7);
  return accepted.some(
    (intent) =>
      intent.id.startsWith("intent-player-") &&
      finaleMilestone !== undefined &&
      actionAdvancesMilestone(intent.action, finaleMilestone),
  );
}

function applyEvents(state: WorldState, delta: WorldDelta, issues: ValidationIssue[]): void {
  const eventIds = new Set(state.activeEvents.map(({ id }) => id));
  for (const event of delta.events) {
    if (eventIds.has(event.id)) {
      issues.push(makeIssue("DUPLICATE_EVENT", `Duplicate event ${event.id}`, "events.id"));
      continue;
    }
    if (!state.locations.some(({ id }) => id === event.locationId)) {
      issues.push(
        makeIssue(
          "LOCATION_MISSING",
          `Event location ${event.locationId} is missing`,
          "events.locationId",
        ),
      );
      continue;
    }
    if (
      [...event.participantIds, ...event.observerIds].some(
        (characterId) => !state.characters.some(({ id }) => id === characterId),
      )
    ) {
      issues.push(
        makeIssue(
          "CHARACTER_MISSING",
          `Event ${event.id} references a missing character`,
          "events",
        ),
      );
      continue;
    }
    state.activeEvents.push({
      id: event.id,
      locationId: event.locationId,
      observerIds: event.observerIds,
      participantIds: event.participantIds,
      summary: event.summary,
      visibility: event.visibility,
    });
    eventIds.add(event.id);
  }
  if (state.activeEvents.length > 50) {
    state.activeEvents.splice(0, state.activeEvents.length - 50);
  }
}

function makeIssue(code: ValidationCode, message: string, path: string): ValidationIssue {
  return { code, message, path };
}
