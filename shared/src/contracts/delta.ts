import { z } from "zod";

import {
  ActNumberSchema,
  CharacterIdSchema,
  ChapterNumberSchema,
  CONTRACT_VERSION,
  EventIdSchema,
  FactIdSchema,
  IdSchema,
  IntentIdSchema,
  ItemIdSchema,
  LocationIdSchema,
  PROMPT_VERSION,
  ShortTextSchema,
  WorldVersionSchema,
} from "./primitives";
import { FactSchema, SkillStateSchema } from "./world";

export const RejectionCodeSchema = z.enum([
  "CHARACTER_DEAD",
  "CHARACTER_MISSING",
  "CONFLICT_LOST",
  "INVALID_SCHEMA",
  "ITEM_MISSING",
  "KNOWLEDGE_MISSING",
  "LOCATION_MISSING",
  "LOCATION_NOT_ADJACENT",
  "MANA_INSUFFICIENT",
  "PRECONDITION_FAILED",
  "SKILL_LOCKED",
  "STALE_WORLD_VERSION",
  "STORY_TERMINAL",
  "TARGET_MISSING",
]);

export const ResolvedEventSchema = z
  .object({
    id: EventIdSchema,
    kind: IdSchema,
    locationId: LocationIdSchema,
    observerIds: z.array(CharacterIdSchema).max(12),
    participantIds: z.array(CharacterIdSchema).max(12),
    summary: ShortTextSchema,
    visibility: z.enum(["public", "participants", "private"]),
  })
  .strict();

const SetLocationMutationSchema = z
  .object({
    characterId: CharacterIdSchema,
    fromLocationId: LocationIdSchema,
    toLocationIds: z.array(LocationIdSchema).min(1).max(3),
    type: z.literal("set_location"),
  })
  .strict();

const AdjustInventoryMutationSchema = z
  .object({
    characterId: CharacterIdSchema,
    itemId: ItemIdSchema,
    name: ShortTextSchema,
    quantityDelta: z.number().int().min(-99).max(99),
    type: z.literal("adjust_inventory"),
    unique: z.boolean(),
  })
  .strict();

const AdjustResourceMutationSchema = z
  .object({
    characterId: CharacterIdSchema,
    delta: z.number().int().min(-999).max(999),
    resource: z.enum(["health", "mana"]),
    type: z.literal("adjust_resource"),
  })
  .strict();

const GrantExperienceMutationSchema = z
  .object({
    amount: z.number().int().positive().max(100_000),
    characterId: CharacterIdSchema,
    type: z.literal("grant_experience"),
  })
  .strict();

const LearnSkillMutationSchema = z
  .object({
    characterId: CharacterIdSchema,
    skill: SkillStateSchema,
    type: z.literal("learn_skill"),
  })
  .strict();

const SetStatusMutationSchema = z
  .object({
    characterId: CharacterIdSchema,
    status: z.enum(["alive", "incapacitated", "dead", "terminal"]),
    type: z.literal("set_status"),
  })
  .strict();

const SetRelationshipMutationSchema = z
  .object({
    characterId: CharacterIdSchema,
    label: ShortTextSchema,
    score: z.number().int().min(-100).max(100),
    targetCharacterId: CharacterIdSchema,
    type: z.literal("set_relationship"),
  })
  .strict();

const SetThreatMutationSchema = z
  .object({
    threat: ShortTextSchema,
    type: z.literal("set_threat"),
  })
  .strict();

const CompleteMilestoneMutationSchema = z
  .object({
    milestoneId: IdSchema,
    type: z.literal("complete_milestone"),
  })
  .strict();

const EndStoryMutationSchema = z
  .object({
    reason: ShortTextSchema,
    resolvedEndingConstraints: z.array(ShortTextSchema).min(1).max(12),
    type: z.literal("end_story"),
  })
  .strict();

export const StateMutationSchema = z.discriminatedUnion("type", [
  CompleteMilestoneMutationSchema,
  EndStoryMutationSchema,
  SetLocationMutationSchema,
  AdjustInventoryMutationSchema,
  AdjustResourceMutationSchema,
  GrantExperienceMutationSchema,
  LearnSkillMutationSchema,
  SetStatusMutationSchema,
  SetRelationshipMutationSchema,
  SetThreatMutationSchema,
]);

const DiscoverFactMutationSchema = z
  .object({
    characterId: CharacterIdSchema,
    fact: FactSchema,
    type: z.literal("discover_fact"),
  })
  .strict();

const LearnExistingFactMutationSchema = z
  .object({
    certainty: z.enum(["certain", "likely", "uncertain"]),
    characterId: CharacterIdSchema,
    discoveredChapter: ChapterNumberSchema,
    factId: FactIdSchema,
    source: ShortTextSchema,
    type: z.literal("learn_existing_fact"),
  })
  .strict();

export const KnowledgeMutationSchema = z.discriminatedUnion("type", [
  DiscoverFactMutationSchema,
  LearnExistingFactMutationSchema,
]);

export const ClockDeltaSchema = z
  .object({
    convergencePressure: z.boolean(),
    fromAct: ActNumberSchema,
    fromChapter: ChapterNumberSchema,
    terminal: z.boolean(),
    toAct: ActNumberSchema,
    toChapter: ChapterNumberSchema,
    transitionRequired: z.boolean(),
  })
  .strict();

export const WorldDeltaSchema = z
  .object({
    acceptedIntentIds: z.array(IntentIdSchema).max(4),
    clock: ClockDeltaSchema,
    contractVersion: z.literal(CONTRACT_VERSION),
    events: z.array(ResolvedEventSchema).max(30),
    expectedWorldVersion: WorldVersionSchema,
    knowledgeMutations: z.array(KnowledgeMutationSchema).max(50),
    promptVersion: z.literal(PROMPT_VERSION),
    rejectedIntents: z
      .array(
        z
          .object({
            code: RejectionCodeSchema,
            intentId: IntentIdSchema,
            reason: ShortTextSchema,
          })
          .strict(),
      )
      .max(4),
    stateMutations: z.array(StateMutationSchema).max(50),
    surfacedClueFactIds: z.array(FactIdSchema).max(20),
  })
  .strict();

export type ClockDelta = z.infer<typeof ClockDeltaSchema>;
export type KnowledgeMutation = z.infer<typeof KnowledgeMutationSchema>;
export type RejectionCode = z.infer<typeof RejectionCodeSchema>;
export type ResolvedEvent = z.infer<typeof ResolvedEventSchema>;
export type StateMutation = z.infer<typeof StateMutationSchema>;
export type WorldDelta = z.infer<typeof WorldDeltaSchema>;
