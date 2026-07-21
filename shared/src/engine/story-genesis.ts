import { StorySetupSchema, type StorySetup, type WorldState, WorldStateSchema } from "../contracts";

const POV_ID = "rowan-ashborn";
const ORIGIN_FACT_ID = "rowan-is-malachar-reincarnated";
const CAST_IDS = {
  general: "varek-thorn",
  hero: "elara-voss",
  prince: "lucan-aurelis",
  rival: "nyra-vale",
  saint: "maelin-rook",
} as const;

const LIFE_LABELS: Readonly<Record<StorySetup["startingLife"], string>> = {
  adult: "adult body",
  birth: "newborn body",
  child: "eight-year-old body",
  teen: "seventeen-year-old body",
};

const CAUSE_LABELS: Readonly<Record<StorySetup["rebirthCause"], string>> = {
  accident: "an accident",
  betrayal: "a trusted betrayal",
  execution: "an execution",
  "ritual-failure": "a failed ritual",
  sacrifice: "a deliberate sacrifice",
};

const MEMORY_LABELS: Readonly<Record<StorySetup["memory"], string>> = {
  fragments: "fragmented memories",
  full: "full memories",
  sealed: "sealed memories",
};

const PERSONALITY_BELIEFS: Readonly<Record<StorySetup["personalityTraits"][number], string>> = {
  ambitious: "A second life should be used to claim something greater",
  curious: "Every System rule hides a useful exception",
  pragmatic: "Survival comes before pride",
  protective: "Power matters only when it protects someone",
  ruthless: "Mercy cannot become permission for another betrayal",
  warm: "A second life is worth sharing with people who choose to stay",
};

const BACKGROUND_GOALS: Readonly<Record<StorySetup["backgrounds"][number], string>> = {
  "former-ruler": "Understand what remains of the old Demon King's realm",
  "hidden-heir": "Learn why the new body was hidden from the succession",
  orphan: "Discover who abandoned the new body and why",
  outcast: "Earn safety beyond the settlement's suspicion",
};

/** Applies only durable protagonist facts. Genre and free-text guidance remain prompt preferences. */
export function applyStorySetup(seed: WorldState, input: StorySetup): WorldState {
  const setup = StorySetupSchema.parse(input);
  const next = structuredClone(seed);
  const protagonist = next.characters.find(({ id }) => id === POV_ID);
  const fact = next.facts.find(({ id }) => id === ORIGIN_FACT_ID);
  const ledger = next.knowledgeLedgers.find(({ characterId }) => characterId === POV_ID);
  if (!protagonist || !fact || !ledger) {
    throw new Error("Reincarnation seed is missing Rowan origin canon");
  }

  const life = LIFE_LABELS[setup.startingLife];
  const cause = CAUSE_LABELS[setup.rebirthCause];
  const memory = MEMORY_LABELS[setup.memory];
  renameCast(next, setup);
  fact.claim = `${setup.cast.protagonist} is Demon King ${setup.cast.pastLife} reincarnated in a ${setup.protagonistGender} ${life} after ${cause}, with ${memory}.`;
  fact.source = `Reincarnation after ${cause}`;
  const originEntry = ledger.entries.find(({ factId }) => factId === fact.id);
  if (originEntry) originEntry.source = fact.source;

  protagonist.publicRole = `Demon King reincarnated in a ${setup.protagonistGender} ${life}`;
  protagonist.beliefs = setup.personalityTraits.map((trait) => PERSONALITY_BELIEFS[trait]);
  protagonist.goals = [
    "Survive the first day of reincarnation",
    ...setup.backgrounds.map((background) => BACKGROUND_GOALS[background]),
  ];
  protagonist.plan = openingPlan(setup);

  if (setup.startingLife === "birth" || setup.startingLife === "child") {
    protagonist.equipmentItemIds = [];
    protagonist.inventory = protagonist.inventory.map((stack) => ({ ...stack, equipped: false }));
    protagonist.health =
      setup.startingLife === "birth" ? { current: 8, maximum: 8 } : { current: 20, maximum: 20 };
    protagonist.stats =
      setup.startingLife === "birth"
        ? { agility: 1, intellect: 10, strength: 1, vitality: 2, willpower: 12 }
        : { agility: 4, intellect: 10, strength: 3, vitality: 5, willpower: 12 };
  }

  if (setup.powerPath === "overpowered") {
    protagonist.level = Math.max(protagonist.level, 25);
    protagonist.experience = Math.max(protagonist.experience, 2_500);
    protagonist.health = { current: Math.max(protagonist.health.current, 180), maximum: 180 };
    protagonist.mana = { current: Math.max(protagonist.mana.current, 160), maximum: 160 };
    protagonist.stats = {
      agility: Math.max(protagonist.stats.agility, 35),
      intellect: Math.max(protagonist.stats.intellect, 45),
      strength: Math.max(protagonist.stats.strength, 38),
      vitality: Math.max(protagonist.stats.vitality, 40),
      willpower: Math.max(protagonist.stats.willpower, 52),
    };
  }

  applyWorldFlavor(next, setup);

  return WorldStateSchema.parse(next);
}

