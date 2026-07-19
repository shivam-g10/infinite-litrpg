import type { z } from "zod";

import { CHARACTER_IDS } from "../characters";
import {
  type CharacterState,
  type WorldIntent,
  WorldIntentSchema,
  type WorldState,
  WorldStateSchema,
} from "../contracts";
import { actForStateChapter, getClockPolicy } from "./clock";

export const VALIDATION_CODES = [
  "ACT_SEQUENCE",
  "ASYMMETRIC_ADJACENCY",
  "CHARACTER_DEAD",
  "CHARACTER_MISSING",
  "CHAPTER_SEQUENCE",
  "CHOICES_NOT_DISTINCT",
  "DUPLICATE_INTENT_RESULT",
  "DUPLICATE_MILESTONE",
  "DUPLICATE_CHARACTER",
  "DUPLICATE_EVENT",
  "DUPLICATE_FACT",
  "DUPLICATE_FACTION",
  "DUPLICATE_ITEM",
  "DUPLICATE_LEDGER",
  "DUPLICATE_LOCATION",
  "DUPLICATE_UNIQUE_ITEM",
  "EQUIPMENT_MISSING",
  "EVENT_MISSING",
  "FACTION_MISSING",
  "FACT_MISSING",
  "FACT_FUTURE",
  "ILLEGAL_ACT",
  "ILLEGAL_PROGRESSION",
  "INVENTORY_NEGATIVE",
  "INVALID_SCHEMA",
  "ITEM_MISSING",
  "INTENT_UNKNOWN",
  "KNOWLEDGE_CHAPTER",
  "KNOWLEDGE_FACT_CONFLICT",
  "KNOWLEDGE_MISSING",
  "LEDGER_MISSING",
  "LOCATION_MISSING",
  "LOCATION_MISMATCH",
  "LOCATION_NOT_ADJACENT",
  "MANA_INSUFFICIENT",
  "MILESTONE_ACTION_DEADLOCK",
  "MILESTONE_DEADLINE",
  "MILESTONE_MISSING",
  "MILESTONE_REQUIRED",
  "MULTIPLE_LOCATIONS",
  "MUTATION_UNSUPPORTED",
  "MUTATION_MISSING",
  "POV_MISMATCH",
  "POV_LEAK",
  "POV_NOT_LOCKED",
  "RELATIONSHIP_TARGET_MISSING",
  "RESOURCE_OUT_OF_RANGE",
  "SKILL_LOCKED",
  "STALE_WORLD_VERSION",
  "STORY_TERMINAL",
  "TARGET_MISSING",
] as const;

export type ValidationCode = (typeof VALIDATION_CODES)[number];

export interface ValidationIssue {
  readonly code: ValidationCode;
  readonly message: string;
  readonly path: string;
}

export type ValidationResult<T> =
  | { readonly data: T; readonly ok: true }
  | { readonly issues: readonly ValidationIssue[]; readonly ok: false };

