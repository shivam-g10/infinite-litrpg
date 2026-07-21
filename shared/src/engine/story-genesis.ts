import {
  CONTRACT_VERSION,
  FIXTURE_VERSION,
  StoryGenesisCandidateV1Schema,
  StorySetupSchema,
  type CharacterState,
  type IntentAction,
  type StoryGenesisCandidateV1,
  type StorySetup,
  type WorldState,
} from "../contracts";
import { GENERATED_PROTAGONIST_ID } from "../characters";
import { validateWorldState } from "./validation";
import { resolveTurn } from "./resolver";

const ACTOR_IDS = {
  protagonist: GENERATED_PROTAGONIST_ID,
  general: "actor-general",
  hero: "actor-hero",
  prince: "actor-prince",
  rival: "actor-rival",
  saint: "actor-saint",
} as const;

export class StoryGenesisCompileError extends Error {
  readonly code: "GENESIS_GUIDANCE_UNSATISFIED" | "GENESIS_INVALID";
  constructor(
    message: string,
    code: StoryGenesisCompileError["code"] = message === "GENESIS_GUIDANCE_UNSATISFIED"
      ? "GENESIS_GUIDANCE_UNSATISFIED"
      : "GENESIS_INVALID",
  ) {
    super(
      code === "GENESIS_GUIDANCE_UNSATISFIED" && !message.includes(code)
        ? `${code}: ${message}`
        : message,
    );
    this.name = "StoryGenesisCompileError";
    this.code = code;
  }
}

export interface CompiledStoryGenesis {
  readonly openingAction: IntentAction;
  readonly openingActionDescription: string;
  readonly world: WorldState;
}