function applyWorldFlavor(world: WorldState, setup: StorySetup): void {
  const flavor = setup.world;
  const ids = new Map<string, string>([
    ["ashbound", slugifyId(flavor.protagonistClassName)],
    ["ember-sense", slugifyId(flavor.primarySkillName)],
    ["sovereigns-echo", slugifyId(flavor.secondarySkillName)],
    ["cinder-village", "origin-settlement"],
    ["ash-road", "frontier-road"],
    ["cinder-survivors", "settlement-survivors"],
    ["ashen-legion", "old-legion"],
    ["cinder-raid-aftermath", "opening-raid-aftermath"],
    ["cinder-village-raided", "origin-settlement-raided"],
  ]);
  const mapId = (id: string): string => ids.get(id) ?? id;
  const substitutions = [
    ["Ash-raiders", flavor.raiderName],
    ["ash-raiders", flavor.raiderName.toLocaleLowerCase("en")],
    ["ash-raider", singular(flavor.raiderName).toLocaleLowerCase("en")],
    ["Ashen Crown", flavor.crownName],
    ["Ashen Legion", flavor.legionName],
    ["Cinder Survivors", `${flavor.settlementName} Survivors`],
    ["Cinder survivor", `${flavor.settlementName} survivor`],
    ["Cinder Village", flavor.settlementName],
    ["Ash Road", flavor.roadName],
    ["ash trail", "raider trail"],
    ["Ashfall", flavor.calendarName],
    ["System", flavor.systemName],
  ] as const;
  const replace = (value: string): string =>
    substitutions.reduce((next, [before, after]) => next.replaceAll(before, after), value);

  for (const character of world.characters) {
    character.characterClassId = mapId(character.characterClassId);
    character.characterClassName = replace(character.characterClassName);
    character.factionId = mapId(character.factionId);
    character.locationId = mapId(character.locationId);
    character.secretFactIds = character.secretFactIds.map(mapId);
    character.beliefs = character.beliefs.map(replace);
    character.goals = character.goals.map(replace);
    character.plan = character.plan.map(replace);
    character.publicRole = replace(character.publicRole);
    for (const skill of character.skills) {
      skill.id = mapId(skill.id);
      skill.name = replace(skill.name);
      skill.prerequisiteSkillIds = skill.prerequisiteSkillIds.map(mapId);
      skill.requiredClassId = mapId(skill.requiredClassId);
    }
  }
  const protagonist = world.characters.find(({ id }) => id === POV_ID);
  if (protagonist) {
    protagonist.characterClassName = flavor.protagonistClassName;
    protagonist.skills = protagonist.skills.map((skill, index) => ({
      ...skill,
      name: index === 0 ? flavor.primarySkillName : flavor.secondarySkillName,
    }));
  }

  for (const event of world.activeEvents) {
    event.id = mapId(event.id);
    event.locationId = mapId(event.locationId);
    event.summary = replace(event.summary);
  }
  for (const faction of world.factions) {
    faction.id = mapId(faction.id);
    faction.name = replace(faction.name);
    faction.publicGoal = replace(faction.publicGoal);
  }
  for (const fact of world.facts) {
    fact.id = mapId(fact.id);
    fact.claim = replace(fact.claim);
    fact.source = replace(fact.source);
  }
  for (const ledger of world.knowledgeLedgers) {
    for (const entry of ledger.entries) {
      entry.factId = mapId(entry.factId);
      entry.source = replace(entry.source);
    }
  }
  for (const location of world.locations) {
    location.id = mapId(location.id);
    location.adjacentLocationIds = location.adjacentLocationIds.map(mapId);
    location.name = replace(location.name);
    location.publicDescription = replace(location.publicDescription);
  }
  for (const milestone of world.arcClock.milestones)
    milestone.description = replace(milestone.description);
  world.calendar.label = replace(world.calendar.label);
  world.endingConstraints = world.endingConstraints.map(replace);
  world.threat = replace(world.threat);
}

function slugifyId(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLocaleLowerCase("en");
  return slug || "generated-value";
}

function singular(value: string): string {
  return value.endsWith("s") ? value.slice(0, -1) : value;
}

function renameCast(world: WorldState, setup: StorySetup): void {
  const names = new Map<string, string>([
    [POV_ID, setup.cast.protagonist],
    ...Object.entries(CAST_IDS).map(
      ([role, id]) => [id, setup.cast.supporting[role as keyof typeof CAST_IDS]] as const,
    ),
  ]);
  const substitutions = new Map<string, string>([["Malachar", setup.cast.pastLife]]);

  for (const character of world.characters) {
    const replacement = names.get(character.id);
    if (!replacement) continue;
    substitutions.set(character.name, replacement);
    const priorFirstName = character.name.split(/\s+/u)[0];
    const nextFirstName = replacement.split(/\s+/u)[0];
    if (priorFirstName && nextFirstName) substitutions.set(priorFirstName, nextFirstName);
    character.name = replacement;
  }

  const replace = (value: string): string => {
    let next = value;
    for (const [before, after] of [...substitutions].sort(
      ([left], [right]) => right.length - left.length,
    )) {
      next = next.replaceAll(before, after);
    }
    return next;
  };

  for (const character of world.characters) {
    character.publicRole = replace(character.publicRole);
    character.beliefs = character.beliefs.map(replace);
    character.goals = character.goals.map(replace);
    character.plan = character.plan.map(replace);
  }
  for (const fact of world.facts) {
    fact.claim = replace(fact.claim);
    fact.source = replace(fact.source);
  }
  for (const milestone of world.arcClock.milestones)
    milestone.description = replace(milestone.description);
}

function openingPlan(setup: StorySetup): string[] {
  const bodyAction =
    setup.startingLife === "birth"
      ? "Test what the newborn body can sense and signal"
      : setup.startingLife === "child"
        ? "Learn who controls the child's immediate safety"
        : "Take stock of the new body and immediate danger";
  return [bodyAction, `Test the ${setup.systemFocus.replaceAll("-", " ")} System safely`];
}