export function validateWorldState(input: unknown): ValidationResult<WorldState> {
  const parsed = WorldStateSchema.safeParse(input);
  if (!parsed.success) {
    return schemaFailure(parsed.error);
  }

  const state = parsed.data;
  const issues: ValidationIssue[] = [];
  const characterIds = new Set<string>();
  const locationIds = new Set<string>();
  const ledgerIds = new Set<string>();
  const factIds = new Set<string>();
  const factionIds = new Set<string>();
  const ownedUniqueItemIds = new Set<string>();

  for (const location of state.locations) {
    if (locationIds.has(location.id)) {
      issues.push(issue("DUPLICATE_LOCATION", `Duplicate location ${location.id}`, "locations"));
    }
    locationIds.add(location.id);
  }

  for (const location of state.locations) {
    for (const adjacentId of location.adjacentLocationIds) {
      const adjacent = state.locations.find(({ id }) => id === adjacentId);
      if (!adjacent) {
        issues.push(
          issue(
            "LOCATION_MISSING",
            `${location.id} references missing adjacent location ${adjacentId}`,
            "locations.adjacentLocationIds",
          ),
        );
      } else if (!adjacent.adjacentLocationIds.includes(location.id)) {
        issues.push(
          issue(
            "ASYMMETRIC_ADJACENCY",
            `${location.id} and ${adjacentId} are not mutually adjacent`,
            "locations.adjacentLocationIds",
          ),
        );
      }
    }
  }

  for (const faction of state.factions) {
    if (factionIds.has(faction.id)) {
      issues.push(issue("DUPLICATE_FACTION", `Duplicate faction ${faction.id}`, "factions"));
    }
    factionIds.add(faction.id);
  }

  for (const fact of state.facts) {
    if (factIds.has(fact.id)) {
      issues.push(issue("DUPLICATE_FACT", `Duplicate fact ${fact.id}`, "facts"));
    }
    factIds.add(fact.id);
    if (fact.discoveredChapter > state.chapter) {
      issues.push(issue("FACT_FUTURE", `Fact ${fact.id} comes from a future chapter`, "facts"));
    }
  }

  for (const character of state.characters) {
    if (characterIds.has(character.id)) {
      issues.push(
        issue("DUPLICATE_CHARACTER", `Duplicate character ${character.id}`, "characters"),
      );
    }
    characterIds.add(character.id);
  }

  for (const fact of state.facts) {
    if (fact.ownerCharacterId !== null && !characterIds.has(fact.ownerCharacterId)) {
      issues.push(
        issue("CHARACTER_MISSING", `Fact ${fact.id} has a missing owner`, "facts.ownerCharacterId"),
      );
    }
  }

  for (const character of state.characters) {
    validateCharacter(
      character,
      locationIds,
      factionIds,
      characterIds,
      state.facts,
      ownedUniqueItemIds,
      issues,
    );
  }

  for (const expectedId of CHARACTER_IDS) {
    if (!characterIds.has(expectedId)) {
      issues.push(
        issue("CHARACTER_MISSING", `Missing required character ${expectedId}`, "characters"),
      );
    }
  }

  if (state.lockedPovId !== null && !characterIds.has(state.lockedPovId)) {
    issues.push(
      issue("CHARACTER_MISSING", `Missing locked POV ${state.lockedPovId}`, "lockedPovId"),
    );
  }

  const eventIds = new Set<string>();
  for (const event of state.activeEvents) {
    if (eventIds.has(event.id)) {
      issues.push(issue("DUPLICATE_EVENT", `Duplicate event ${event.id}`, "activeEvents"));
    }
    eventIds.add(event.id);
    if (!locationIds.has(event.locationId)) {
      issues.push(
        issue(
          "LOCATION_MISSING",
          `Event ${event.id} has missing location`,
          "activeEvents.locationId",
        ),
      );
    }
    for (const characterId of [...event.participantIds, ...event.observerIds]) {
      if (!characterIds.has(characterId)) {
        issues.push(
          issue("CHARACTER_MISSING", `Event ${event.id} has missing witness`, "activeEvents"),
        );
      }
    }
  }

  for (const ledger of state.knowledgeLedgers) {
    if (!characterIds.has(ledger.characterId)) {
      issues.push(
        issue(
          "CHARACTER_MISSING",
          `Ledger references missing character ${ledger.characterId}`,
          "knowledgeLedgers.characterId",
        ),
      );
    }
    if (ledgerIds.has(ledger.characterId)) {
      issues.push(
        issue("DUPLICATE_LEDGER", `Duplicate ledger ${ledger.characterId}`, "knowledgeLedgers"),
      );
    }
    ledgerIds.add(ledger.characterId);

    const seenEntries = new Set<string>();
    for (const entry of ledger.entries) {
      if (!factIds.has(entry.factId)) {
        issues.push(
          issue(
            "FACT_MISSING",
            `Ledger ${ledger.characterId} references missing fact ${entry.factId}`,
            "knowledgeLedgers",
          ),
        );
      }
      const fact = state.facts.find(({ id }) => id === entry.factId);
      if (
        entry.discoveredChapter > state.chapter ||
        (fact !== undefined && entry.discoveredChapter < fact.discoveredChapter)
      ) {
        issues.push(
          issue(
            "KNOWLEDGE_CHAPTER",
            `Ledger discovery chapter is invalid for ${entry.factId}`,
            "knowledgeLedgers.entries.discoveredChapter",
          ),
        );
      }
      if (seenEntries.has(entry.factId)) {
        issues.push(
          issue(
            "DUPLICATE_FACT",
            `Ledger ${ledger.characterId} repeats fact ${entry.factId}`,
            "knowledgeLedgers",
          ),
        );
      }
      seenEntries.add(entry.factId);
    }
  }

  for (const expectedId of CHARACTER_IDS) {
    if (!ledgerIds.has(expectedId)) {
      issues.push(issue("LEDGER_MISSING", `Missing ledger ${expectedId}`, "knowledgeLedgers"));
    }
  }

  const expectedAct = actForStateChapter(state.chapter);
  if (state.act !== expectedAct) {
    issues.push(
      issue(
        "ILLEGAL_ACT",
        `Chapter ${state.chapter} requires state act ${expectedAct}, received ${state.act}`,
        "act",
      ),
    );
  }

  if (state.chapter === 350 && !state.terminal) {
    issues.push(issue("STORY_TERMINAL", "Chapter 350 must be terminal", "terminal"));
  }
  const milestoneActs = new Set<number>();
  const milestoneIds = new Set<string>();
  for (const milestone of state.arcClock.milestones) {
    if (milestoneIds.has(milestone.id)) {
      issues.push(
        issue("DUPLICATE_MILESTONE", `Duplicate milestone ${milestone.id}`, "arcClock.milestones"),
      );
    }
    milestoneIds.add(milestone.id);
    milestoneActs.add(milestone.act);
    const directTargetActionTypes = new Set(
      milestone.compatibleActionTypes.filter((type) =>
        ["investigate", "interact", "defend", "use_item", "use_skill"].includes(type),
      ),
    );
    if (directTargetActionTypes.size < 2) {
      issues.push(
        issue(
          "MILESTONE_ACTION_DEADLOCK",
          `Milestone ${milestone.id} needs two directly targetable action types`,
          "arcClock.milestones.compatibleActionTypes",
        ),
      );
    }
    if (state.chapter >= milestone.requiredByChapter && !milestone.completed) {
      issues.push(
        issue(
          "MILESTONE_DEADLINE",
          `Milestone ${milestone.id} is incomplete after chapter ${milestone.requiredByChapter}`,
          "arcClock.milestones",
        ),
      );
    }
  }
  for (let act = 1; act <= 7; act += 1) {
    if (!milestoneActs.has(act)) {
      issues.push(
        issue("MILESTONE_MISSING", `Act ${act} lacks a milestone`, "arcClock.milestones"),
      );
    }
  }
  if (state.terminal !== (state.terminalReason !== null)) {
    issues.push(
      issue("STORY_TERMINAL", "Terminal state and terminal reason disagree", "terminalReason"),
    );
  }

  return issues.length === 0 ? { data: state, ok: true } : { issues, ok: false };
}

