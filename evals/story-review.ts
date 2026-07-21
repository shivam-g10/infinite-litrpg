import { createHash, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  CHARACTER_IDS,
  ChapterRecordSchema,
  NARRATIVE_AUDIT_DIMENSIONS,
  PROMPT_VERSION,
  PUBLIC_CHARACTERS,
  RUNTIME_SCHEMA_VERSION,
  TraceEnvelopeSchema,
  WorldDeltaSchema,
  WorldStateSchema,
  buildPovContext,
  stageWorldDelta,
  type CharacterId,
  type ChapterRecord,
  type TraceEnvelope,
} from "@infinite-litrpg/shared";
import Database from "better-sqlite3";
import { z } from "zod";

import { FLEX_PRICING_VERSION, estimateResponseCostUsd } from "../app/src/server/openai/usage";
import {
  REVIEW_STORY_MODELS,
  initialChoices,
  loadSeedWorld,
} from "../app/src/server/story/story-service";
import {
  STORY_QUALITY_EVAL_VERSION,
  evaluateStoryQuality,
  loadStoryQualityStoryFromDatabase,
  type StoryQualityEvaluation,
} from "./story-quality";

export const STORY_REVIEW_SCHEMA_VERSION = "1.5.0-story-review" as const;
export const STORY_REVIEW_BRANCH_POLICY = "director-ranked-with-final-feasibility-guard" as const;
export const STORY_REVIEW_CHAPTERS_PER_STORY = 10 as const;
// Kept only to authenticate and recover the existing capped ledger lineage.
export const STORY_REVIEW_CHAPTER_CAP_USD = 0.0848 as const;
export const STORY_REVIEW_TOTAL_CAP_USD = 5.088 as const;
export const STORY_REVIEW_HISTORICAL_LEDGER_CAP_USD = STORY_REVIEW_TOTAL_CAP_USD;
export const STORY_REVIEW_TOTAL_CHAPTERS = CHARACTER_IDS.length * STORY_REVIEW_CHAPTERS_PER_STORY;
export const STORY_REVIEW_REQUIRED_QUALITY_GATE_COUNT = 33 as const;
export const STORY_REVIEW_VARIANT_CONFIG = {
  branchPolicy: STORY_REVIEW_BRANCH_POLICY,
  costLimitEnabled: false,
  enforceNarrativeQuality: true,
  modelRouting: REVIEW_STORY_MODELS,
  proseLengthLimitEnabled: false,
  promptVersion: PROMPT_VERSION,
  providerOutputLimitRequested: false,
  schemaVersion: STORY_REVIEW_SCHEMA_VERSION,
  storyQualityEvalVersion: STORY_QUALITY_EVAL_VERSION,
  storyQualityGateCount: STORY_REVIEW_REQUIRED_QUALITY_GATE_COUNT,
} as const;
export const STORY_REVIEW_VARIANT_CONFIG_SHA256 = sha256(
  JSON.stringify(STORY_REVIEW_VARIANT_CONFIG),
);
export const STORY_REVIEW_SOURCE_BRIDGE_FROM_GIT_SHA =
  "c7a1ae9a9fe2cdac505a10c614dec482c430c0ac" as const;
export const STORY_REVIEW_SOURCE_BRIDGE_INTERMEDIATE_GIT_SHA =
  "d5b8c0ada466cf947fc960451b5b61c6b15458a0" as const;
export const STORY_REVIEW_SOURCE_VARIANT_CONFIG_SHA256 =
  "d5d0a5b85b8b48acaa4e04bd7eb53504ba334baafae774043a1ef9b7372c9639" as const;
export const STORY_REVIEW_SOURCE_BRIDGE_PATHS = [
  ".env.example",
  "AGENTS.md",
  "LOOP.md",
  "README.md",
  "app/e2e/story.spec.ts",
  "app/src/app/api/health/route.ts",
  "app/src/components/character-selection.tsx",
  "app/src/components/story-app.test.ts",
  "app/src/components/story-app.tsx",
  "app/src/components/story-shell.tsx",
  "app/src/components/story-types.test.ts",
  "app/src/components/story-types.ts",
  "app/src/server/env.ts",
  "app/src/server/openai/luna.test.ts",
  "app/src/server/openai/luna.ts",
  "app/src/server/openai/models.ts",
  "app/src/server/openai/policy.test.ts",
  "app/src/server/openai/policy.ts",
  "app/src/server/openai/stable.test.ts",
  "app/src/server/openai/stable.ts",
  "app/src/server/openai/usage.test.ts",
  "app/src/server/story/prompts.test.ts",
  "app/src/server/story/prompts.ts",
  "app/src/server/story/runtime.ts",
  "app/src/server/story/story-service.test.ts",
  "app/src/server/story/story-service.ts",
  "decisions/ADR-023-unbounded-generation-and-fixed-quality-bar.md",
  "docs/ARCHITECTURE.md",
  "docs/HUMAN_REVIEW.md",
  "docs/PLAN.md",
  "docs/SAMPLE_STORIES.md",
  "docs/STATUS.md",
  "docs/SUBMISSION.md",
  "docs/story-review-evidence.json",
  "evals/README.md",
  "evals/RUBRIC.md",
  "evals/live-spend-ledger.test.ts",
  "evals/live-spend-ledger.ts",
  "evals/recover-story-review.ts",
  "evals/run-live.ts",
  "evals/run-story-review.ts",
  "evals/story-quality.test.ts",
  "evals/story-quality.ts",
  "evals/story-review-variant.ts",
  "evals/story-review.test.ts",
  "evals/story-review.ts",
  "research/2026-07-21-litrpg-good-enough.md",
  "scripts/export-sample-stories.test.ts",
  "scripts/export-sample-stories.ts",
  "shared/src/contracts/chapter.test.ts",
  "shared/src/contracts/chapter.ts",
  "shared/src/contracts/primitives.ts",
  "shared/src/contracts/trace.test.ts",
  "shared/src/contracts/trace.ts",
  "shared/src/engine/narrative-quality.test.ts",
  "shared/src/engine/narrative-quality.ts",
  "vitest.config.ts",
] as const;
export const STORY_REVIEW_GIT_BRIDGE_PATHS = [
  "README.md",
  "docs/HUMAN_REVIEW.md",
  "docs/PLAN.md",
  "docs/SAMPLE_STORIES.md",
  "docs/STATUS.md",
  "docs/SUBMISSION.md",
  "docs/evidence/non-live-gates.md",
  "docs/story-review-evidence.json",
  "evals/README.md",
] as const;

