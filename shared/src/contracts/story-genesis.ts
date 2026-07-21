import { z } from "zod";

import { IntentActionSchema } from "./intent";
import { StorySetupSchema } from "./story-setup";
import { IdSchema, ShortTextSchema } from "./primitives";
import { WorldStateSchema } from "./world";

const uniqueByKey = <T extends { key: string }>(values: readonly T[]) =>
  new Set(values.map(({ key }) => key)).size === values.length;

const CandidateItemSchema = z
  .object({
    equipped: z.boolean(),
    key: IdSchema,
    name: ShortTextSchema,
    quantity: z.number().int().positive().max(99),
    unique: z.boolean(),
  })
  .strict();

const CandidateSkillSchema = z
  .object({ key: IdSchema, manaCost: z.number().int().min(0).max(999), name: ShortTextSchema })
  .strict();

const CandidateLocationSchema = z
  .object({
    adjacentKeys: z.array(IdSchema).min(1).max(8),
    description: ShortTextSchema,
    key: IdSchema,
    name: ShortTextSchema,
  })
  .strict();

const CandidateFactionSchema = z
  .object({ key: IdSchema, name: ShortTextSchema, publicGoal: ShortTextSchema })
  .strict();

const CandidateRelationshipSchema = z
  .object({ label: ShortTextSchema, score: z.number().int().min(-100).max(100) })
  .strict();

export const SupportingRoleSchema = z.enum(["general", "hero", "prince", "rival", "saint"]);

const CandidateSupportingCharacterSchema = z
  .object({
    beliefs: z.array(ShortTextSchema).min(1).max(6),
    className: ShortTextSchema,
    factionKey: IdSchema,
    goals: z.array(ShortTextSchema).min(1).max(4),
    inventory: z.array(CandidateItemSchema).max(6),
    locationKey: IdSchema,
    name: ShortTextSchema,
    plan: z.array(ShortTextSchema).min(1).max(4),
    publicRole: ShortTextSchema,
    relationship: CandidateRelationshipSchema,
    role: SupportingRoleSchema,
  })
  .strict();

const CandidateActionSchema = z.discriminatedUnion("type", [
  z.object({ destinationKey: IdSchema, type: z.literal("move") }).strict(),
  z
    .object({
      itemKey: IdSchema,
      quantity: z.number().int().positive().max(99),
      type: z.literal("use_item"),
    })
    .strict(),
  z
    .object({ skillKey: IdSchema, targetKey: IdSchema.nullable(), type: z.literal("use_skill") })
    .strict(),
  z.object({ subjectKey: IdSchema, type: z.literal("investigate") }).strict(),
  z
    .object({ approach: ShortTextSchema, targetKey: IdSchema, type: z.literal("interact") })
    .strict(),
  z.object({ targetKey: IdSchema, type: z.literal("defend") }).strict(),
  z.object({ factionKey: IdSchema, locationKey: IdSchema, type: z.literal("rally") }).strict(),
  z.object({ type: z.literal("wait") }).strict(),
]);

const DiscoverableFactSchema = z
  .object({
    actionTypes: z
      .array(z.enum(["investigate", "interact", "defend", "use_item", "use_skill"]))
      .min(1)
      .max(5),
    certainty: z.enum(["certain", "likely", "uncertain"]),
    claim: ShortTextSchema,
    key: IdSchema,
    ownerRole: SupportingRoleSchema.nullable(),
    source: ShortTextSchema,
    subjectKeys: z.array(IdSchema).min(1).max(8),
    visibility: z.enum(["public", "private", "observed", "rumor"]),
  })
  .strict();

const MilestoneSchema = z
  .object({
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
      .min(2)
      .max(8),
    description: ShortTextSchema,
  })
  .strict();

