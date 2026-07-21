import { describe, expect, it } from "vitest";

import { DEFAULT_STORY_SETUP, StorySetupSchema, type StoryGenesisCandidateV1 } from "../contracts";
import { compileStoryGenesis, StoryGenesisCompileError } from "./story-genesis";

export function genesisCandidate(
  overrides: Partial<StoryGenesisCandidateV1> = {},
): StoryGenesisCandidateV1 {
  const locations = [
    {
      key: "palace",
      name: "Glass Palace",
      description: "A palace split by a silent coup.",
      adjacentKeys: ["court", "vault"],
    },
    {
      key: "court",
      name: "Rain Court",
      description: "A flooded audience court.",
      adjacentKeys: ["palace", "garden"],
    },
    {
      key: "garden",
      name: "Moon Garden",
      description: "A garden of listening statues.",
      adjacentKeys: ["court", "tower"],
    },
    {
      key: "tower",
      name: "Oath Tower",
      description: "The royal System archive.",
      adjacentKeys: ["garden", "vault"],
    },
    {
      key: "vault",
      name: "Deep Vault",
      description: "A sealed treasury under attack.",
      adjacentKeys: ["tower", "palace"],
    },
  ];
  const factions = [
    { key: "court-faction", name: "Rain Court", publicGoal: "Keep the succession lawful." },
    { key: "archive-faction", name: "Oath Archive", publicGoal: "Guard System contracts." },
    { key: "rebel-faction", name: "Glass Rebels", publicGoal: "Break inherited ranks." },
  ];
  const roles = ["general", "hero", "prince", "rival", "saint"] as const;
  return {
    calendarName: "Storm Reckoning",
    discoverableFacts: ["coup", "seal", "heir", "vault"].map((key, index) => ({
      actionTypes: ["investigate", "interact"],
      certainty: "certain",
      claim: `Hidden truth ${index + 1}`,
      key,
      ownerRole: index === 0 ? "prince" : null,
      source: `Genesis source ${index + 1}`,
      subjectKeys: [locations[index]!.key],
      visibility: index === 3 ? "public" : "private",
    })),
    endingConstraints: ["The reincarnated ruler must choose between conquest and consent."],
    factions,
    guidanceCoverage: [],
    locations,
    milestones: Array.from({ length: 7 }, (_, index) => ({
      compatibleActionTypes: ["investigate", "interact", "defend"],
      description: `Act ${index + 1} changes the balance of power.`,
    })),
    opening: {
      action: { subjectKey: "palace", type: "investigate" },
      actionDescription: "Read the bloodless signs of the coup.",
      incident: "The crown prince vanishes during the naming rite.",
      locationKey: "palace",
      pressure: "The doors will seal at midnight.",
    },
    protagonist: {
      beliefs: ["Power needs a witness."],
      className: "Oath Reader",
      generatedName: "Rowan Vale",
      goals: ["Survive the naming rite."],
      inventory: [],
      pastLifeName: "Avaron",
      plan: ["Read the room before choosing an ally."],
      publicRole: "An unranked royal ward",
    },
    skills: [
      { key: "truth-sense", manaCost: 4, name: "Truth Sense" },
      { key: "oath-bind", manaCost: 8, name: "Oath Bind" },
    ],
    supportingCharacters: roles.map((role, index) => ({
      beliefs: [`${role} trusts proof.`],
      className: `${role[0]!.toUpperCase()}${role.slice(1)} Class`,
      factionKey: factions[index % factions.length]!.key,
      goals: [`The ${role} must survive.`],
      inventory: [],
      locationKey: locations[index]!.key,
      name: ["Varek Thorn", "Elara Voss", "Lucan Aurelis", "Nyra Vale", "Maelin Rook"][index]!,
      plan: [`The ${role} watches the rite.`],
      publicRole: `The court ${role}`,
      relationship: { label: "uncertain ally", score: 5 },
      role,
    })),
    system: {
      focus: "Contracts trade declared limits for power.",
      name: "Covenant System",
      rules: ["Every skill needs a declared limit.", "Broken oaths consume rank."],
    },
    threat: "A faction is rewriting the succession through System law.",
    ...overrides,
  };
}