export function validateIntent(state: WorldState, input: unknown): ValidationResult<WorldIntent> {
  const parsed = WorldIntentSchema.safeParse(input);
  if (!parsed.success) {
    return schemaFailure(parsed.error);
  }

  const intent = parsed.data;
  const actor = state.characters.find(({ id }) => id === intent.actorId);
  const issues: ValidationIssue[] = [];

  if (state.terminal || state.chapter === 350) {
    issues.push(issue("STORY_TERMINAL", "Terminal stories cannot accept intents", "state.chapter"));
  }
  if (intent.stateVersion !== state.version) {
    issues.push(
      issue(
        "STALE_WORLD_VERSION",
        `Intent version ${intent.stateVersion} does not match ${state.version}`,
        "stateVersion",
      ),
    );
  }
  if (!actor) {
    issues.push(issue("CHARACTER_MISSING", `Missing actor ${intent.actorId}`, "actorId"));
    return { issues, ok: false };
  }
  if (actor.status === "dead" || actor.status === "terminal") {
    issues.push(issue("CHARACTER_DEAD", `${actor.id} cannot act while ${actor.status}`, "actorId"));
  }

  validateKnowledgePrerequisites(state, actor, intent, issues);
  validateInventoryPrerequisites(actor, intent, issues);
  validateSkillPrerequisites(actor, intent, issues);
  validateIntentAction(state, actor, intent, issues);

  return issues.length === 0 ? { data: intent, ok: true } : { issues, ok: false };
}