const MONEY_EPSILON_USD = 0.000_000_001;
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const GitShaSchema = z.string().regex(/^[a-f0-9]{7,40}$/u);
const CharacterIdSchema = z.enum(CHARACTER_IDS);
const CurrentVariantHashSchema = Sha256Schema.refine(
  (value) => value === STORY_REVIEW_VARIANT_CONFIG_SHA256,
  "Story-review variant config hash does not match current code",
);

const StoryReviewVariantArchiveReferenceV1Schema = z
  .object({
    archiveDirectory: z.string().regex(/^[a-f0-9]{40}-to-[a-f0-9]{40}$/u),
    carriedExposureUsd: z.number().nonnegative(),
    fromSourceGitSha: GitShaSchema,
    manifestSha256: Sha256Schema,
    reason: z.literal("narration-route-reversal-and-repetitive-branching"),
    toSourceGitSha: GitShaSchema,
    variantConfigSha256: Sha256Schema,
  })
  .strict();

const StoryReviewVariantArchiveReferenceV2Schema = z
  .object({
    archiveDirectory: z.string().regex(/^[a-f0-9]{40}-to-[a-f0-9]{40}$/u),
    carriedExposureUsd: z.number().nonnegative(),
    fromSourceGitSha: GitShaSchema,
    lineageDepth: z.number().int().min(2).max(32),
    manifestSha256: Sha256Schema,
    parentManifestSha256: Sha256Schema,
    parentMarkerSha256: Sha256Schema,
    reason: z.literal("human-rejected-progression-and-canon-quality"),
    toSourceGitSha: GitShaSchema,
    variantConfigSha256: Sha256Schema,
  })
  .strict();

export const StoryReviewVariantArchiveReferenceSchema = z.union([
  StoryReviewVariantArchiveReferenceV1Schema,
  StoryReviewVariantArchiveReferenceV2Schema,
]);
export type StoryReviewVariantArchiveReference = z.infer<
  typeof StoryReviewVariantArchiveReferenceSchema
>;

export const StoryReviewSourceBridgeSchema = z
  .object({
    changedPaths: z.array(z.enum(STORY_REVIEW_SOURCE_BRIDGE_PATHS)),
    diffSha256: Sha256Schema,
    fromSourceGitSha: z.literal(STORY_REVIEW_SOURCE_BRIDGE_FROM_GIT_SHA),
    fromVariantConfigSha256: z.literal(STORY_REVIEW_SOURCE_VARIANT_CONFIG_SHA256),
    intermediateSourceGitSha: z.literal(STORY_REVIEW_SOURCE_BRIDGE_INTERMEDIATE_GIT_SHA),
    reason: z.literal("unbounded-generation-and-fixed-quality-bar"),
    toSourceGitSha: GitShaSchema,
    toVariantConfigSha256: CurrentVariantHashSchema,
  })
  .strict()
  .superRefine((bridge, context) => {
    if (
      bridge.changedPaths.length !== STORY_REVIEW_SOURCE_BRIDGE_PATHS.length ||
      bridge.changedPaths.some((path, index) => path !== STORY_REVIEW_SOURCE_BRIDGE_PATHS[index])
    ) {
      context.addIssue({
        code: "custom",
        message: "Story-review source bridge paths do not match the approved hotfix",
        path: ["changedPaths"],
      });
    }
    if (
      bridge.toSourceGitSha === bridge.fromSourceGitSha ||
      bridge.toSourceGitSha === bridge.intermediateSourceGitSha
    ) {
      context.addIssue({
        code: "custom",
        message: "Story-review source bridge must advance Git history",
        path: ["toSourceGitSha"],
      });
    }
  });
export type StoryReviewSourceBridge = z.infer<typeof StoryReviewSourceBridgeSchema>;

export function buildStoryReviewSourceBridge(input: {
  readonly changedPaths: readonly string[];
  readonly diffSha256: string;
  readonly fromSourceGitSha: string;
  readonly intermediateSourceGitSha: string;
  readonly toSourceGitSha: string;
}): StoryReviewSourceBridge {
  return StoryReviewSourceBridgeSchema.parse({
    ...input,
    changedPaths: [...input.changedPaths],
    fromVariantConfigSha256: STORY_REVIEW_SOURCE_VARIANT_CONFIG_SHA256,
    reason: "unbounded-generation-and-fixed-quality-bar",
    toVariantConfigSha256: STORY_REVIEW_VARIANT_CONFIG_SHA256,
  });
}

const StoryReviewChapterSchema = z
  .object({
    adapterMode: z.literal("sequential"),
    auditApproved: z.literal(true),
    chapter: z.number().int().min(1).max(STORY_REVIEW_CHAPTERS_PER_STORY),
    chapterRecordHash: Sha256Schema,
    chosenAction: z.string().trim().min(1).max(240),
    costUsd: z.number().nonnegative(),
    prose: z.string().min(1),
    proseHash: Sha256Schema,
    promptVersion: z.literal(PROMPT_VERSION),
    responseIds: z.array(z.string().regex(/^resp?_[A-Za-z0-9_-]+$/u)).min(1),
    serviceTier: z.literal("flex"),
    sourceGitSha: GitShaSchema,
    title: z.string().min(1).max(200),
    traceHash: Sha256Schema,
    wordCount: z.number().int().positive(),
    worldVersionAfter: z.number().int().positive(),
    worldVersionBefore: z.number().int().positive(),
  })
  .strict()
  .superRefine((chapter, context) => {
    if (sha256(chapter.prose) !== chapter.proseHash) {
      context.addIssue({ code: "custom", message: "Chapter prose hash does not match prose" });
    }
    if (chapter.worldVersionAfter !== chapter.worldVersionBefore + 1) {
      context.addIssue({
        code: "custom",
        message: "Chapter world versions must advance exactly once",
      });
    }
    if (
      chapter.worldVersionBefore !== chapter.chapter ||
      chapter.worldVersionAfter !== chapter.chapter + 1
    ) {
      context.addIssue({
        code: "custom",
        message: "Review chapters must start from one fresh world-version chain",
      });
    }
  });

const StoryReviewStorySchema = z
  .object({
    chapters: z.array(StoryReviewChapterSchema).length(STORY_REVIEW_CHAPTERS_PER_STORY),
    characterId: CharacterIdSchema,
  })
  .strict()
  .superRefine((story, context) => {
    for (let index = 0; index < STORY_REVIEW_CHAPTERS_PER_STORY; index += 1) {
      const chapter = story.chapters[index];
      if (chapter?.chapter !== index + 1) {
        context.addIssue({
          code: "custom",
          message: "Story chapters must be contiguous from 1 through 10",
          path: ["chapters", index, "chapter"],
        });
      }
      if (index > 0) {
        const prior = story.chapters[index - 1];
        if (prior && chapter && prior.worldVersionAfter !== chapter.worldVersionBefore) {
          context.addIssue({
            code: "custom",
            message: "Story world versions must stay contiguous between chapters",
            path: ["chapters", index, "worldVersionBefore"],
          });
        }
      }
    }
  });