export const StoryGenesisCandidateV1Schema = z
  .object({
    calendarName: ShortTextSchema,
    discoverableFacts: z.array(DiscoverableFactSchema).min(4).max(24),
    endingConstraints: z.array(ShortTextSchema).min(1).max(6),
    factions: z.array(CandidateFactionSchema).min(3).max(6),
    guidanceCoverage: z
      .array(
        z
          .object({
            canonPaths: z.array(ShortTextSchema).min(1).max(8),
            requirementId: IdSchema,
          })
          .strict(),
      )
      .max(12),
    locations: z.array(CandidateLocationSchema).min(5).max(9),
    milestones: z.array(MilestoneSchema).length(7),
    opening: z
      .object({
        action: CandidateActionSchema,
        actionDescription: ShortTextSchema,
        incident: ShortTextSchema,
        locationKey: IdSchema,
        pressure: ShortTextSchema,
      })
      .strict(),
    protagonist: z
      .object({
        beliefs: z.array(ShortTextSchema).min(1).max(6),
        className: ShortTextSchema,
        generatedName: ShortTextSchema,
        goals: z.array(ShortTextSchema).min(1).max(4),
        inventory: z.array(CandidateItemSchema).max(6),
        pastLifeName: ShortTextSchema,
        plan: z.array(ShortTextSchema).min(1).max(4),
        publicRole: ShortTextSchema,
      })
      .strict(),
    skills: z.array(CandidateSkillSchema).length(2),
    supportingCharacters: z.array(CandidateSupportingCharacterSchema).length(5),
    system: z
      .object({
        focus: ShortTextSchema,
        name: ShortTextSchema,
        rules: z.array(ShortTextSchema).min(2).max(8),
      })
      .strict(),
    threat: ShortTextSchema,
  })
  .strict()
  .superRefine((candidate, context) => {
    const duplicateKeys =
      !uniqueByKey(candidate.locations) ||
      !uniqueByKey(candidate.factions) ||
      !uniqueByKey(candidate.discoverableFacts) ||
      !uniqueByKey(candidate.skills);
    if (duplicateKeys) {
      context.addIssue({
        code: "custom",
        message: "Candidate keys must be unique within each collection",
      });
    }
    const suppliedRoles = candidate.supportingCharacters.map(({ role }) => role);
    if (new Set(suppliedRoles).size !== 5) {
      const missingRoles = SupportingRoleSchema.options.filter(
        (role) => !suppliedRoles.includes(role),
      );
      const duplicateRoles = [
        ...new Set(suppliedRoles.filter((role, index) => suppliedRoles.indexOf(role) !== index)),
      ];
      context.addIssue({
        code: "custom",
        message: `Supporting roles require exactly one each of general, hero, prince, rival, and saint. Missing: ${missingRoles.join(", ") || "none"}. Duplicated: ${duplicateRoles.join(", ") || "none"}.`,
        path: ["supportingCharacters"],
      });
    }
    const names = [
      candidate.protagonist.generatedName,
      candidate.protagonist.pastLifeName,
      ...candidate.supportingCharacters.map(({ name }) => name),
    ].map((name) => name.toLocaleLowerCase("en"));
    if (new Set(names).size !== names.length) {
      context.addIssue({ code: "custom", message: "Generated character names must be unique" });
    }
  });

export const StoryGenesisAuditV1Schema = z
  .object({
    approved: z.boolean(),
    issues: z.array(ShortTextSchema).max(12),
    unmetGuidance: z.array(ShortTextSchema).max(12),
  })
  .strict()
  .superRefine((audit, context) => {
    if (audit.approved !== (audit.issues.length === 0 && audit.unmetGuidance.length === 0)) {
      context.addIssue({ code: "custom", message: "Genesis audit approval and issues disagree" });
    }
  });

export const StoryGenesisRecordV1Schema = z
  .object({
    audit: StoryGenesisAuditV1Schema,
    candidate: StoryGenesisCandidateV1Schema,
    calls: z
      .array(
        z
          .object({
            estimatedCostUsd: z.number().min(0),
            latencyMs: z.number().int().min(0),
            model: z.enum(["gpt-5.6-sol", "gpt-5.6-terra"]),
            phase: z.enum(["candidate", "audit"]),
            responseId: z.string().min(1).max(240),
            usage: z
              .object({
                cacheWriteTokens: z.number().int().min(0),
                cachedInputTokens: z.number().int().min(0),
                inputTokens: z.number().int().min(0),
                outputTokens: z.number().int().min(0),
                reasoningTokens: z.number().int().min(0),
                totalTokens: z.number().int().min(0),
              })
              .strict(),
          })
          .strict(),
      )
      .min(2)
      .max(6),
    initialWorld: WorldStateSchema,
    openingAction: IntentActionSchema,
    openingActionDescription: ShortTextSchema,
    setup: StorySetupSchema,
    setupHash: z.string().regex(/^[a-f0-9]{64}$/u),
    version: z.literal("1.0.0"),
    worldHash: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

export type StoryGenesisAuditV1 = z.infer<typeof StoryGenesisAuditV1Schema>;
export type StoryGenesisCandidateV1 = z.infer<typeof StoryGenesisCandidateV1Schema>;
export type StoryGenesisRecordV1 = z.infer<typeof StoryGenesisRecordV1Schema>;
