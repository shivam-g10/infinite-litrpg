import { z } from "zod";

import {
  ActNumberSchema,
  CharacterIdSchema,
  ChapterNumberSchema,
  CONTRACT_VERSION,
  EventIdSchema,
  FactIdSchema,
  FactionIdSchema,
  FIXTURE_VERSION,
  IdSchema,
  ItemIdSchema,
  LocationIdSchema,
  ShortTextSchema,
  SkillIdSchema,
  WorldVersionSchema,
} from "./primitives";

export const CharacterStatusSchema = z.enum(["alive", "incapacitated", "dead", "terminal"]);
export const FactVisibilitySchema = z.enum(["public", "private", "observed", "rumor"]);
export const CertaintySchema = z.enum(["certain", "likely", "uncertain"]);

export const ResourcePoolSchema = z
  .object({
    current: z.number().int().min(0),
    maximum: z.number().int().positive(),
  })
  .strict()
  .refine(({ current, maximum }) => current <= maximum, "Current resource exceeds maximum");

export const CharacterStatsSchema = z
  .object({
    agility: z.number().int().min(0).max(999),
    intellect: z.number().int().min(0).max(999),
    strength: z.number().int().min(0).max(999),
    vitality: z.number().int().min(0).max(999),
    willpower: z.number().int().min(0).max(999),
  })
  .strict();

export const SkillStateSchema = z
  .object({
    id: SkillIdSchema,
    manaCost: z.number().int().min(0),
    minimumLevel: z.number().int().min(1).max(100),
    name: ShortTextSchema,
    prerequisiteSkillIds: z.array(SkillIdSchema).max(8),
    rank: z.number().int().min(1).max(10),
    requiredClassId: IdSchema,
  })
  .strict();

export const InventoryStackSchema = z
  .object({
    equipped: z.boolean(),
    itemId: ItemIdSchema,
    name: ShortTextSchema,
    quantity: z.number().int().min(0).max(999),
    unique: z.boolean(),
  })
  .strict()
  .refine(({ quantity, unique }) => !unique || quantity <= 1, "Unique item quantity exceeds one");

export const RelationshipSchema = z
  .object({
    characterId: CharacterIdSchema,
    label: ShortTextSchema,
    score: z.number().int().min(-100).max(100),
  })
  .strict();

export const CharacterStateSchema = z
  .object({
    beliefs: z.array(ShortTextSchema).min(1).max(12),
    characterClassId: IdSchema,
    characterClassName: ShortTextSchema,
    conditions: z.array(IdSchema).max(12),
    equipmentItemIds: z.array(ItemIdSchema).max(12),
    experience: z.number().int().min(0),
    factionId: FactionIdSchema,
    gender: z.enum(["male", "female"]).nullable().optional(),
    goals: z.array(ShortTextSchema).min(1).max(8),
    health: ResourcePoolSchema,
    id: CharacterIdSchema,
    inventory: z.array(InventoryStackSchema).max(40),
    level: z.number().int().min(1).max(100),
    locationId: LocationIdSchema,
    mana: ResourcePoolSchema,
    name: ShortTextSchema,
    plan: z.array(ShortTextSchema).min(1).max(8),
    publicRole: ShortTextSchema,
    relationships: z.array(RelationshipSchema).max(12),
    role: IdSchema,
    secretFactIds: z.array(FactIdSchema).max(12),
    skills: z.array(SkillStateSchema).max(30),
    stats: CharacterStatsSchema,
    status: CharacterStatusSchema,
  })
  .strict();

export const FactSchema = z
  .object({
    certainty: CertaintySchema,
    claim: ShortTextSchema,
    discoveredChapter: ChapterNumberSchema,
    id: FactIdSchema,
    ownerCharacterId: CharacterIdSchema.nullable(),
    source: ShortTextSchema,
    visibility: FactVisibilitySchema,
    discovery: z
      .object({
        actionTypes: z
          .array(z.enum(["investigate", "interact", "defend", "use_item", "use_skill"]))
          .min(1)
          .max(5),
        subjectIds: z.array(IdSchema).min(1).max(8),
      })
      .strict()
      .optional(),
  })
  .strict();

