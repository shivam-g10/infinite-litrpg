import { z } from "zod";

import {
  CharacterIdSchema,
  ChapterNumberSchema,
  CONTRACT_VERSION,
  HashSchema,
  IdSchema,
  ShortTextSchema,
  WorldVersionSchema,
} from "./primitives";
import { IntentActionSchema, PlayerActionSchema } from "./intent";
import { UsageSchema } from "./trace";

export const ChoiceSchema = z
  .object({
    action: IntentActionSchema,
    description: ShortTextSchema,
    id: z.string().regex(/^choice-[12]$/u),
    milestoneId: IdSchema.nullable(),
  })
  .strict();

export const ChapterDraftSchema = z
  .object({
    choices: z.array(ChoiceSchema).max(2),
    contractVersion: z.literal(CONTRACT_VERSION),
    prose: z.string().trim().min(1).max(20_000),
    terminal: z.boolean(),
    title: ShortTextSchema,
  })
  .strict()
  .superRefine(({ choices, prose, terminal }, context) => {
    const wordCount = prose.trim().split(/\s+/u).filter(Boolean).length;
    if (wordCount < 900 || wordCount > 1_300) {
      context.addIssue({
        code: "custom",
        message: `Chapter prose must contain 900 to 1300 words; received ${wordCount}`,
        path: ["prose"],
      });
    }
    if (terminal ? choices.length !== 0 : choices.length !== 2) {
      context.addIssue({
        code: "custom",
        message: terminal
          ? "Terminal chapter cannot offer choices"
          : "Nonterminal chapter needs two choices",
        path: ["choices"],
      });
    }
  });

export const ChapterFrameSchema = z
  .object({
    choices: z.array(ChoiceSchema).max(2),
    terminal: z.boolean(),
    title: ShortTextSchema,
  })
  .strict()
  .superRefine(({ choices, terminal }, context) => {
    if (terminal ? choices.length !== 0 : choices.length !== 2) {
      context.addIssue({
        code: "custom",
        message: terminal
          ? "Terminal frame cannot offer choices"
          : "Nonterminal frame needs two choices",
        path: ["choices"],
      });
    }
  });

const NarrativeScoreSchema = z.number().int().min(0).max(2);

export const NARRATIVE_AUDIT_DIMENSIONS = [
  "choiceFulfillment",
  "characterAutonomy",
  "povSafety",
  "litrpgMechanics",
  "continuity",
  "arcProgress",
  "prose",
] as const;

export const NARRATIVE_AUDIT_ISSUE_CODES = [
  "pass",
  "choice-not-fulfilled",
  "autonomy-violation",
  "hidden-knowledge",
  "mechanics-mismatch",
  "contradiction",
  "unsupported-canon",
  "arc-stalled",
  "prose-quality",
] as const;

const NarrativeAuditEvidenceSchema = z
  .object({
    detail: ShortTextSchema,
    dimension: z.enum(NARRATIVE_AUDIT_DIMENSIONS),
    issueCode: z.enum(NARRATIVE_AUDIT_ISSUE_CODES),
  })
  .strict();

export const NarrativeAuditSchema = z
  .object({
    approved: z.boolean(),
    evidence: z.array(NarrativeAuditEvidenceSchema).length(NARRATIVE_AUDIT_DIMENSIONS.length),
    leakedFactIds: z.array(IdSchema).max(20),
    proseHash: HashSchema,
    scores: z
      .object({
        arcProgress: NarrativeScoreSchema,
        characterAutonomy: NarrativeScoreSchema,
        choiceFulfillment: NarrativeScoreSchema,
        continuity: NarrativeScoreSchema,
        litrpgMechanics: NarrativeScoreSchema,
        povSafety: NarrativeScoreSchema,
        prose: NarrativeScoreSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine(({ approved, evidence, leakedFactIds, scores }, context) => {
    const hardZero =
      scores.continuity === 0 ||
      scores.litrpgMechanics === 0 ||
      scores.povSafety === 0 ||
      scores.arcProgress === 0;
    if (approved && (hardZero || leakedFactIds.length > 0)) {
      context.addIssue({
        code: "custom",
        message: "Audit cannot approve a hard-zero score or leaked fact",
        path: ["approved"],
      });
    }
    NARRATIVE_AUDIT_DIMENSIONS.forEach((dimension, index) => {
      const item = evidence[index];
      if (!item || item.dimension !== dimension) {
        context.addIssue({
          code: "custom",
          message: `Audit evidence ${index} must describe ${dimension}`,
          path: ["evidence", index, "dimension"],
        });
      }
      if (scores[dimension] === 0 && item?.issueCode === "pass") {
        context.addIssue({
          code: "custom",
          message: `Audit zero for ${dimension} requires a failure issue code`,
          path: ["evidence", index, "issueCode"],
        });
      }
    });
  });

export const ChapterRecordSchema = z
  .object({
    chapter: ChapterNumberSchema,
    choices: z.array(ChoiceSchema).max(2),
    estimatedCostUsd: z.number().min(0).max(3),
    id: z.string().regex(/^chapter-[0-9]{3}$/u),
    latencyMs: z.number().int().min(0),
    narrativeAudit: NarrativeAuditSchema,
    playerAction: PlayerActionSchema,
    povCharacterId: CharacterIdSchema,
    prose: z.string().trim().min(1).max(20_000),
    proseHash: HashSchema,
    requestId: z.string().uuid().optional(),
    safeContextHash: HashSchema,
    stateAfterVersion: WorldVersionSchema,
    stateBeforeVersion: WorldVersionSchema,
    terminal: z.boolean(),
    title: ShortTextSchema,
    traceId: z.string().uuid(),
    usage: UsageSchema,
  })
  .strict()
  .superRefine(({ choices, narrativeAudit, prose, terminal }, context) => {
    const wordCount = prose.trim().split(/\s+/u).filter(Boolean).length;
    if (wordCount < 900 || wordCount > 1_300) {
      context.addIssue({
        code: "custom",
        message: `Committed prose must contain 900 to 1300 words; received ${wordCount}`,
        path: ["prose"],
      });
    }
    if (terminal ? choices.length !== 0 : choices.length !== 2) {
      context.addIssue({
        code: "custom",
        message: "Committed choices disagree with terminal state",
        path: ["choices"],
      });
    }
    if (!narrativeAudit.approved) {
      context.addIssue({
        code: "custom",
        message: "Rejected narrative cannot be committed",
        path: ["narrativeAudit", "approved"],
      });
    }
  });

export type ChapterDraft = z.infer<typeof ChapterDraftSchema>;
export type ChapterFrame = z.infer<typeof ChapterFrameSchema>;
export type ChapterRecord = z.infer<typeof ChapterRecordSchema>;
export type Choice = z.infer<typeof ChoiceSchema>;
export type NarrativeAudit = z.infer<typeof NarrativeAuditSchema>;