function validateCharacter(
  character: CharacterState,
  locationIds: ReadonlySet<string>,
  factionIds: ReadonlySet<string>,
  characterIds: ReadonlySet<string>,
  facts: WorldState["facts"],
  ownedUniqueItemIds: Set<string>,
  issues: ValidationIssue[],
): void {
  if (!locationIds.has(character.locationId)) {
    issues.push(
      issue(
        "LOCATION_MISSING",
        `${character.id} references missing location ${character.locationId}`,
        "characters.locationId",
      ),
    );
  }
  if (!factionIds.has(character.factionId)) {
    issues.push(
      issue(
        "FACTION_MISSING",
        `${character.id} references missing faction ${character.factionId}`,
        "characters.factionId",
      ),
    );
  }
  for (const relationship of character.relationships) {
    if (!characterIds.has(relationship.characterId)) {
      issues.push(
        issue(
          "RELATIONSHIP_TARGET_MISSING",
          `${character.id} references missing relationship ${relationship.characterId}`,
          "characters.relationships",
        ),
      );
    }
  }
  for (const factId of character.secretFactIds) {
    const fact = facts.find(({ id }) => id === factId);
    if (!fact) {
      issues.push(
        issue(
          "FACT_MISSING",
          `${character.id} references missing secret ${factId}`,
          "characters.secretFactIds",
        ),
      );
    } else if (fact.ownerCharacterId !== character.id) {
      issues.push(
        issue(
          "KNOWLEDGE_FACT_CONFLICT",
          `Secret ${factId} is not owned by ${character.id}`,
          "characters.secretFactIds",
        ),
      );
    }
  }

  const skillIds = new Set<string>();
  for (const skill of character.skills) {
    if (skillIds.has(skill.id)) {
      issues.push(
        issue(
          "ILLEGAL_PROGRESSION",
          `${character.id} repeats skill ${skill.id}`,
          "characters.skills",
        ),
      );
    }
    skillIds.add(skill.id);
  }
  for (const skill of character.skills) {
    for (const prerequisiteId of skill.prerequisiteSkillIds) {
      if (!skillIds.has(prerequisiteId)) {
        issues.push(
          issue(
            "ILLEGAL_PROGRESSION",
            `${skill.id} references missing prerequisite ${prerequisiteId}`,
            "characters.skills.prerequisiteSkillIds",
          ),
        );
      }
    }
  }

  const itemIds = new Set<string>();
  const equippedIds = new Set(character.equipmentItemIds);
  for (const item of character.inventory) {
    if (item.quantity < 0) {
      issues.push(
        issue("INVENTORY_NEGATIVE", `${item.itemId} is negative`, "characters.inventory"),
      );
    }
    if (item.unique && item.quantity > 1) {
      issues.push(
        issue(
          "DUPLICATE_UNIQUE_ITEM",
          `${item.itemId} has quantity ${item.quantity}`,
          "characters.inventory",
        ),
      );
    }
    if (item.unique && item.quantity > 0) {
      if (ownedUniqueItemIds.has(item.itemId)) {
        issues.push(
          issue(
            "DUPLICATE_UNIQUE_ITEM",
            `Unique item ${item.itemId} has multiple owners`,
            "characters.inventory",
          ),
        );
      }
      ownedUniqueItemIds.add(item.itemId);
    }
    if (itemIds.has(item.itemId)) {
      issues.push(
        issue("DUPLICATE_ITEM", `Duplicate item stack ${item.itemId}`, "characters.inventory"),
      );
    }
    itemIds.add(item.itemId);
    if (item.equipped !== equippedIds.has(item.itemId)) {
      issues.push(
        issue(
          "EQUIPMENT_MISSING",
          `${character.id} equipment flags disagree for ${item.itemId}`,
          "characters.inventory.equipped",
        ),
      );
    }
  }

  for (const equippedId of character.equipmentItemIds) {
    const item = character.inventory.find(({ itemId }) => itemId === equippedId);
    if (!itemIds.has(equippedId) || !item || item.quantity < 1) {
      issues.push(
        issue(
          "EQUIPMENT_MISSING",
          `${character.id} equips missing item ${equippedId}`,
          "characters.equipmentItemIds",
        ),
      );
    }
  }
}

function validateKnowledgePrerequisites(
  state: WorldState,
  actor: CharacterState,
  intent: WorldIntent,
  issues: ValidationIssue[],
): void {
  const ledger = state.knowledgeLedgers.find(({ characterId }) => characterId === actor.id);
  const knownFacts = new Set(ledger?.entries.map(({ factId }) => factId) ?? []);
  for (const fact of state.facts) {
    if (fact.visibility === "public") {
      knownFacts.add(fact.id);
    }
  }

  for (const requiredFactId of intent.prerequisites.requiredFactIds) {
    if (!knownFacts.has(requiredFactId)) {
      issues.push(
        issue(
          "KNOWLEDGE_MISSING",
          `${actor.id} lacks fact ${requiredFactId}`,
          "prerequisites.requiredFactIds",
        ),
      );
    }
  }

  for (const referencedId of actionReferenceIds(intent)) {
    if (state.facts.some(({ id }) => id === referencedId) && !knownFacts.has(referencedId)) {
      issues.push(
        issue(
          "KNOWLEDGE_MISSING",
          `${actor.id} cannot reference unknown fact ${referencedId}`,
          "action",
        ),
      );
    }
  }
}