export const StoryReviewEvidenceSchema = z
  .object({
    branchPolicy: z.literal(STORY_REVIEW_BRANCH_POLICY),
    chaptersPerStory: z.literal(STORY_REVIEW_CHAPTERS_PER_STORY),
    committedChapterCostUsd: z.number().nonnegative(),
    costLimitEnabled: z.literal(false),
    durableExposureUsd: z.number().nonnegative(),
    generatedAt: z.string().datetime({ offset: true }),
    priorVariantExposureUsd: z.number().nonnegative(),
    promptVersion: z.literal(PROMPT_VERSION),
    qualityVariantArchive: StoryReviewVariantArchiveReferenceSchema,
    schemaVersion: z.literal(STORY_REVIEW_SCHEMA_VERSION),
    serviceTier: z.literal("flex"),
    sourceGitSha: GitShaSchema,
    sourceBridge: StoryReviewSourceBridgeSchema.optional(),
    stories: z.array(StoryReviewStorySchema).length(CHARACTER_IDS.length),
    variantConfigSha256: CurrentVariantHashSchema,
  })
  .strict()
  .superRefine((evidence, context) => {
    const chapterRecordHashes = new Set<string>();
    const responseIds = new Set<string>();
    const traceHashes = new Set<string>();
    for (let index = 0; index < CHARACTER_IDS.length; index += 1) {
      if (evidence.stories[index]?.characterId !== CHARACTER_IDS[index]) {
        context.addIssue({
          code: "custom",
          message: "Review stories must use the canonical six-character order",
          path: ["stories", index, "characterId"],
        });
      }
    }
    for (const [storyIndex, story] of evidence.stories.entries()) {
      for (const [chapterIndex, chapter] of story.chapters.entries()) {
        if (chapter.sourceGitSha !== evidence.sourceGitSha) {
          context.addIssue({
            code: "custom",
            message: "Chapter source Git SHA does not match review evidence",
            path: ["stories", storyIndex, "chapters", chapterIndex, "sourceGitSha"],
          });
        }
        if (chapterRecordHashes.has(chapter.chapterRecordHash)) {
          context.addIssue({
            code: "custom",
            message: "Chapter record hashes must be unique across the review pack",
            path: ["stories", storyIndex, "chapters", chapterIndex, "chapterRecordHash"],
          });
        }
        chapterRecordHashes.add(chapter.chapterRecordHash);
        if (traceHashes.has(chapter.traceHash)) {
          context.addIssue({
            code: "custom",
            message: "Trace hashes must be unique across the review pack",
            path: ["stories", storyIndex, "chapters", chapterIndex, "traceHash"],
          });
        }
        traceHashes.add(chapter.traceHash);
        for (const responseId of chapter.responseIds) {
          if (responseIds.has(responseId)) {
            context.addIssue({
              code: "custom",
              message: "Response IDs must be unique across the review pack",
              path: ["stories", storyIndex, "chapters", chapterIndex, "responseIds"],
            });
          }
          responseIds.add(responseId);
        }
      }
    }
    const chapterCost = evidence.stories
      .flatMap(({ chapters }) => chapters)
      .reduce((sum, chapter) => sum + chapter.costUsd, 0);
    if (Math.abs(chapterCost - evidence.committedChapterCostUsd) > MONEY_EPSILON_USD) {
      context.addIssue({
        code: "custom",
        message: "Committed chapter cost does not match the sixty chapters",
        path: ["committedChapterCostUsd"],
      });
    }
    if (evidence.durableExposureUsd + MONEY_EPSILON_USD < evidence.committedChapterCostUsd) {
      context.addIssue({
        code: "custom",
        message: "Durable exposure cannot be lower than committed chapter cost",
        path: ["durableExposureUsd"],
      });
    }
    const archiveSourceGitSha = evidence.sourceBridge?.fromSourceGitSha ?? evidence.sourceGitSha;
    const archiveVariantConfigSha256 =
      evidence.sourceBridge?.fromVariantConfigSha256 ?? evidence.variantConfigSha256;
    if (
      evidence.qualityVariantArchive.toSourceGitSha !== archiveSourceGitSha ||
      (evidence.sourceBridge !== undefined &&
        evidence.sourceBridge.toSourceGitSha !== evidence.sourceGitSha) ||
      (evidence.sourceBridge !== undefined &&
        evidence.sourceBridge.toVariantConfigSha256 !== evidence.variantConfigSha256) ||
      evidence.qualityVariantArchive.variantConfigSha256 !== archiveVariantConfigSha256 ||
      evidence.qualityVariantArchive.carriedExposureUsd >
        evidence.durableExposureUsd + MONEY_EPSILON_USD
    ) {
      context.addIssue({
        code: "custom",
        message: "Quality-variant archive does not match the review evidence lineage",
        path: ["qualityVariantArchive"],
      });
    }
    if (
      Math.abs(
        evidence.qualityVariantArchive.carriedExposureUsd - evidence.priorVariantExposureUsd,
      ) > MONEY_EPSILON_USD
    ) {
      context.addIssue({
        code: "custom",
        message: "Prior variant exposure must match its archive reference",
        path: ["priorVariantExposureUsd"],
      });
    }
  });

const StoryReviewSourceChapterSchema = z
  .object({
    chapterRecord: ChapterRecordSchema,
    trace: TraceEnvelopeSchema,
    worldDelta: WorldDeltaSchema,
  })
  .strict();

const StoryReviewSourceStorySchema = z
  .object({
    chapters: z.array(StoryReviewSourceChapterSchema).length(STORY_REVIEW_CHAPTERS_PER_STORY),
    characterId: CharacterIdSchema,
    finalState: WorldStateSchema,
  })
  .strict();