export const KnowledgeEntrySchema = z
  .object({
    certainty: CertaintySchema,
    discoveredChapter: ChapterNumberSchema,
    factId: FactIdSchema,
    source: ShortTextSchema,
  })
  .strict();

export const KnowledgeLedgerSchema = z
  .object({
    characterId: CharacterIdSchema,
    entries: z.array(KnowledgeEntrySchema).max(500),
  })
  .strict();

export const LocationSchema = z
  .object({
    adjacentLocationIds: z.array(LocationIdSchema).max(12),
    id: LocationIdSchema,
    name: ShortTextSchema,
    publicDescription: ShortTextSchema,
  })
  .strict();

export const FactionSchema = z
  .object({
    id: FactionIdSchema,
    name: ShortTextSchema,
    publicGoal: ShortTextSchema,
  })
  .strict();

export const ActiveEventSchema = z
  .object({
    id: EventIdSchema,
    locationId: LocationIdSchema,
    observerIds: z.array(CharacterIdSchema).max(12),
    participantIds: z.array(CharacterIdSchema).max(12),
    summary: ShortTextSchema,
    visibility: z.enum(["public", "participants", "private"]),
  })
  .strict();

export const ArcMilestoneSchema = z
  .object({
    act: ActNumberSchema,
    compatibleActionTypes: z
      .array(
        z.enum([
          "move",
          "use_item",
          "use_skill",
          "investigate",
          "interact",
          "defend",
          "rally",
          "wait",
        ]),
      )
      .min(1)
      .max(8),
    completed: z.boolean(),
    description: ShortTextSchema,
    id: IdSchema,
    requiredByChapter: z.number().int().min(1).max(350),
  })
  .strict();

export const ArcClockSchema = z
  .object({
    convergencePressure: z.boolean(),
    milestones: z.array(ArcMilestoneSchema).length(7),
    transitionRequired: z.boolean(),
  })
  .strict();

export const WorldStateSchema = z
  .object({
    act: ActNumberSchema,
    activeEvents: z.array(ActiveEventSchema).max(50),
    arcClock: ArcClockSchema,
    calendar: z
      .object({
        day: z.number().int().min(1),
        label: ShortTextSchema,
      })
      .strict(),
    chapter: ChapterNumberSchema,
    characters: z.array(CharacterStateSchema).length(6),
    contractVersion: z.literal(CONTRACT_VERSION),
    endingConstraints: z.array(ShortTextSchema).min(1).max(12),
    factions: z.array(FactionSchema).min(1).max(20),
    facts: z.array(FactSchema).max(1_000),
    fixtureVersion: z.literal(FIXTURE_VERSION),
    id: IdSchema,
    knowledgeLedgers: z.array(KnowledgeLedgerSchema).length(6),
    locations: z.array(LocationSchema).min(1).max(100),
    lockedPovId: CharacterIdSchema.nullable(),
    terminal: z.boolean(),
    terminalReason: ShortTextSchema.nullable(),
    threat: ShortTextSchema,
    version: WorldVersionSchema,
    origin: z
      .object({ genesisVersion: z.literal("1.0.0"), kind: z.literal("generated") })
      .strict()
      .optional(),
    system: z
      .object({
        focus: ShortTextSchema,
        name: ShortTextSchema,
        rules: z.array(ShortTextSchema).min(2).max(8),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ActiveEvent = z.infer<typeof ActiveEventSchema>;
export type CharacterState = z.infer<typeof CharacterStateSchema>;
export type Fact = z.infer<typeof FactSchema>;
export type KnowledgeLedger = z.infer<typeof KnowledgeLedgerSchema>;
export type WorldState = z.infer<typeof WorldStateSchema>;