function actionReferenceIds(intent: WorldIntent): string[] {
  switch (intent.action.type) {
    case "investigate":
      return [intent.action.subjectId];
    case "interact":
    case "defend":
      return [intent.action.targetId];
    case "use_item":
    case "use_skill":
      return intent.action.targetId === null ? [] : [intent.action.targetId];
    default:
      return [];
  }
}

function validateInventoryPrerequisites(
  actor: CharacterState,
  intent: WorldIntent,
  issues: ValidationIssue[],
): void {
  const inventory = new Map(actor.inventory.map((item) => [item.itemId, item]));
  for (const itemId of intent.prerequisites.requiredItemIds) {
    if ((inventory.get(itemId)?.quantity ?? 0) < 1) {
      issues.push(
        issue("ITEM_MISSING", `${actor.id} lacks item ${itemId}`, "prerequisites.requiredItemIds"),
      );
    }
  }

  if (intent.action.type === "use_item") {
    const item = inventory.get(intent.action.itemId);
    if (!item || item.quantity < intent.action.quantity) {
      issues.push(
        issue("ITEM_MISSING", `${actor.id} cannot spend ${intent.action.itemId}`, "action.itemId"),
      );
    }
  }
}

function validateSkillPrerequisites(
  actor: CharacterState,
  intent: WorldIntent,
  issues: ValidationIssue[],
): void {
  const skills = new Map(actor.skills.map((skill) => [skill.id, skill]));
  for (const skillId of intent.prerequisites.requiredSkillIds) {
    if (!skills.has(skillId)) {
      issues.push(
        issue(
          "SKILL_LOCKED",
          `${actor.id} lacks skill ${skillId}`,
          "prerequisites.requiredSkillIds",
        ),
      );
    }
  }

  if (intent.action.type !== "use_skill") {
    return;
  }

  const skill = skills.get(intent.action.skillId);
  const unlocked =
    skill !== undefined &&
    actor.level >= skill.minimumLevel &&
    actor.characterClassId === skill.requiredClassId &&
    skill.prerequisiteSkillIds.every((prerequisiteId) => skills.has(prerequisiteId));

  if (!unlocked) {
    issues.push(
      issue("SKILL_LOCKED", `${actor.id} cannot use ${intent.action.skillId}`, "action.skillId"),
    );
    return;
  }
  if (actor.mana.current < skill.manaCost) {
    issues.push(
      issue("MANA_INSUFFICIENT", `${actor.id} lacks mana for ${skill.id}`, "action.skillId"),
    );
  }
}