export const StoryReviewSourceEvidenceSchema = z
  .object({
    branchPolicy: z.literal(STORY_REVIEW_BRANCH_POLICY),
    chaptersPerStory: z.literal(STORY_REVIEW_CHAPTERS_PER_STORY),
    costLimitEnabled: z.literal(false),
    durableExposureUsd: z.number().nonnegative(),
    generatedAt: z.string().datetime({ offset: true }),
    priorVariantExposureUsd: z.number().nonnegative(),
    promptVersion: z.literal(PROMPT_VERSION),
    qualityVariantArchive: StoryReviewVariantArchiveReferenceSchema,
    schemaVersion: z.literal(STORY_REVIEW_SCHEMA_VERSION),
    serviceTier: z.literal("flex"),
    sourceGitSha: GitShaSchema,
    sourceBridge: StoryReviewSourceBridgeSchema.optional(),
    stories: z.array(StoryReviewSourceStorySchema).length(CHARACTER_IDS.length),
    variantConfigSha256: CurrentVariantHashSchema,
  })
  .strict()
  .superRefine((evidence, context) => {
    const archiveSourceGitSha = evidence.sourceBridge?.fromSourceGitSha ?? evidence.sourceGitSha;
    const archiveVariantConfigSha256 =
      evidence.sourceBridge?.fromVariantConfigSha256 ?? evidence.variantConfigSha256;
    if (
      evidence.qualityVariantArchive.toSourceGitSha !== archiveSourceGitSha ||
      (evidence.sourceBridge !== undefined &&
        evidence.sourceBridge.toSourceGitSha !== evidence.sourceGitSha) ||
      (evidence.sourceBridge !== undefined &&
        evidence.sourceBridge.toVariantConfigSha256 !== evidence.variantConfigSha256) ||
      evidence.qualityVariantArchive.variantConfigSha256 !== archiveVariantConfigSha256 ||
      evidence.qualityVariantArchive.carriedExposureUsd >
        evidence.durableExposureUsd + MONEY_EPSILON_USD
    ) {
      context.addIssue({
        code: "custom",
        message: "Quality-variant archive does not match the source evidence lineage",
        path: ["qualityVariantArchive"],
      });
    }
    if (
      Math.abs(
        evidence.qualityVariantArchive.carriedExposureUsd - evidence.priorVariantExposureUsd,
      ) > MONEY_EPSILON_USD
    ) {
      context.addIssue({
        code: "custom",
        message: "Prior variant exposure must match its archive reference",
        path: ["priorVariantExposureUsd"],
      });
    }
  });

export type StoryReviewEvidence = z.infer<typeof StoryReviewEvidenceSchema>;
export type StoryReviewStory = z.infer<typeof StoryReviewStorySchema>;
export type StoryReviewSourceEvidence = z.infer<typeof StoryReviewSourceEvidenceSchema>;
export type StoryReviewSourceStory = z.infer<typeof StoryReviewSourceStorySchema>;

export interface StoryReviewArgs {
  readonly confirmUnboundedCost: boolean;
  readonly finalizeOnly: boolean;
  readonly preflightOnly: boolean;
}

export interface StoryReviewPreflight {
  readonly byCharacter: Readonly<Record<CharacterId, number>>;
  readonly completedChapters: number;
  readonly costLimitEnabled: false;
  readonly durableExposureUsd: number;
  readonly remainingChapters: number;
}

export function buildStoryReviewPreflight(
  byCharacter: Readonly<Record<CharacterId, number>>,
  durableExposureUsd: number,
): StoryReviewPreflight {
  for (const characterId of CHARACTER_IDS) {
    const chapterCount = byCharacter[characterId];
    if (
      !Number.isSafeInteger(chapterCount) ||
      chapterCount < 0 ||
      chapterCount > STORY_REVIEW_CHAPTERS_PER_STORY
    ) {
      throw new Error(`${characterId} story-review chapter count is invalid`);
    }
  }
  const completedChapters = CHARACTER_IDS.reduce(
    (sum, characterId) => sum + byCharacter[characterId],
    0,
  );
  if (!Number.isFinite(durableExposureUsd) || durableExposureUsd < 0) {
    throw new Error("Story review durable exposure must be finite and nonnegative");
  }
  const remainingChapters = STORY_REVIEW_TOTAL_CHAPTERS - completedChapters;
  return {
    byCharacter,
    completedChapters,
    costLimitEnabled: false,
    durableExposureUsd: roundMoney(durableExposureUsd),
    remainingChapters,
  };
}