export function compileStoryGenesis(
  setupInput: StorySetup,
  candidateInput: StoryGenesisCandidateV1,
): CompiledStoryGenesis {
  const setup = StorySetupSchema.parse(setupInput);
  const parsedCandidate = StoryGenesisCandidateV1Schema.parse(candidateInput);
  assertRawLocationReferences(parsedCandidate);
  const candidate = normalizeStoryGenesisCandidate(parsedCandidate);
  assertCandidateIntegrity(setup, candidate);

  const locationIds = new Map(
    candidate.locations.map(({ key }, index) => [key, `location-${index + 1}`]),
  );
  const factionIds = new Map(
    candidate.factions.map(({ key }, index) => [key, `faction-${index + 1}`]),
  );
  const skillIds = new Map(candidate.skills.map(({ key }, index) => [key, `skill-${index + 1}`]));
  const protagonistItemIds = new Map(
    candidate.protagonist.inventory.map(({ key }, index) => [key, `item-${index + 1}`]),
  );
  const supportingIds = new Map(
    candidate.supportingCharacters.map(({ role }) => [role, ACTOR_IDS[role]]),
  );
  const characterKeyIds = new Map<string, string>([
    ["protagonist", ACTOR_IDS.protagonist],
    ...candidate.supportingCharacters.map(({ role }) => [role, ACTOR_IDS[role]] as const),
  ]);
  const factIds = new Map(
    candidate.discoverableFacts.map(({ key }, index) => [key, `fact-${index + 2}`]),
  );
  const openingLocationId = required(
    locationIds,
    candidate.opening.locationKey,
    "opening location",
  );

  const protagonistName = setup.protagonistName ?? candidate.protagonist.generatedName;
  const protagonist = makeCharacter({
    beliefs: candidate.protagonist.beliefs,
    className: candidate.protagonist.className,
    factionId:
      candidate.factions.length > 0
        ? required(factionIds, candidate.factions[0]!.key, "protagonist faction")
        : "faction-1",
    goals: candidate.protagonist.goals,
    id: ACTOR_IDS.protagonist,
    inventory: candidate.protagonist.inventory.map(({ key, ...item }) => ({
      ...item,
      itemId: required(protagonistItemIds, key, "item"),
    })),
    locationId: openingLocationId,
    name: protagonistName,
    plan: candidate.protagonist.plan,
    publicRole: candidate.protagonist.publicRole,
    relationships: candidate.supportingCharacters.map(({ relationship, role }) => ({
      characterId: ACTOR_IDS[role],
      ...relationship,
    })),
    role: "protagonist",
    setup,
    skills: candidate.skills.map(({ key, ...skill }) => ({
      ...skill,
      id: required(skillIds, key, "skill"),
    })),
  });

  const characters: CharacterState[] = [
    protagonist,
    ...candidate.supportingCharacters.map((character, characterIndex) => {
      const inventoryIds = new Map(
        character.inventory.map(({ key }, itemIndex) => [
          key,
          `item-${characterIndex + 2}-${itemIndex + 1}`,
        ]),
      );
      return makeCharacter({
        beliefs: character.beliefs,
        className: character.className,
        factionId: required(factionIds, character.factionKey, `${character.role} faction`),
        goals: character.goals,
        id: required(supportingIds, character.role, "supporting actor"),
        inventory: character.inventory.map(({ key, ...item }) => ({
          ...item,
          itemId: required(inventoryIds, key, "item"),
        })),
        locationId: required(locationIds, character.locationKey, `${character.role} location`),
        name: character.name,
        plan: character.plan,
        publicRole: character.publicRole,
        relationships: [{ characterId: ACTOR_IDS.protagonist, ...character.relationship }],
        role: character.role,
        setup,
        skills: [],
      });
    }),
  ];

  const originFact = {
    certainty: "certain" as const,
    claim: `${protagonistName} is ${candidate.protagonist.pastLifeName} reincarnated after ${setup.rebirthCause}, with ${setup.memory} memories.`,
    discoveredChapter: 0,
    id: "fact-1",
    ownerCharacterId: ACTOR_IDS.protagonist,
    source: "Reincarnation origin",
    visibility: "private" as const,
  };
  const facts = [
    originFact,
    ...candidate.discoverableFacts.map((fact) => ({
      certainty: fact.certainty,
      claim: fact.claim,
      discoveredChapter: 0,
      discovery: {
        actionTypes: fact.actionTypes,
        subjectIds: fact.subjectKeys.map(
          (key) => locationIds.get(key) ?? factionIds.get(key) ?? characterKeyIds.get(key) ?? key,
        ),
      },
      id: required(factIds, fact.key, "fact"),
      ownerCharacterId: fact.ownerRole === null ? null : ACTOR_IDS[fact.ownerRole],
      source: fact.source,
      visibility: fact.visibility,
    })),
  ];

  const publicFactIds = facts
    .filter(({ visibility }) => visibility === "public")
    .map(({ id }) => id);
  const world: WorldState = {
    act: 1,
    activeEvents: [
      {
        id: "opening-event",
        locationId: openingLocationId,
        observerIds: characters
          .filter(({ locationId }) => locationId === openingLocationId)
          .map(({ id }) => id),
        participantIds: [ACTOR_IDS.protagonist],
        summary: truncateShortText(
          `${candidate.opening.incident} Pressure: ${candidate.opening.pressure}`,
        ),
        visibility: "public",
      },
    ],
    arcClock: {
      convergencePressure: false,
      milestones: candidate.milestones.map((milestone, index) => ({
        act: (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7,
        compatibleActionTypes: milestone.compatibleActionTypes,
        completed: false,
        description: milestone.description,
        id: `milestone-${index + 1}`,
        requiredByChapter: (index + 1) * 50,
      })),
      transitionRequired: false,
    },
    calendar: { day: 1, label: candidate.calendarName },
    chapter: 0,
    characters,
    contractVersion: CONTRACT_VERSION,
    endingConstraints: candidate.endingConstraints,
    factions: candidate.factions.map((faction) => ({
      id: required(factionIds, faction.key, "faction"),
      name: faction.name,
      publicGoal: faction.publicGoal,
    })),
    facts,
    fixtureVersion: FIXTURE_VERSION,
    id: "ashen-crown-v1",
    knowledgeLedgers: characters.map(({ id }) => ({
      characterId: id,
      entries: [...publicFactIds, ...(id === ACTOR_IDS.protagonist ? [originFact.id] : [])].map(
        (factId) => ({
          certainty: facts.find((fact) => fact.id === factId)!.certainty,
          discoveredChapter: 0,
          factId,
          source: facts.find((fact) => fact.id === factId)!.source,
        }),
      ),
    })),
    locations: candidate.locations.map((location) => ({
      adjacentLocationIds: location.adjacentKeys.map((key) =>
        required(locationIds, key, "adjacent location"),
      ),
      id: required(locationIds, location.key, "location"),
      name: location.name,
      publicDescription: location.description,
    })),
    lockedPovId: ACTOR_IDS.protagonist,
    origin: { genesisVersion: "1.0.0", kind: "generated" },
    system: candidate.system,
    terminal: false,
    terminalReason: null,
    threat: candidate.threat,
    version: 1,
  };
  const validated = validateWorldState(world);
  if (!validated.ok) throw new StoryGenesisCompileError(JSON.stringify(validated.issues));
  const openingAction = compileAction(candidate.opening.action, {
    characterKeyIds,
    factionIds,
    locationIds,
    protagonistItemIds,
    skillIds,
  });
  const openingResolution = resolveTurn(
    validated.data,
    {
      action: openingAction,
      actorId: ACTOR_IDS.protagonist,
      description: candidate.opening.actionDescription,
      milestoneId: null,
      source: "suggested",
      stateVersion: validated.data.version,
    },
    [],
  );
  if (!openingResolution.ok) {
    throw new StoryGenesisCompileError(
      `Opening action is not legal in the compiled world: ${openingResolution.issues
        .map(({ code, message }) => `${code}: ${message}`)
        .join("; ")}`,
    );
  }
  return {
    openingAction,
    openingActionDescription: candidate.opening.actionDescription,
    world: validated.data,
  };
}

function assertRawLocationReferences(candidate: StoryGenesisCandidateV1): void {
  const locationKeys = new Set(candidate.locations.map(({ key }) => key));
  for (const location of candidate.locations) {
    for (const adjacentKey of location.adjacentKeys) {
      if (adjacentKey === location.key) {
        throw new StoryGenesisCompileError("Locations cannot connect to themselves");
      }
      if (!locationKeys.has(adjacentKey)) {
        throw new StoryGenesisCompileError(
          `Location ${location.key} references missing adjacent location ${adjacentKey}`,
        );
      }
    }
  }
}

function assertCandidateIntegrity(setup: StorySetup, candidate: StoryGenesisCandidateV1): void {
  const locationKeys = new Set(candidate.locations.map(({ key }) => key));
  const factionKeys = new Set(candidate.factions.map(({ key }) => key));
  const actorKeys = new Set([
    "protagonist",
    ...candidate.supportingCharacters.map(({ role }) => role),
  ]);
  const subjectKeys = new Set([...locationKeys, ...factionKeys, ...actorKeys]);
  if (!locationKeys.has(candidate.opening.locationKey))
    throw new StoryGenesisCompileError("Opening location is missing");
  for (const location of candidate.locations) {
    if (location.adjacentKeys.includes(location.key))
      throw new StoryGenesisCompileError("Locations cannot connect to themselves");
    for (const adjacent of location.adjacentKeys) {
      const other = candidate.locations.find(({ key }) => key === adjacent);
      if (!other || !other.adjacentKeys.includes(location.key))
        throw new StoryGenesisCompileError("Location graph must be connected and symmetric");
    }
  }
  const visited = new Set<string>();
  const queue = [candidate.locations[0]!.key];
  while (queue.length > 0) {
    const key = queue.shift()!;
    if (visited.has(key)) continue;
    visited.add(key);
    queue.push(...candidate.locations.find((location) => location.key === key)!.adjacentKeys);
  }
  if (visited.size !== candidate.locations.length)
    throw new StoryGenesisCompileError("Location graph is disconnected");
  for (const character of candidate.supportingCharacters) {
    if (!locationKeys.has(character.locationKey) || !factionKeys.has(character.factionKey))
      throw new StoryGenesisCompileError("Supporting character reference is missing");
    assertEquipment(character.inventory);
  }
  for (const fact of candidate.discoverableFacts) {
    const duplicateSubjects = [
      ...new Set(fact.subjectKeys.filter((key, index) => fact.subjectKeys.indexOf(key) !== index)),
    ];
    const invalidSubjects = fact.subjectKeys.filter((key) => !subjectKeys.has(key));
    if (duplicateSubjects.length > 0 || invalidSubjects.length > 0) {
      throw new StoryGenesisCompileError(
        `Discoverable fact ${fact.key} has invalid subjects [${invalidSubjects.join(", ") || "none"}] and duplicate subjects [${duplicateSubjects.join(", ") || "none"}]. Valid subjects are protagonist, general, hero, prince, rival, saint, or an exact generated location or faction key.`,
      );
    }
  }
  for (const values of [
    candidate.locations.map(({ name }) => name.toLocaleLowerCase("en")),
    candidate.factions.map(({ name }) => name.toLocaleLowerCase("en")),
  ]) {
    if (new Set(values).size !== values.length)
      throw new StoryGenesisCompileError("Generated names must be unique");
  }
  assertEquipment(candidate.protagonist.inventory);
  if (setup.startingLife === "birth" && candidate.protagonist.inventory.length > 0)
    throw new StoryGenesisCompileError("Newborn inventory must be empty");
  assertOpeningAction(candidate, locationKeys, factionKeys, actorKeys);
  const requirements = deriveGuidanceRequirements(setup.guidance);
  if (requirements.length > 0) {
    const coverageById = new Map(
      candidate.guidanceCoverage.map((coverage) => [coverage.requirementId, coverage]),
    );
    const problems = requirements.flatMap((requirement) => {
      const coverage = coverageById.get(requirement.id);
      if (!coverage) return [`${requirement.id}: missing coverage`];
      const invalidPaths = coverage.canonPaths.filter(
        (path) => resolveCanonPath(candidate, path) === undefined,
      );
      return invalidPaths.map((path) => `${requirement.id}: invalid path ${path}`);
    });
    if (problems.length > 0) {
      throw new StoryGenesisCompileError(
        `Guidance coverage does not resolve to canon: ${problems.join("; ")}`,
        "GENESIS_GUIDANCE_UNSATISFIED",
      );
    }
  }
}

export function normalizeStoryGenesisCandidate(
  candidate: StoryGenesisCandidateV1,
): StoryGenesisCandidateV1 {
  const normalized = structuredClone(candidate);
  normalized.protagonist.generatedName = trimNamePunctuation(normalized.protagonist.generatedName);
  normalized.protagonist.pastLifeName = trimNamePunctuation(normalized.protagonist.pastLifeName);
  for (const character of normalized.supportingCharacters) {
    character.name = trimNamePunctuation(character.name);
  }
  const locationKeys = new Set(normalized.locations.map(({ key }) => key));
  const locationByKey = new Map(normalized.locations.map((location) => [location.key, location]));
  for (const location of normalized.locations) {
    location.adjacentKeys = [
      ...new Set(
        location.adjacentKeys.filter(
          (adjacentKey) => adjacentKey !== location.key && locationKeys.has(adjacentKey),
        ),
      ),
    ];
  }
  for (const location of normalized.locations) {
    for (const adjacentKey of location.adjacentKeys) {
      const adjacent = locationByKey.get(adjacentKey)!;
      if (!adjacent.adjacentKeys.includes(location.key)) {
        adjacent.adjacentKeys.push(location.key);
      }
    }
  }
  const roles = new Set<string>(["general", "hero", "prince", "rival", "saint"]);
  for (const fact of normalized.discoverableFacts) {
    fact.subjectKeys = [
      ...new Set(
        fact.subjectKeys.map((key) => {
          const rolePrefix = key.split("-")[0]!;
          return roles.has(rolePrefix) ? rolePrefix : key;
        }),
      ),
    ];
  }
  for (const inventory of [
    normalized.protagonist.inventory,
    ...normalized.supportingCharacters.map(({ inventory }) => inventory),
  ]) {
    for (const item of inventory) {
      if (item.unique) item.quantity = 1;
    }
  }
  const action = normalized.opening.action;
  if (action.type === "investigate" && locationKeys.has(action.subjectKey)) {
    normalized.opening.locationKey = action.subjectKey;
  } else if (action.type === "defend" && locationKeys.has(action.targetKey)) {
    normalized.opening.locationKey = action.targetKey;
  } else if (action.type === "rally") {
    normalized.opening.locationKey = action.locationKey;
  } else if (action.type === "interact") {
    const target = normalized.supportingCharacters.find(({ role }) => role === action.targetKey);
    if (target) normalized.opening.locationKey = target.locationKey;
  }
  if (normalized.skills.some(({ manaCost }) => manaCost > 0)) {
    normalized.system.rules = [
      "The System displays a finite mana pool and deducts each skill's listed mana cost on use.",
      "Mana recovers through eight hours of rest or a completed System oath.",
      "At zero mana, skills cannot activate; forced activation causes a lasting health penalty.",
      ...normalized.system.rules.slice(0, 5),
    ].slice(0, 8);
  }
  return normalized;
}

function assertOpeningAction(
  candidate: StoryGenesisCandidateV1,
  locationKeys: ReadonlySet<string>,
  factionKeys: ReadonlySet<string>,
  actorKeys: ReadonlySet<string>,
): void {
  const action = candidate.opening.action;
  switch (action.type) {
    case "move": {
      const opening = candidate.locations.find(({ key }) => key === candidate.opening.locationKey)!;
      if (!opening.adjacentKeys.includes(action.destinationKey))
        throw new StoryGenesisCompileError("Opening move is not adjacent");
      return;
    }
    case "use_item": {
      const item = candidate.protagonist.inventory.find(({ key }) => key === action.itemKey);
      if (!item || item.quantity < action.quantity)
        throw new StoryGenesisCompileError("Opening item is not owned");
      return;
    }
    case "use_skill":
      if (
        !candidate.skills.some(({ key }) => key === action.skillKey) ||
        (action.targetKey !== null &&
          !actorKeys.has(action.targetKey) &&
          !locationKeys.has(action.targetKey))
      )
        throw new StoryGenesisCompileError("Opening skill reference is invalid");
      return;
    case "investigate":
      if (
        !locationKeys.has(action.subjectKey) &&
        !factionKeys.has(action.subjectKey) &&
        !actorKeys.has(action.subjectKey)
      )
        throw new StoryGenesisCompileError("Opening investigation subject is invalid");
      return;
    case "interact":
      if (!actorKeys.has(action.targetKey) || action.targetKey === "protagonist")
        throw new StoryGenesisCompileError("Opening interaction target is invalid");
      return;
    case "defend":
      if (!locationKeys.has(action.targetKey) && !actorKeys.has(action.targetKey))
        throw new StoryGenesisCompileError("Opening defense target is invalid");
      return;
    case "rally":
      if (!factionKeys.has(action.factionKey) || !locationKeys.has(action.locationKey))
        throw new StoryGenesisCompileError("Opening rally reference is invalid");
      return;
    case "wait":
      return;
  }
}

function isStyleGuidance(guidance: string): boolean {
  return /\b(?:style|tone|prose|narration|voice|pacing|write|written)\b/iu.test(guidance);
}

export interface StoryGuidanceRequirement {
  readonly id: string;
  readonly text: string;
}

export function deriveGuidanceRequirements(guidance: string): StoryGuidanceRequirement[] {
  return guidance
    .trim()
    .split(/\n+|(?<=[.!?])\s+/u)
    .map((text) => text.trim())
    .filter((text) => text.length > 0 && !isStyleGuidance(text))
    .slice(0, 12)
    .map((text, index) => ({ id: `guidance-${index + 1}`, text }));
}

function resolveCanonPath(value: unknown, path: string): unknown {
  let current = value;
  const normalizedPath = path.replace(/\[(\d+)\]/gu, ".$1");
  for (const segment of normalizedPath.split(".").filter(Boolean)) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function assertEquipment(inventory: readonly { equipped: boolean; key: string }[]): void {
  const keys = new Set<string>();
  for (const item of inventory) {
    if (keys.has(item.key))
      throw new StoryGenesisCompileError("Inventory item keys must be unique");
    keys.add(item.key);
  }
}

function makeCharacter(input: {
  beliefs: readonly string[];
  className: string;
  factionId: string;
  goals: readonly string[];
  id: string;
  inventory: readonly {
    equipped: boolean;
    itemId: string;
    name: string;
    quantity: number;
    unique: boolean;
  }[];
  locationId: string;
  name: string;
  plan: readonly string[];
  publicRole: string;
  relationships: readonly { characterId: string; label: string; score: number }[];
  role: string;
  setup: StorySetup;
  skills: readonly { id: string; manaCost: number; name: string }[];
}): CharacterState {
  const young = input.setup.startingLife === "birth" || input.setup.startingLife === "child";
  const powerful = input.setup.powerPath === "overpowered";
  const maximum = young ? (input.setup.startingLife === "birth" ? 8 : 20) : powerful ? 180 : 60;
  return {
    beliefs: [...input.beliefs],
    characterClassId: `${input.id}-class`,
    characterClassName: input.className,
    conditions: [],
    equipmentItemIds: input.inventory
      .filter(({ equipped }) => equipped)
      .map(({ itemId }) => itemId),
    experience: powerful ? 2_500 : 0,
    factionId: input.factionId,
    gender: input.role === "protagonist" ? input.setup.protagonistGender : null,
    goals: [...input.goals],
    health: { current: maximum, maximum },
    id: input.id,
    inventory: input.inventory.map(({ itemId, ...item }) => ({ itemId, ...item })),
    level: powerful ? 25 : 1,
    locationId: input.locationId,
    mana: { current: powerful ? 160 : 40, maximum: powerful ? 160 : 40 },
    name: input.name,
    plan: [...input.plan],
    publicRole: input.publicRole,
    relationships: [...input.relationships],
    role: input.role,
    secretFactIds: input.id === ACTOR_IDS.protagonist ? ["fact-1"] : [],
    skills: input.skills.map((skill) => ({
      ...skill,
      minimumLevel: 1,
      prerequisiteSkillIds: [],
      rank: 1,
      requiredClassId: `${input.id}-class`,
    })),
    stats: powerful
      ? { agility: 35, intellect: 45, strength: 38, vitality: 40, willpower: 52 }
      : young
        ? { agility: 2, intellect: 8, strength: 2, vitality: 3, willpower: 10 }
        : { agility: 8, intellect: 10, strength: 8, vitality: 9, willpower: 12 },
    status: "alive",
  };
}

function compileAction(
  action: StoryGenesisCandidateV1["opening"]["action"],
  maps: {
    characterKeyIds: Map<string, string>;
    factionIds: Map<string, string>;
    locationIds: Map<string, string>;
    protagonistItemIds: Map<string, string>;
    skillIds: Map<string, string>;
  },
): IntentAction {
  switch (action.type) {
    case "move":
      return {
        destinationId: required(maps.locationIds, action.destinationKey, "opening destination"),
        type: "move",
      };
    case "use_item":
      return {
        itemId: required(maps.protagonistItemIds, action.itemKey, "opening item"),
        quantity: action.quantity,
        targetId: null,
        type: "use_item",
      };
    case "use_skill":
      return {
        skillId: required(maps.skillIds, action.skillKey, "opening skill"),
        targetId:
          action.targetKey === null
            ? null
            : (maps.characterKeyIds.get(action.targetKey) ??
              maps.locationIds.get(action.targetKey) ??
              action.targetKey),
        type: "use_skill",
      };
    case "investigate":
      return {
        subjectId:
          maps.characterKeyIds.get(action.subjectKey) ??
          maps.locationIds.get(action.subjectKey) ??
          maps.factionIds.get(action.subjectKey) ??
          action.subjectKey,
        type: "investigate",
      };
    case "interact":
      return {
        approach: action.approach,
        targetId: required(maps.characterKeyIds, action.targetKey, "opening target"),
        type: "interact",
      };
    case "defend":
      return {
        targetId:
          maps.characterKeyIds.get(action.targetKey) ??
          maps.locationIds.get(action.targetKey) ??
          action.targetKey,
        type: "defend",
      };
    case "rally":
      return {
        factionId: required(maps.factionIds, action.factionKey, "opening faction"),
        locationId: required(maps.locationIds, action.locationKey, "opening rally location"),
        type: "rally",
      };
    case "wait":
      return { type: "wait" };
  }
}

function required(map: ReadonlyMap<string, string>, key: string, label: string): string {
  const value = map.get(key);
  if (!value) throw new StoryGenesisCompileError(`Missing ${label}: ${key}`);
  return value;
}

function truncateShortText(value: string): string {
  return value.length <= 240 ? value : `${value.slice(0, 237).trimEnd()}...`;
}

function trimNamePunctuation(value: string): string {
  const trimmed = value.replace(/[.!?]+$/u, "").trimEnd();
  return trimmed.length > 0 ? trimmed : value;
}
