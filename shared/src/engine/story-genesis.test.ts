import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_STORY_SETUP, WorldStateSchema } from "../contracts";
import { applyStorySetup } from "./story-genesis";

describe("applyStorySetup", () => {
  it("creates valid protagonist canon without mutating the seed", () => {
    const seed = WorldStateSchema.parse(
      JSON.parse(readFileSync(resolve("evals/fixtures/demon-king-world.json"), "utf8")),
    );
    const original = structuredClone(seed);
    const result = applyStorySetup(seed, {
      ...DEFAULT_STORY_SETUP,
      backgrounds: ["orphan"],
      personalityTraits: ["curious", "warm"],
      protagonistGender: "female",
      rebirthCause: "sacrifice",
      startingLife: "birth",
      cast: {
        protagonist: "Ilyra Venn",
        pastLife: "Azrath",
        supporting: {
          general: "Doran Kest",
          hero: "Selene Marr",
          prince: "Cael Orin",
          rival: "Neris Vale",
          saint: "Mira Rook",
        },
      },
      world: {
        calendarName: "Stormwake",
        crownName: "Tempest Crown",
        legionName: "Gale Legion",
        primarySkillName: "Pulse Reading",
        protagonistClassName: "Stormmarked",
        raiderName: "Gale Reavers",
        roadName: "Thunder Road",
        secondarySkillName: "Tyrant's Resonance",
        settlementName: "Havenreach",
        systemName: "Tempest System",
      },
    });

    expect(seed).toEqual(original);
    expect(result.characters.find(({ id }) => id === "rowan-ashborn")).toMatchObject({
      beliefs: [
        "Every Tempest System rule hides a useful exception",
        "A second life is worth sharing with people who choose to stay",
      ],
      equipmentItemIds: [],
      health: { current: 8, maximum: 8 },
      name: "Ilyra Venn",
    });
    expect(result.characters.map(({ name }) => name)).toEqual([
      "Ilyra Venn",
      "Selene Marr",
      "Mira Rook",
      "Doran Kest",
      "Cael Orin",
      "Neris Vale",
    ]);
    expect(result.facts.find(({ id }) => id === "rowan-is-malachar-reincarnated")?.claim).toContain(
      "female newborn body after a deliberate sacrifice",
    );
    expect(result.facts.find(({ id }) => id === "rowan-is-malachar-reincarnated")?.claim).toContain(
      "Ilyra Venn is Demon King Azrath reincarnated",
    );
    expect(
      result.knowledgeLedgers.find(({ characterId }) => characterId === "rowan-ashborn")?.entries,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ factId: "rowan-is-malachar-reincarnated" }),
      ]),
    );
    const readerFacingText = [
      result.calendar.label,
      result.threat,
      ...result.endingConstraints,
      ...result.activeEvents.map(({ summary }) => summary),
      ...result.characters.flatMap((character) => [
        character.name,
        character.characterClassName,
        character.publicRole,
        ...character.beliefs,
        ...character.goals,
        ...character.plan,
        ...character.skills.map(({ name }) => name),
      ]),
      ...result.factions.flatMap(({ name, publicGoal }) => [name, publicGoal]),
      ...result.facts.flatMap(({ claim, source }) => [claim, source]),
      ...result.locations.flatMap(({ name, publicDescription }) => [name, publicDescription]),
    ].join("\n");
    expect(readerFacingText).not.toMatch(/\b(?:ash|ember|cinder)/iu);
    expect(result.calendar.label).toBe("Year 1, Stormwake 1");
    expect(result.characters[0]).toMatchObject({
      characterClassId: "stormmarked",
      characterClassName: "Stormmarked",
      skills: expect.arrayContaining([
        expect.objectContaining({ id: "pulse-reading", name: "Pulse Reading" }),
      ]),
    });
    expect(result.locations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "frontier-road", name: "Thunder Road" }),
        expect.objectContaining({ id: "origin-settlement", name: "Havenreach" }),
      ]),
    );
  });
});