export function buildStoryReviewChapter(
  characterId: CharacterId,
  chapterCandidate: unknown,
  traceCandidate: unknown,
): z.infer<typeof StoryReviewChapterSchema> {
  const chapter = ChapterRecordSchema.parse(chapterCandidate);
  const trace = TraceEnvelopeSchema.parse(traceCandidate);
  if (chapter.povCharacterId !== characterId) {
    throw new Error(`Committed chapter viewpoint does not match ${characterId}`);
  }
  if (
    chapter.playerAction.actorId !== characterId ||
    chapter.playerAction.stateVersion !== chapter.stateBeforeVersion
  ) {
    throw new Error("Committed chapter player action does not match its viewpoint or version");
  }
  if (
    chapter.traceId !== trace.runId ||
    trace.gateResult !== "passed" ||
    trace.validationFailures.length > 0 ||
    trace.adapterMode !== "sequential"
  ) {
    throw new Error("Committed chapter does not have one matching passed trace");
  }
  if (
    trace.schemaVersion !== RUNTIME_SCHEMA_VERSION ||
    trace.pricingVersion !== FLEX_PRICING_VERSION
  ) {
    throw new Error("Committed chapter trace uses the wrong runtime schema or Flex pricing");
  }
  if (
    trace.calls.some(
      (call) => call.requestedServiceTier !== "flex" || call.serviceTier !== "flex",
    ) ||
    trace.attempts.some(
      (attempt) =>
        attempt.requestedServiceTier !== "flex" ||
        (attempt.responseId !== null && attempt.serviceTier !== "flex"),
    )
  ) {
    throw new Error("Story-review chapter must have complete Flex service-tier evidence");
  }
  if (
    chapter.estimatedCostUsd !== trace.totalEstimatedCostUsd ||
    !isDeepStrictEqual(chapter.usage, trace.totalUsage)
  ) {
    throw new Error("Committed chapter usage or cost does not match its trace");
  }
  if (trace.attempts.length === 0) {
    throw new Error("Committed trace lacks runtime attempts");
  }
  const attemptCostUsd = trace.attempts.reduce((sum, attempt) => sum + attempt.costUsd, 0);
  const attemptUsage = trace.attempts.reduce(
    (sum, attempt) => addUsage(sum, attempt.usage),
    emptyUsage(),
  );
  if (
    Math.abs(attemptCostUsd - trace.totalEstimatedCostUsd) > MONEY_EPSILON_USD ||
    !isDeepStrictEqual(attemptUsage, trace.totalUsage)
  ) {
    throw new Error("Committed trace totals do not match its runtime attempts");
  }
  for (const attempt of trace.attempts) {
    if (attempt.serviceTier === "flex") {
      const pricedCostUsd = estimateResponseCostUsd(attempt.model, attempt.usage, {
        serviceTier: "flex",
      });
      if (Math.abs(pricedCostUsd - attempt.costUsd) > MONEY_EPSILON_USD) {
        throw new Error("Committed trace attempt is not priced from returned Flex usage");
      }
    }
  }
  validateCallAttemptGroups(trace);
  const acceptedPlayerIntents = trace.intents.filter(
    (intent) =>
      intent.actorId === characterId && trace.acceptedDelta.acceptedIntentIds.includes(intent.id),
  );
  if (
    acceptedPlayerIntents.length !== 1 ||
    acceptedPlayerIntents[0]?.stateVersion !== chapter.stateBeforeVersion ||
    acceptedPlayerIntents[0]?.goal !== chapter.playerAction.description ||
    !isDeepStrictEqual(acceptedPlayerIntents[0]?.action, chapter.playerAction.action)
  ) {
    throw new Error("Committed chapter action does not match its accepted player intent");
  }
  if (
    trace.acceptedDelta.expectedWorldVersion !== chapter.stateBeforeVersion ||
    trace.acceptedDelta.clock.fromChapter !== chapter.chapter - 1 ||
    trace.acceptedDelta.clock.toChapter !== chapter.chapter ||
    trace.acceptedDelta.clock.terminal !== chapter.terminal ||
    !trace.calls.some(({ phase }) => phase === "narration") ||
    !trace.calls.some(({ phase }) => phase === "audit")
  ) {
    throw new Error("Committed chapter does not match its accepted delta and generation calls");
  }
  if (
    chapter.proseHash !== sha256(chapter.prose) ||
    chapter.narrativeAudit.proseHash !== chapter.proseHash
  ) {
    throw new Error("Committed chapter prose hash does not match its audit");
  }
  if (
    chapter.narrativeAudit.leakedFactIds.length > 0 ||
    NARRATIVE_AUDIT_DIMENSIONS.some((dimension) => chapter.narrativeAudit.scores[dimension] < 1)
  ) {
    throw new Error("Committed chapter did not pass every narrative audit dimension");
  }
  const responseIds = [
    ...new Set([
      ...trace.attempts.flatMap(({ responseId }) => (responseId === null ? [] : [responseId])),
      ...trace.calls.map(({ responseId }) => responseId),
    ]),
  ];
  return StoryReviewChapterSchema.parse({
    adapterMode: trace.adapterMode,
    auditApproved: chapter.narrativeAudit.approved,
    chapter: chapter.chapter,
    chapterRecordHash: sha256(JSON.stringify(chapter)),
    chosenAction: chapter.playerAction.description,
    costUsd: chapter.estimatedCostUsd,
    prose: chapter.prose,
    proseHash: chapter.proseHash,
    promptVersion: trace.promptVersion,
    responseIds,
    serviceTier: "flex",
    sourceGitSha: trace.gitSha,
    title: chapter.title,
    traceHash: sha256(JSON.stringify(trace)),
    wordCount: wordCount(chapter.prose),
    worldVersionAfter: chapter.stateAfterVersion,
    worldVersionBefore: chapter.stateBeforeVersion,
  });
}

export function buildStoryReviewEvidence(candidate: unknown): StoryReviewEvidence {
  const source = StoryReviewSourceEvidenceSchema.parse(candidate);
  for (const story of source.stories) assertStoryReviewSourceQuality(story);
  validateStoryReviewSourceIdentities(source.stories);
  const stories = source.stories.map(({ characterId, chapters, finalState }) => {
    validateStoryReviewPrefix(
      characterId,
      source.sourceGitSha,
      chapters.map(({ chapterRecord, trace, worldDelta }) => ({
        chapter: chapterRecord,
        delta: worldDelta,
        trace,
      })),
      finalState,
    );
    return {
      characterId,
      chapters: chapters.map(({ chapterRecord, trace }) =>
        buildStoryReviewChapter(characterId, chapterRecord, trace),
      ),
    };
  });
  const committedChapterCostUsd = roundMoney(
    stories.flatMap(({ chapters }) => chapters).reduce((sum, chapter) => sum + chapter.costUsd, 0),
  );
  return StoryReviewEvidenceSchema.parse({
    ...source,
    committedChapterCostUsd,
    stories,
  });
}