describe("generated story genesis", () => {
  it("rejects client world and cast canon", () => {
    expect(
      StorySetupSchema.safeParse({ ...DEFAULT_STORY_SETUP, world: {}, cast: {} }).success,
    ).toBe(false);
  });

  it("compiles stable IDs and complete initial canon", () => {
    const result = compileStoryGenesis(DEFAULT_STORY_SETUP, genesisCandidate());
    expect(result.world.characters).toHaveLength(6);
    expect(result.world.knowledgeLedgers).toHaveLength(6);
    expect(result.world.arcClock.milestones).toHaveLength(7);
    expect(result.world.locations[0]?.name).toBe("Glass Palace");
    expect(result.world.characters[0]?.inventory).toEqual([]);
    expect(result.world.lockedPovId).toBe("actor-protagonist");
    expect(result.world.system?.name).toBe("Covenant System");
    expect(result.openingAction).toEqual({ subjectId: "location-1", type: "investigate" });
  });

  it("allows punctuation in generated calendar, class, and System labels", () => {
    const candidate = genesisCandidate({ calendarName: "Year 412: Crownfall" });
    candidate.protagonist.className = "Rank 0: Crownless";
    candidate.protagonist.generatedName = "Cassian IV, Crown Prince.";
    candidate.protagonist.pastLifeName = "King Aurelion II, World-Unifier.";
    candidate.supportingCharacters[0]!.className = "Tier-3 Vanguard";
    candidate.system.name = "Crown/System 2.0";

    const world = compileStoryGenesis(DEFAULT_STORY_SETUP, candidate).world;
    expect(world.calendar.label).toBe("Year 412: Crownfall");
    expect(world.characters[0]?.characterClassName).toBe("Rank 0: Crownless");
    expect(world.characters[0]?.name).toBe("Cassian IV, Crown Prince");
    expect(world.facts[0]?.claim).toContain("King Aurelion II, World-Unifier");
    expect(world.system?.name).toBe("Crown/System 2.0");
  });

  it("reports exact missing roles and invalid fact subjects", () => {
    const missingRole = genesisCandidate();
    missingRole.supportingCharacters[4]!.role = "rival";
    expect(() => compileStoryGenesis(DEFAULT_STORY_SETUP, missingRole)).toThrow(
      /Missing: saint.*Duplicated: rival/u,
    );

    const badFact = genesisCandidate();
    badFact.discoverableFacts[0]!.subjectKeys = ["palace", "palace", "missing-place"];
    expect(() => compileStoryGenesis(DEFAULT_STORY_SETUP, badFact)).toThrow(
      /Discoverable fact coup.*invalid subjects \[missing-place\]/u,
    );
  });

  it("normalizes descriptive role references and reverse map edges", () => {
    const candidate = genesisCandidate();
    candidate.discoverableFacts[0]!.subjectKeys = ["general-maris", "general-maris"];
    candidate.locations[1]!.adjacentKeys = ["garden"];
    candidate.opening.action = { subjectKey: "vault", type: "investigate" };
    candidate.protagonist.inventory = [
      { equipped: false, key: "royal-seal", name: "Royal Seal", quantity: 2, unique: true },
    ];

    const world = compileStoryGenesis(DEFAULT_STORY_SETUP, candidate).world;
    expect(world.facts[1]?.discovery?.subjectIds).toEqual(["actor-general"]);
    expect(world.locations[0]?.adjacentLocationIds).toContain("location-2");
    expect(world.locations[1]?.adjacentLocationIds).toContain("location-1");
    expect(world.characters[0]?.locationId).toBe("location-5");
    expect(world.characters[0]?.inventory[0]?.quantity).toBe(1);
  });

  it("accepts a local-character opening investigation and rejects a remote one", () => {
    const local = genesisCandidate();
    const rival = local.supportingCharacters.find(({ role }) => role === "rival")!;
    rival.locationKey = local.opening.locationKey;
    local.opening.action = { subjectKey: "rival", type: "investigate" };

    expect(compileStoryGenesis(DEFAULT_STORY_SETUP, local).openingAction).toEqual({
      subjectId: "actor-rival",
      type: "investigate",
    });

    rival.locationKey = "tower";
    expect(() => compileStoryGenesis(DEFAULT_STORY_SETUP, local)).toThrow(
      /Opening action is not legal.*LOCATION_MISMATCH/u,
    );
  });

  it("accepts non-verbatim guidance labels when their canon paths resolve", () => {
    const guidance = "Give Rowan four siblings and the skill Max Charm";
    const candidate = genesisCandidate();
    candidate.skills[0]!.name = "Max Charm";
    for (const character of candidate.supportingCharacters.slice(0, 4)) {
      character.relationship.label = "sibling";
    }
    candidate.guidanceCoverage = [
      {
        canonPaths: ["skills.0.name", "supportingCharacters[0].relationship.label"],
        requirementId: "guidance-1",
      },
    ];

    expect(
      compileStoryGenesis({ ...DEFAULT_STORY_SETUP, guidance }, candidate).world.system,
    ).not.toBeNull();
  });

  it("bounds the compiled opening event summary", () => {
    const candidate = genesisCandidate();
    candidate.opening.incident = "Incident ".repeat(25).trim();
    candidate.opening.pressure = "Pressure ".repeat(25).trim();

    const summary = compileStoryGenesis(DEFAULT_STORY_SETUP, candidate).world.activeEvents[0]
      ?.summary;
    expect(summary?.length).toBeLessThanOrEqual(240);
    expect(summary).toMatch(/\.\.\.$/u);
  });

  it("rejects disconnected maps and newborn inventory", () => {
    const candidate = genesisCandidate();
    const missingReference = structuredClone(candidate);
    missingReference.locations[0]!.adjacentKeys = ["missing-place"];
    expect(() => compileStoryGenesis(DEFAULT_STORY_SETUP, missingReference)).toThrow(
      "references missing adjacent location missing-place",
    );

    const disconnected = structuredClone(candidate);
    disconnected.locations[0]!.adjacentKeys = ["court"];
    disconnected.locations[1]!.adjacentKeys = ["palace"];
    disconnected.locations[2]!.adjacentKeys = ["tower"];
    disconnected.locations[3]!.adjacentKeys = ["garden", "vault"];
    disconnected.locations[4]!.adjacentKeys = ["tower"];
    expect(() => compileStoryGenesis(DEFAULT_STORY_SETUP, disconnected)).toThrow(
      StoryGenesisCompileError,
    );

    const inventory = [
      { equipped: false, key: "blanket", name: "Royal Blanket", quantity: 1, unique: true },
    ];
    expect(() =>
      compileStoryGenesis(
        { ...DEFAULT_STORY_SETUP, startingLife: "birth" },
        genesisCandidate({ protagonist: { ...candidate.protagonist, inventory } }),
      ),
    ).toThrow("Newborn inventory must be empty");
  });

  it("requires concrete guidance coverage", () => {
    expect(() =>
      compileStoryGenesis(
        { ...DEFAULT_STORY_SETUP, guidance: "The kingdom must have three moons" },
        genesisCandidate(),
      ),
    ).toThrow("GENESIS_GUIDANCE_UNSATISFIED");
  });

  it.each(["child", "teen", "adult"] as const)("allows plausible %s inventory", (startingLife) => {
    const candidate = genesisCandidate();
    candidate.protagonist.inventory = [
      { equipped: false, key: "token", name: "Family Token", quantity: 1, unique: true },
    ];
    expect(
      compileStoryGenesis({ ...DEFAULT_STORY_SETUP, startingLife }, candidate).world.characters[0]
        ?.inventory,
    ).toHaveLength(1);
  });
});