function validateIntentAction(
  state: WorldState,
  actor: CharacterState,
  intent: WorldIntent,
  issues: ValidationIssue[],
): void {
  const policy = getClockPolicy(state.chapter);
  const milestone =
    policy.choicesRequireMilestone && actor.id === state.lockedPovId
      ? state.arcClock.milestones.find(({ act }) => act === policy.currentAct)
      : undefined;
  const milestoneTargetId = milestone?.compatibleActionTypes.includes(intent.action.type)
    ? milestone.id
    : undefined;
  if (intent.action.type !== "move") {
    if (intent.action.type === "investigate") {
      const subjectId = intent.action.subjectId;
      const ledger = state.knowledgeLedgers.find(({ characterId }) => characterId === actor.id);
      const knownFactIds = new Set(ledger?.entries.map(({ factId }) => factId) ?? []);
      for (const fact of state.facts) {
        if (fact.visibility === "public") knownFactIds.add(fact.id);
      }
      const visibleEvent = state.activeEvents.some(
        (event) =>
          event.id === subjectId &&
          event.locationId === actor.locationId &&
          (event.visibility === "public" ||
            event.participantIds.includes(actor.id) ||
            event.observerIds.includes(actor.id)),
      );
      const allowed =
        subjectId === actor.locationId ||
        visibleEvent ||
        knownFactIds.has(subjectId) ||
        subjectId === milestoneTargetId;
      if (!allowed) {
        const remoteLocation = state.locations.some(({ id }) => id === subjectId);
        issues.push(
          issue(
            remoteLocation ? "LOCATION_MISMATCH" : "TARGET_MISSING",
            `${actor.id} cannot investigate ${subjectId} from visible local canon`,
            "action.subjectId",
          ),
        );
      }
    } else if (intent.action.type === "interact") {
      const action = intent.action;
      if (action.targetId === milestoneTargetId) return;
      const target = state.characters.find(({ id }) => id === action.targetId);
      if (!target || target.id === actor.id) {
        issues.push(
          issue(
            "TARGET_MISSING",
            `Interaction target ${action.targetId} does not exist`,
            "action.targetId",
          ),
        );
      } else if (target.locationId !== actor.locationId) {
        issues.push(
          issue(
            "LOCATION_MISMATCH",
            `${actor.id} cannot interact with remote target ${target.id}`,
            "action.targetId",
          ),
        );
      }
    } else if (intent.action.type === "defend") {
      const action = intent.action;
      const target = state.characters.find(({ id }) => id === action.targetId);
      const visibleEvent = state.activeEvents.some(
        (event) =>
          event.id === action.targetId &&
          event.locationId === actor.locationId &&
          (event.visibility === "public" ||
            event.participantIds.includes(actor.id) ||
            event.observerIds.includes(actor.id)),
      );
      const allowed =
        action.targetId === actor.locationId ||
        action.targetId === actor.factionId ||
        action.targetId === milestoneTargetId ||
        visibleEvent ||
        target?.locationId === actor.locationId;
      if (!allowed) {
        issues.push(
          issue(
            target ? "LOCATION_MISMATCH" : "TARGET_MISSING",
            `${actor.id} cannot defend ${action.targetId} from visible local canon`,
            "action.targetId",
          ),
        );
      }
    } else if (
      (intent.action.type === "use_item" || intent.action.type === "use_skill") &&
      intent.action.targetId !== null
    ) {
      const action = intent.action;
      if (action.targetId === milestoneTargetId) return;
      const target = state.characters.find(({ id }) => id === action.targetId);
      if (!target) {
        issues.push(
          issue(
            "TARGET_MISSING",
            `Action target ${action.targetId} does not exist`,
            "action.targetId",
          ),
        );
      } else if (target.locationId !== actor.locationId) {
        issues.push(
          issue(
            "LOCATION_MISMATCH",
            `${actor.id} cannot target remote character ${target.id}`,
            "action.targetId",
          ),
        );
      }
    } else if (intent.action.type === "rally") {
      const action = intent.action;
      if (!state.locations.some(({ id }) => id === action.locationId)) {
        issues.push(
          issue(
            "LOCATION_MISSING",
            `Rally location ${intent.action.locationId} does not exist`,
            "action.locationId",
          ),
        );
      } else if (intent.action.locationId !== actor.locationId) {
        issues.push(
          issue(
            "LOCATION_MISMATCH",
            `${actor.id} cannot rally at ${intent.action.locationId} from ${actor.locationId}`,
            "action.locationId",
          ),
        );
      }
      if (!state.factions.some(({ id }) => id === action.factionId)) {
        issues.push(
          issue(
            "FACTION_MISSING",
            `Faction ${intent.action.factionId} does not exist`,
            "action.factionId",
          ),
        );
      }
    }
    return;
  }

  const destinationId = intent.action.destinationId;
  const currentLocation = state.locations.find(({ id }) => id === actor.locationId);
  const destination = state.locations.find(({ id }) => id === destinationId);
  if (!destination) {
    issues.push(
      issue(
        "LOCATION_MISSING",
        `Destination ${destinationId} does not exist`,
        "action.destinationId",
      ),
    );
    return;
  }
  if (!currentLocation?.adjacentLocationIds.includes(destination.id)) {
    issues.push(
      issue(
        "LOCATION_NOT_ADJACENT",
        `${destination.id} is not adjacent to ${actor.locationId}`,
        "action.destinationId",
      ),
    );
  }
}

function schemaFailure(error: z.ZodError): ValidationResult<never> {
  return {
    issues: error.issues.map((entry) =>
      issue("INVALID_SCHEMA", entry.message, entry.path.map(String).join(".")),
    ),
    ok: false,
  };
}

function issue(code: ValidationCode, message: string, path: string): ValidationIssue {
  return { code, message, path };
}