export function assertStoryReviewDatabaseQuality(
  characterId: CharacterId,
  databasePath: string,
): StoryQualityEvaluation {
  let evaluation: StoryQualityEvaluation;
  try {
    const loaded = loadStoryQualityStoryFromDatabase(databasePath, {
      firstChapter: 1,
      lastChapter: STORY_REVIEW_CHAPTERS_PER_STORY,
    });
    evaluation = evaluateStoryQuality(loaded.chapters);
  } catch (error) {
    throw new Error(
      `${characterId} story-quality database evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (evaluation.gates.length !== STORY_REVIEW_REQUIRED_QUALITY_GATE_COUNT) {
    throw new Error(
      `${characterId} story-quality evaluation returned ${evaluation.gates.length} gates; expected ${STORY_REVIEW_REQUIRED_QUALITY_GATE_COUNT}`,
    );
  }
  const failures = evaluation.gates.filter(({ passed }) => !passed);
  if (!evaluation.passed || failures.length > 0) {
    const diagnostics = failures
      .map(
        ({ actual, comparator, id, threshold }) =>
          `${id} actual=${actual} required${comparator}${threshold}`,
      )
      .join("; ");
    throw new Error(`${characterId} story-quality gates failed: ${diagnostics}`);
  }
  return evaluation;
}

function assertStoryReviewSourceQuality(story: StoryReviewSourceStory): void {
  const path = resolve(tmpdir(), `infinite-litrpg-story-review-${randomUUID()}.db`);
  let database: Database.Database | null = new Database(path);
  try {
    database.exec(`
      CREATE TABLE chapters (
        world_id TEXT NOT NULL,
        chapter INTEGER NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE TABLE world_deltas (
        world_id TEXT NOT NULL,
        chapter INTEGER NOT NULL,
        delta_json TEXT NOT NULL
      );
    `);
    const insertChapter = database.prepare(
      "INSERT INTO chapters (world_id, chapter, record_json) VALUES (?, ?, ?)",
    );
    const insertDelta = database.prepare(
      "INSERT INTO world_deltas (world_id, chapter, delta_json) VALUES (?, ?, ?)",
    );
    const write = database.transaction(() => {
      for (const { chapterRecord, worldDelta } of story.chapters) {
        insertChapter.run("ashen-crown-v1", chapterRecord.chapter, JSON.stringify(chapterRecord));
        insertDelta.run("ashen-crown-v1", chapterRecord.chapter, JSON.stringify(worldDelta));
      }
    });
    write.immediate();
    database.close();
    database = null;
    assertStoryReviewDatabaseQuality(story.characterId, path);
  } finally {
    database?.close();
    rmSync(path, { force: true });
    rmSync(`${path}-shm`, { force: true });
    rmSync(`${path}-wal`, { force: true });
  }
}

export function validateStoryReviewSourceIdentities(
  stories: readonly {
    readonly chapters: readonly {
      readonly chapterRecord: {
        readonly requestId?: string | undefined;
      };
      readonly trace: {
        readonly attempts: readonly {
          readonly responseId: string | null;
        }[];
        readonly runId: string;
      };
    }[];
  }[],
): void {
  const requestIds = new Set<string>();
  const responseIds = new Set<string>();
  const traceIds = new Set<string>();
  for (const story of stories) {
    for (const { chapterRecord, trace } of story.chapters) {
      if (chapterRecord.requestId === undefined) {
        throw new Error("Story-review chapter lacks a runtime request ID");
      }
      if (requestIds.has(chapterRecord.requestId)) {
        throw new Error("Story-review request IDs must be unique across all sixty chapters");
      }
      requestIds.add(chapterRecord.requestId);
      if (traceIds.has(trace.runId)) {
        throw new Error("Story-review trace IDs must be unique across all sixty chapters");
      }
      traceIds.add(trace.runId);
      for (const { responseId } of trace.attempts) {
        if (responseId === null) continue;
        if (responseIds.has(responseId)) {
          throw new Error("Story-review response IDs must be unique across all runtime attempts");
        }
        responseIds.add(responseId);
      }
    }
  }
}

export function validateStoryReviewGitBridge(input: {
  readonly committedPaths: readonly string[];
  readonly sourceIsAncestor: boolean;
  readonly worktreePaths: readonly string[];
}): void {
  if (!input.sourceIsAncestor) {
    throw new Error("Story-review source Git SHA is not an ancestor of the current checkout");
  }
  const allowedPaths = new Set<string>(STORY_REVIEW_GIT_BRIDGE_PATHS);
  const unsupportedCommittedPath = input.committedPaths.find((path) => !allowedPaths.has(path));
  if (unsupportedCommittedPath !== undefined) {
    throw new Error(
      `Story-review evidence is stale after committed change ${unsupportedCommittedPath}`,
    );
  }
  const unsupportedWorktreePath = input.worktreePaths.find((path) => !allowedPaths.has(path));
  if (unsupportedWorktreePath !== undefined) {
    throw new Error(
      `Story-review evidence is stale beside worktree change ${unsupportedWorktreePath}`,
    );
  }
}

export function parseStoryReviewWorktreePaths(lines: readonly string[]): string[] {
  return lines.map((line) => {
    if (line.length < 4) throw new Error("Story-review Git status output is malformed");
    const status = line.slice(0, 2);
    if (status.includes("R") || status.includes("C")) {
      throw new Error("Story-review evidence rejects worktree renames and copies");
    }
    return line.slice(3).replaceAll("\\", "/");
  });
}

export function splitStoryReviewGitLines(output: string): string[] {
  const withoutTrailingLineBreaks = output.replace(/(?:\r?\n)+$/u, "");
  return withoutTrailingLineBreaks === "" ? [] : withoutTrailingLineBreaks.split(/\r?\n/u);
}

export function validateStoryReviewPrefix(
  characterId: CharacterId,
  sourceGitSha: string,
  rows: readonly {
    readonly chapter: unknown;
    readonly delta: unknown;
    readonly trace: unknown;
  }[],
  finalStateCandidate: unknown,
): number {
  if (rows.length > STORY_REVIEW_CHAPTERS_PER_STORY) {
    throw new Error(`${characterId} review prefix exceeds ten chapters`);
  }
  const chapters = validateStoryReviewBranch(
    characterId,
    rows.map(({ chapter }) => chapter),
  );
  let state = loadSeedWorld();
  state.lockedPovId = characterId;
  state = WorldStateSchema.parse(state);
  for (const [index, row] of rows.entries()) {
    const chapterRecord = chapters[index]!;
    const chapter = buildStoryReviewChapter(characterId, chapterRecord, row.trace);
    const trace = TraceEnvelopeSchema.parse(row.trace);
    const delta = WorldDeltaSchema.parse(row.delta);
    if (chapter.chapter !== index + 1) {
      throw new Error(`${characterId} review prefix is not contiguous from chapter 1`);
    }
    if (chapter.sourceGitSha !== sourceGitSha) {
      throw new Error(`${characterId} review prefix uses a different source Git SHA`);
    }
    if (
      !isDeepStrictEqual(delta, trace.acceptedDelta) ||
      trace.stateBeforeHash !== sha256(JSON.stringify(state))
    ) {
      throw new Error(`${characterId} review prefix does not match its committed delta or state`);
    }
    const staged = stageWorldDelta(state, trace.intents, delta);
    if (!staged.ok) {
      throw new Error(`${characterId} review prefix cannot restage chapter ${chapter.chapter}`);
    }
    if (
      trace.stateAfterHash !== sha256(JSON.stringify(staged.data.state)) ||
      chapterRecord.safeContextHash !==
        sha256(JSON.stringify(buildPovContext(staged.data.state, characterId))) ||
      chapterRecord.stateBeforeVersion !== state.version ||
      chapterRecord.stateAfterVersion !== staged.data.state.version ||
      chapterRecord.chapter !== staged.data.state.chapter ||
      chapterRecord.terminal !== staged.data.state.terminal
    ) {
      throw new Error(`${characterId} review prefix does not match its staged state`);
    }
    state = staged.data.state;
  }
  const finalState = WorldStateSchema.parse(finalStateCandidate);
  if (!isDeepStrictEqual(finalState, state)) {
    throw new Error(`${characterId} review prefix final state does not match its delta chain`);
  }
  return rows.length;
}

export function validateStoryReviewBranch(
  characterId: CharacterId,
  chapterCandidates: readonly unknown[],
) {
  const chapters = chapterCandidates.map((chapter) => ChapterRecordSchema.parse(chapter));
  const seed = loadSeedWorld();
  seed.lockedPovId = characterId;
  let offeredChoices = initialChoices(WorldStateSchema.parse(seed));
  const priorActions: ChapterRecord["playerAction"][] = [];
  for (const chapter of chapters) {
    const expectedChoice = selectStoryReviewChoice(priorActions, offeredChoices);
    if (
      !expectedChoice ||
      chapter.povCharacterId !== characterId ||
      chapter.playerAction.source !== "suggested" ||
      chapter.playerAction.description !== expectedChoice.description ||
      chapter.playerAction.milestoneId !== expectedChoice.milestoneId ||
      !isDeepStrictEqual(chapter.playerAction.action, expectedChoice.action)
    ) {
      throw new Error(
        `${characterId} review chapter ${chapter.chapter} violates the ${STORY_REVIEW_BRANCH_POLICY} policy`,
      );
    }
    priorActions.push(chapter.playerAction);
    offeredChoices = chapter.choices;
  }
  return chapters;
}

export function selectStoryReviewChoice(
  priorActions: readonly ChapterRecord["playerAction"][],
  offeredChoices: readonly ChapterRecord["choices"][number][],
): ChapterRecord["choices"][number] | undefined {
  const directorChoice = offeredChoices[0];
  if (!directorChoice) return undefined;
  return (
    offeredChoices.find((choice) => preservesFinalActionFeasibility(priorActions, choice)) ??
    directorChoice
  );
}

function preservesFinalActionFeasibility(
  priorActions: readonly ChapterRecord["playerAction"][],
  choice: ChapterRecord["choices"][number],
): boolean {
  const completedAfter = priorActions.length + 1;
  const remaining = Math.max(0, STORY_REVIEW_CHAPTERS_PER_STORY - completedAfter);
  const matchingCount = priorActions.filter(({ action }) =>
    isDeepStrictEqual(action, choice.action),
  ).length;
  if (matchingCount + 1 > 4) return false;

  const priorTwo = priorActions.slice(-2);
  if (
    priorTwo.length === 2 &&
    (priorTwo.every(({ action }) => isDeepStrictEqual(action, choice.action)) ||
      priorTwo.every(({ action }) => action.type === choice.action.type))
  ) {
    return false;
  }

  const distinctActions = [...priorActions.map(({ action }) => action), choice.action].filter(
    (action, index, actions) =>
      actions.findIndex((candidate) => isDeepStrictEqual(candidate, action)) === index,
  ).length;
  const scheduledMinimum = Math.ceil((completedAfter / STORY_REVIEW_CHAPTERS_PER_STORY) * 4);
  return distinctActions >= scheduledMinimum && distinctActions + remaining >= 4;
}

export function parseStoryReviewArgs(args: readonly string[]): StoryReviewArgs {
  const allowed = new Set(["--confirm-unbounded-cost", "--finalize-only", "--preflight-only"]);
  for (const argument of args) {
    if (!allowed.has(argument)) throw new Error(`Unknown story-review argument: ${argument}`);
  }

  const preflightOnly = countFlag(args, "--preflight-only") === 1;
  const finalizeOnly = countFlag(args, "--finalize-only") === 1;
  const confirmUnboundedCost = countFlag(args, "--confirm-unbounded-cost") === 1;
  assertAtMostOnce(args, "--preflight-only");
  assertAtMostOnce(args, "--finalize-only");
  assertAtMostOnce(args, "--confirm-unbounded-cost");
  if (preflightOnly && finalizeOnly) {
    throw new Error("--preflight-only and --finalize-only cannot be combined");
  }
  if (finalizeOnly && confirmUnboundedCost) {
    throw new Error("--finalize-only cannot confirm paid provider work");
  }
  if (preflightOnly && confirmUnboundedCost) {
    throw new Error("--preflight-only cannot confirm paid provider work");
  }
  if (!preflightOnly && !finalizeOnly && !confirmUnboundedCost) {
    throw new Error("Paid story review generation requires --confirm-unbounded-cost");
  }
  return { confirmUnboundedCost, finalizeOnly, preflightOnly };
}

export function buildStoryReviewMarkdown(candidate: unknown): string {
  const evidence = StoryReviewEvidenceSchema.parse(candidate);
  const characterById = new Map(PUBLIC_CHARACTERS.map((character) => [character.id, character]));
  const sections = evidence.stories.flatMap((story, index) => {
    const character = characterById.get(story.characterId);
    if (!character) throw new Error(`Unknown story-review character ${story.characterId}`);
    return [
      `## ${index + 1}. ${character.name}`,
      "",
      `_${character.publicRole}. ${character.characterClass}, level ${character.level}._`,
      "",
      `Story evidence: \`${story.characterId}\`. Chapters 1 through 10 are contiguous runtime output.`,
      "",
      ...story.chapters.flatMap((chapter) => [
        `### Chapter ${chapter.chapter}: ${chapter.title}`,
        "",
        `**Chosen action:** ${chapter.chosenAction}`,
        "",
        chapter.prose,
        "",
      ]),
      `<!-- STORY_REVIEW_HUMAN_START:${story.characterId} -->`,
      "",
      "### Progression review",
      "",
      "| Chapter | Hook carried forward | Character or power progress | Continuity problem | Keep reading |",
      "| ---: | --- | --- | --- | --- |",
      ...story.chapters.map(({ chapter }) => `| ${chapter} |  |  |  |  |`),
      "",
      "- Voice stayed distinct:",
      "- Ten-chapter throughline:",
      "- LitRPG progression felt earned:",
      "- Best chapter and why:",
      "- Weakest chapter and exact fix:",
      "- Overall verdict: pass or revise",
      "",
      `<!-- STORY_REVIEW_HUMAN_END:${story.characterId} -->`,
      "",
    ];
  });

  return [
    "# Six Ten-Chapter Story Reviews",
    "",
    "Human review pack for Infinite LitRPG. Read each story in order. Judge progression across the full ten chapters, not one excerpt.",
    "",
    `- Source Git SHA: \`${evidence.sourceGitSha}\``,
    `- Prompt version: \`${evidence.promptVersion}\``,
    `- Service tier: \`${evidence.serviceTier}\``,
    `- Estimated committed chapter cost: \`$${evidence.committedChapterCostUsd.toFixed(6)}\`. Durable exposure telemetry: \`$${evidence.durableExposureUsd.toFixed(6)}\`. Application cost limit: disabled.`,
    `- Carried prior-variant exposure: \`$${evidence.priorVariantExposureUsd.toFixed(6)}\`, archive manifest \`${evidence.qualityVariantArchive.manifestSha256}\`.`,
    "- Every chapter passed schema, canon, POV, narrative, and atomic-commit gates before inclusion.",
    "- Branch policy: the runner followed the director-ranked first choice unless that would repeat one action type for a third consecutive chapter; no hardcoded custom action was injected.",
    "",
    "## Reading order",
    "",
    ...evidence.stories.map((story, index) => {
      const name = characterById.get(story.characterId)?.name ?? story.characterId;
      return `${index + 1}. [${name}](#${index + 1}-${slug(name)})`;
    }),
    "",
    ...sections,
  ].join("\n");
}

