import { z } from "zod";

import {
  CharacterIdSchema,
  CONTRACT_VERSION,
  FactIdSchema,
  IdSchema,
  IntentIdSchema,
  ItemIdSchema,
  LocationIdSchema,
  PersistedPromptVersionSchema,
  PROMPT_VERSION,
  ShortTextSchema,
  SkillIdSchema,
  WorldVersionSchema,
} from "./primitives";

const MoveActionSchema = z
  .object({
    destinationId: LocationIdSchema,
    type: z.literal("move"),
  })
  .strict();

const UseItemActionSchema = z
  .object({
    itemId: ItemIdSchema,
    quantity: z.number().int().positive().max(99),
    targetId: IdSchema.nullable(),
    type: z.literal("use_item"),
  })
  .strict();

const UseSkillActionSchema = z
  .object({
    skillId: SkillIdSchema,
    targetId: IdSchema.nullable(),
    type: z.literal("use_skill"),
  })
  .strict();

const InvestigateActionSchema = z
  .object({
    subjectId: IdSchema,
    type: z.literal("investigate"),
  })
  .strict();

const InteractActionSchema = z
  .object({
    approach: ShortTextSchema,
    targetId: IdSchema,
    type: z.literal("interact"),
  })
  .strict();

const DefendActionSchema = z
  .object({
    targetId: IdSchema,
    type: z.literal("defend"),
  })
  .strict();

const RallyActionSchema = z
  .object({
    factionId: IdSchema,
    locationId: LocationIdSchema,
    type: z.literal("rally"),
  })
  .strict();

const WaitActionSchema = z.object({ type: z.literal("wait") }).strict();

export const IntentActionSchema = z.discriminatedUnion("type", [
  MoveActionSchema,
  UseItemActionSchema,
  UseSkillActionSchema,
  InvestigateActionSchema,
  InteractActionSchema,
  DefendActionSchema,
  RallyActionSchema,
  WaitActionSchema,
]);

export const IntentPrerequisitesSchema = z
  .object({
    requiredFactIds: z.array(FactIdSchema).max(12),
    requiredItemIds: z.array(ItemIdSchema).max(12),
    requiredSkillIds: z.array(SkillIdSchema).max(12),
  })
  .strict();

export const WorldIntentSchema = z
  .object({
    action: IntentActionSchema,
    actorId: CharacterIdSchema,
    contractVersion: z.literal(CONTRACT_VERSION),
    expectedEffect: ShortTextSchema,
    goal: ShortTextSchema,
    id: IntentIdSchema,
    prerequisites: IntentPrerequisitesSchema,
    promptVersion: z.literal(PROMPT_VERSION),
    stateVersion: WorldVersionSchema,
  })
  .strict();

const BackgroundIntentRequirementsSchema = z
  .object({
    f: z.array(FactIdSchema).max(12),
    i: z.array(ItemIdSchema).max(12),
    s: z.array(SkillIdSchema).max(12),
  })
  .strict();

const BackgroundIntentActionCandidateSchema = z
  .object({
    t: z.enum([
      "move",
      "use_item",
      "use_skill",
      "investigate",
      "interact",
      "defend",
      "rally",
      "wait",
    ]),
    v: z.array(z.union([ShortTextSchema, z.number().int().positive().max(99), z.null()])).max(3),
  })
  .strict();

export const BackgroundIntentCandidateSchema = z
  .object({
    a: BackgroundIntentActionCandidateSchema,
    e: ShortTextSchema,
    g: ShortTextSchema,
    r: BackgroundIntentRequirementsSchema,
  })
  .strict();

export const AssignedBackgroundIntentCandidateSchema = BackgroundIntentCandidateSchema.extend({
  c: CharacterIdSchema,
}).strict();

export const BackgroundIntentBatchCandidateSchema = z
  .object({
    intents: z.array(AssignedBackgroundIntentCandidateSchema).max(3),
  })
  .strict()
  .superRefine(({ intents }, context) => {
    const actorIds = new Set<string>();
    for (const [index, intent] of intents.entries()) {
      if (actorIds.has(intent.c)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate background actor ${intent.c}`,
          path: ["intents", index, "c"],
        });
      }
      actorIds.add(intent.c);
    }
  });

export const PersistedWorldIntentSchema = WorldIntentSchema.extend({
  promptVersion: PersistedPromptVersionSchema,
}).strict();

export const IntentBatchSchema = z
  .object({
    intents: z.array(WorldIntentSchema).max(3),
  })
  .strict()
  .superRefine(({ intents }, context) => {
    const ids = new Set<string>();
    for (const intent of intents) {
      if (ids.has(intent.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate intent id ${intent.id}`,
          path: ["intents"],
        });
      }
      ids.add(intent.id);
    }
  });

export const PlayerActionSchema = z
  .object({
    action: IntentActionSchema,
    actorId: CharacterIdSchema,
    description: ShortTextSchema,
    milestoneId: IdSchema.nullable(),
    source: z.enum(["suggested", "custom"]),
    stateVersion: WorldVersionSchema,
  })
  .strict();

export type IntentAction = z.infer<typeof IntentActionSchema>;
export type BackgroundIntentCandidate = z.infer<typeof BackgroundIntentCandidateSchema>;
export type AssignedBackgroundIntentCandidate = z.infer<
  typeof AssignedBackgroundIntentCandidateSchema
>;
export type PlayerAction = z.infer<typeof PlayerActionSchema>;
export type PersistedWorldIntent = z.infer<typeof PersistedWorldIntentSchema>;
export type WorldIntent = z.infer<typeof WorldIntentSchema>;