export function storyReviewMarkdownMatches(generated: string, candidate: string): boolean {
  const normalizedGenerated = normalizeStoryReviewHumanSections(generated);
  const normalizedCandidate = normalizeStoryReviewHumanSections(candidate);
  return normalizedGenerated !== null && normalizedGenerated === normalizedCandidate;
}

export function mergeStoryReviewHumanSections(generated: string, existing: string): string {
  if (!storyReviewMarkdownMatches(generated, existing)) return generated;
  const existingSections = readStoryReviewHumanSections(existing);
  if (existingSections === null) return generated;
  return generated.replace(STORY_REVIEW_HUMAN_BLOCK_PATTERN, (block, characterId: string) => {
    return existingSections.get(characterId) ?? block;
  });
}

export function storyReviewCharacterName(characterId: CharacterId): string {
  const character = PUBLIC_CHARACTERS.find(({ id }) => id === characterId);
  if (!character) throw new Error(`Unknown character ${characterId}`);
  return character.name;
}

function assertAtMostOnce(args: readonly string[], flag: string): void {
  if (countFlag(args, flag) > 1) throw new Error(`${flag} must appear at most once`);
}

function countFlag(args: readonly string[], flag: string): number {
  return args.filter((argument) => argument === flag).length;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function slug(value: string): string {
  return value.toLowerCase().replaceAll(" ", "-");
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

function emptyUsage(): TraceEnvelope["totalUsage"] {
  return {
    cacheWriteTokens: 0,
    cachedInputTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
}

function addUsage(
  left: TraceEnvelope["totalUsage"],
  right: TraceEnvelope["totalUsage"],
): TraceEnvelope["totalUsage"] {
  return {
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function validateCallAttemptGroups(trace: TraceEnvelope): void {
  if (new Set(trace.calls.map(({ responseId }) => responseId)).size !== trace.calls.length) {
    throw new Error("Committed trace model calls reuse a response ID");
  }
  const usedAttemptIndexes = new Set<number>();
  for (const call of trace.calls) {
    const finalIndexes = trace.attempts.flatMap((attempt, index) =>
      attempt.responseId === call.responseId ? [index] : [],
    );
    if (finalIndexes.length !== 1) {
      throw new Error("Committed trace model call lacks one final runtime attempt");
    }
    const callAttemptIndexes = [finalIndexes[0]!];
    let cursor = finalIndexes[0]! - 1;
    for (let expectedAttempt = call.retries - 1; expectedAttempt >= 0; expectedAttempt -= 1) {
      let matchedIndex = -1;
      for (let index = cursor; index >= 0; index -= 1) {
        const attempt = trace.attempts[index];
        if (
          attempt?.attempt === expectedAttempt &&
          attempt.phase === call.phase &&
          attempt.model === call.model &&
          attempt.agentId === call.agentId
        ) {
          matchedIndex = index;
          break;
        }
      }
      if (matchedIndex < 0) {
        throw new Error("Committed trace model call retry group is incomplete");
      }
      callAttemptIndexes.unshift(matchedIndex);
      cursor = matchedIndex - 1;
    }
    if (callAttemptIndexes.some((index) => usedAttemptIndexes.has(index))) {
      throw new Error("Committed trace runtime attempt is reused by model calls");
    }
    callAttemptIndexes.forEach((index) => usedAttemptIndexes.add(index));
    const callAttempts = callAttemptIndexes.map((index) => trace.attempts[index]!);
    const finalAttempt = callAttempts.at(-1);
    if (
      call.errorCode !== null ||
      call.refusal ||
      call.timedOut ||
      callAttempts.length !== call.retries + 1 ||
      callAttempts.some(
        (attempt, index) =>
          attempt.attempt !== index ||
          attempt.phase !== call.phase ||
          attempt.model !== call.model ||
          attempt.agentId !== call.agentId ||
          attempt.requestedServiceTier !== call.requestedServiceTier,
      ) ||
      finalAttempt === undefined ||
      finalAttempt.responseId !== call.responseId ||
      finalAttempt.errorCode !== null ||
      finalAttempt.serviceTier !== call.serviceTier ||
      Math.abs(
        callAttempts.reduce((sum, attempt) => sum + attempt.costUsd, 0) - call.estimatedCostUsd,
      ) > MONEY_EPSILON_USD ||
      !isDeepStrictEqual(
        callAttempts.reduce((sum, attempt) => addUsage(sum, attempt.usage), emptyUsage()),
        call.usage,
      )
    ) {
      throw new Error("Committed trace model call does not match its runtime attempt group");
    }
  }
}

const STORY_REVIEW_HUMAN_BLOCK_PATTERN =
  /<!-- STORY_REVIEW_HUMAN_START:([a-z0-9-]+) -->[\s\S]*?<!-- STORY_REVIEW_HUMAN_END:\1 -->/gu;

function readStoryReviewHumanSections(markdown: string): ReadonlyMap<string, string> | null {
  const matches = [...markdown.matchAll(STORY_REVIEW_HUMAN_BLOCK_PATTERN)];
  const expectedIds = new Set<string>(CHARACTER_IDS);
  if (
    matches.length !== CHARACTER_IDS.length ||
    (markdown.match(/<!-- STORY_REVIEW_HUMAN_START:/gu) ?? []).length !== CHARACTER_IDS.length ||
    (markdown.match(/<!-- STORY_REVIEW_HUMAN_END:/gu) ?? []).length !== CHARACTER_IDS.length
  ) {
    return null;
  }
  const sections = new Map<string, string>();
  for (const match of matches) {
    const characterId = match[1];
    if (!characterId || !expectedIds.has(characterId) || sections.has(characterId) || !match[0]) {
      return null;
    }
    sections.set(characterId, match[0]);
  }
  return sections;
}

function normalizeStoryReviewHumanSections(markdown: string): string | null {
  const sections = readStoryReviewHumanSections(markdown);
  if (sections === null) return null;
  return markdown.replace(STORY_REVIEW_HUMAN_BLOCK_PATTERN, (_block, characterId: string) => {
    return `<!-- STORY_REVIEW_HUMAN_START:${characterId} -->\n[human review]\n<!-- STORY_REVIEW_HUMAN_END:${characterId} -->`;
  });
}
