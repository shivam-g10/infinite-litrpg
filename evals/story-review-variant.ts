import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve } from "node:path";

import {
  CHARACTER_IDS,
  FailedTurnTraceSchema,
  PersistedTraceEnvelopeSchema,
  RuntimeAttemptTraceSchema,
} from "@infinite-litrpg/shared";
import Database from "better-sqlite3";
import { z } from "zod";

import {
  LiveSpendLedger,
  readLiveSpendSnapshot,
  type LiveSpendSnapshot,
} from "./live-spend-ledger";
import {
  StoryReviewVariantArchiveReferenceSchema,
  STORY_REVIEW_TOTAL_CAP_USD,
  STORY_REVIEW_VARIANT_CONFIG,
  STORY_REVIEW_VARIANT_CONFIG_SHA256,
} from "./story-review";

const ARCHIVE_SCHEMA_VERSION = "1.0.0-story-review-variant-archive" as const;
const CHAINED_ARCHIVE_SCHEMA_VERSION = "2.0.0-story-review-variant-archive" as const;
const MARKER_SCHEMA_VERSION = "1.0.0-story-review-variant-marker" as const;
const CHAINED_MARKER_SCHEMA_VERSION = "2.0.0-story-review-variant-marker" as const;
const MIGRATION_REASON = "narration-route-reversal-and-repetitive-branching" as const;
const CHAINED_MIGRATION_REASON = "human-rejected-progression-and-canon-quality" as const;
export const STORY_REVIEW_VARIANT_MIGRATION_RUN_ID = "00000000-0000-4000-8000-000000000612";
const PREVIOUS_PROMPT_VERSION = "1.4.11" as const;
const PREVIOUS_BRANCH_POLICY = "first-offered-choice" as const;
const PREVIOUS_SCHEMA_VERSION = "1.1.0-story-review" as const;
const REJECTED_PROMPT_VERSION = "1.4.12" as const;
const REJECTED_BRANCH_POLICY = "least-used-action-type" as const;
const REJECTED_SCHEMA_VERSION = "1.2.0-story-review" as const;
const PREVIOUS_TOTAL_CAP_USD = 2.544 as const;
const MONEY_EPSILON_USD = 0.000_000_001;
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const GitShaSchema = z.string().regex(/^[a-f0-9]{40}$/u);

const LegacyVariantConfigSchema = z
  .object({
    branchPolicy: z.string().min(1).max(120),
    promptVersion: z.string().min(1).max(120),
    schemaVersion: z.string().min(1).max(120),
  })
  .strict();

const HistoricalQualityVariantConfigSchema = z
  .object({
    branchPolicy: z.string().min(1).max(120),
    enforceNarrativeQuality: z.literal(true),
    modelRouting: z
      .object({
        audit: z
          .object({ model: z.literal("gpt-5.6-terra"), reasoningEffort: z.literal("low") })
          .strict(),
        frame: z
          .object({ model: z.literal("gpt-5.6-sol"), reasoningEffort: z.literal("low") })
          .strict(),
        narration: z
          .object({ model: z.literal("gpt-5.6-sol"), reasoningEffort: z.literal("low") })
          .strict(),
      })
      .strict(),
    promptVersion: z.string().min(1).max(120),
    schemaVersion: z.string().min(1).max(120),
    storyQualityEvalVersion: z.string().min(1).max(120),
    storyQualityGateCount: z.literal(26),
  })
  .strict();

const CurrentQualityVariantConfigSchema = z
  .object({
    branchPolicy: z.literal(STORY_REVIEW_VARIANT_CONFIG.branchPolicy),
    costLimitEnabled: z.literal(false),
    enforceNarrativeQuality: z.literal(true),
    modelRouting: z
      .object({
        audit: z
          .object({
            model: z.literal(STORY_REVIEW_VARIANT_CONFIG.modelRouting.audit.model),
            reasoningEffort: z.literal(
              STORY_REVIEW_VARIANT_CONFIG.modelRouting.audit.reasoningEffort,
            ),
          })
          .strict(),
        frame: z
          .object({
            model: z.literal(STORY_REVIEW_VARIANT_CONFIG.modelRouting.frame.model),
            reasoningEffort: z.literal(
              STORY_REVIEW_VARIANT_CONFIG.modelRouting.frame.reasoningEffort,
            ),
          })
          .strict(),
        narration: z
          .object({
            model: z.literal(STORY_REVIEW_VARIANT_CONFIG.modelRouting.narration.model),
            reasoningEffort: z.literal(
              STORY_REVIEW_VARIANT_CONFIG.modelRouting.narration.reasoningEffort,
            ),
          })
          .strict(),
      })
      .strict(),
    proseLengthLimitEnabled: z.literal(false),
    promptVersion: z.literal(STORY_REVIEW_VARIANT_CONFIG.promptVersion),
    providerOutputLimitRequested: z.literal(false),
    schemaVersion: z.literal(STORY_REVIEW_VARIANT_CONFIG.schemaVersion),
    storyQualityEvalVersion: z.literal(STORY_REVIEW_VARIANT_CONFIG.storyQualityEvalVersion),
    storyQualityGateCount: z.literal(STORY_REVIEW_VARIANT_CONFIG.storyQualityGateCount),
  })
  .strict();

const QualityVariantConfigSchema = z.union([
  HistoricalQualityVariantConfigSchema,
  CurrentQualityVariantConfigSchema,
]);

const VariantConfigSchema = z.union([LegacyVariantConfigSchema, QualityVariantConfigSchema]);

const ArchiveFileSchema = z
  .object({
    path: z.string().min(1).max(500),
    sha256: Sha256Schema,
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

const ArchiveStorySchema = z
  .object({
    characterId: z.enum(CHARACTER_IDS),
    committedChapters: z.number().int().min(0).max(10),
    databasePresent: z.boolean(),
    failedTurns: z.number().int().nonnegative(),
    traceRunIds: z.array(z.string().uuid()),
    uniqueResponseCostUsd: z.number().nonnegative().max(STORY_REVIEW_TOTAL_CAP_USD),
    uniqueResponseCount: z.number().int().nonnegative(),
  })
  .strict();

const StoryReviewVariantArchiveManifestV1Schema = z
  .object({
    archivedAt: z.string().datetime({ offset: true }),
    archiveSchemaVersion: z.literal(ARCHIVE_SCHEMA_VERSION),
    carriedExposureUsd: z.number().nonnegative().max(STORY_REVIEW_TOTAL_CAP_USD),
    files: z.array(ArchiveFileSchema).min(1),
    fromLedgerSourceId: z.string().min(1).max(240),
    fromSourceGitSha: GitShaSchema,
    fromTotalCapUsd: z.literal(PREVIOUS_TOTAL_CAP_USD),
    fromVariant: VariantConfigSchema,
    fromVariantConfigSha256: Sha256Schema,
    reason: z.literal(MIGRATION_REASON),
    stories: z.array(ArchiveStorySchema).length(CHARACTER_IDS.length),
    toSourceGitSha: GitShaSchema,
    toTotalCapUsd: z.literal(STORY_REVIEW_TOTAL_CAP_USD),
    toVariant: VariantConfigSchema,
    toVariantConfigSha256: Sha256Schema,
    uniqueResponseCostUsd: z.number().nonnegative().max(STORY_REVIEW_TOTAL_CAP_USD),
    uniqueResponseCount: z.number().int().nonnegative(),
  })
  .strict();

const StoryReviewVariantArchiveManifestV2Schema = z
  .object({
    archivedAt: z.string().datetime({ offset: true }),
    archiveSchemaVersion: z.literal(CHAINED_ARCHIVE_SCHEMA_VERSION),
    carriedExposureUsd: z.number().nonnegative().max(STORY_REVIEW_TOTAL_CAP_USD),
    files: z.array(ArchiveFileSchema).min(1),
    fromLedgerSourceId: z.string().min(1).max(240),
    fromSourceGitSha: GitShaSchema,
    fromTotalCapUsd: z.literal(STORY_REVIEW_TOTAL_CAP_USD),
    fromVariant: LegacyVariantConfigSchema,
    fromVariantConfigSha256: Sha256Schema,
    lineageDepth: z.number().int().min(2).max(32),
    parentManifestSha256: Sha256Schema,
    parentMarkerFile: ArchiveFileSchema,
    parentMarkerSha256: Sha256Schema,
    priorLineageExposureUsd: z.number().nonnegative().max(STORY_REVIEW_TOTAL_CAP_USD),
    reason: z.literal(CHAINED_MIGRATION_REASON),
    stories: z.array(ArchiveStorySchema).length(CHARACTER_IDS.length),
    toSourceGitSha: GitShaSchema,
    toTotalCapUsd: z.literal(STORY_REVIEW_TOTAL_CAP_USD),
    toVariant: QualityVariantConfigSchema,
    toVariantConfigSha256: Sha256Schema,
    uniqueResponseCostUsd: z.number().nonnegative().max(STORY_REVIEW_TOTAL_CAP_USD),
    uniqueResponseCount: z.number().int().nonnegative(),
  })
  .strict();

export const StoryReviewVariantArchiveManifestSchema = z.discriminatedUnion(
  "archiveSchemaVersion",
  [StoryReviewVariantArchiveManifestV1Schema, StoryReviewVariantArchiveManifestV2Schema],
);

const StoryReviewVariantMarkerV1Schema = z
  .object({
    archiveDirectory: z.string().regex(/^[a-f0-9]{40}-to-[a-f0-9]{40}$/u),
    carriedExposureUsd: z.number().nonnegative().max(STORY_REVIEW_TOTAL_CAP_USD),
    fromSourceGitSha: GitShaSchema,
    manifestSha256: Sha256Schema,
    markerSchemaVersion: z.literal(MARKER_SCHEMA_VERSION),
    reason: z.literal(MIGRATION_REASON),
    toSourceGitSha: GitShaSchema,
    variantConfigSha256: Sha256Schema,
  })
  .strict();

const StoryReviewVariantMarkerV2Schema = z
  .object({
    archiveDirectory: z.string().regex(/^[a-f0-9]{40}-to-[a-f0-9]{40}$/u),
    carriedExposureUsd: z.number().nonnegative().max(STORY_REVIEW_TOTAL_CAP_USD),
    fromSourceGitSha: GitShaSchema,
    lineageDepth: z.number().int().min(2).max(32),
    manifestSha256: Sha256Schema,
    markerSchemaVersion: z.literal(CHAINED_MARKER_SCHEMA_VERSION),
    parentManifestSha256: Sha256Schema,
    parentMarkerSha256: Sha256Schema,
    reason: z.literal(CHAINED_MIGRATION_REASON),
    toSourceGitSha: GitShaSchema,
    variantConfigSha256: Sha256Schema,
  })
  .strict();

export const StoryReviewVariantMarkerSchema = z.discriminatedUnion("markerSchemaVersion", [
  StoryReviewVariantMarkerV1Schema,
  StoryReviewVariantMarkerV2Schema,
]);

export { STORY_REVIEW_VARIANT_CONFIG_SHA256 };

const PREVIOUS_VARIANT_CONFIG = {
  branchPolicy: PREVIOUS_BRANCH_POLICY,
  promptVersion: PREVIOUS_PROMPT_VERSION,
  schemaVersion: PREVIOUS_SCHEMA_VERSION,
} as const;

const REJECTED_VARIANT_CONFIG = {
  branchPolicy: REJECTED_BRANCH_POLICY,
  promptVersion: REJECTED_PROMPT_VERSION,
  schemaVersion: REJECTED_SCHEMA_VERSION,
} as const;
const REJECTED_VARIANT_CONFIG_SHA256 = sha256Json(REJECTED_VARIANT_CONFIG);

export type StoryReviewVariantMarker = z.infer<typeof StoryReviewVariantMarkerSchema>;

export interface StoryReviewVariantMigrationOptions {
  readonly archiveRoot: string;
  readonly fromSourceGitSha: string;
  readonly ledgerPath: string;
  readonly markerPath: string;
  readonly reportDirectory: string;
  readonly storyDirectory: string;
  readonly toSourceGitSha: string;
}

export type StoryReviewVariantMigrationResult = StoryReviewVariantMarker & {
  readonly archivePath: string;
};

export function migrateStoryReviewVariant(
  options: StoryReviewVariantMigrationOptions,
): StoryReviewVariantMigrationResult {
  const paths = validatedPaths(options);
  const archiveDirectory = `${options.fromSourceGitSha}-to-${options.toSourceGitSha}`;
  const archivePath = resolve(paths.archiveRoot, archiveDirectory);
  const archivedStoryPath = resolve(archivePath, "stories");
  assertInside(paths.archiveRoot, archivePath, "variant archive");

  return withVariantLedgerLock(paths.ledgerPath, (ledger) => {
    let parentMarker: StoryReviewVariantMarker | null = null;
    let parentMarkerBytes: Buffer | null = null;
    if (existsSync(paths.markerPath)) {
      const markerCandidate = StoryReviewVariantMarkerSchema.parse(
        JSON.parse(readFileSync(paths.markerPath, "utf8")) as unknown,
      );
      const migrationAlreadyCompleted =
        markerCandidate.toSourceGitSha === options.toSourceGitSha &&
        markerCandidate.variantConfigSha256 === STORY_REVIEW_VARIANT_CONFIG_SHA256;
      if (migrationAlreadyCompleted) {
        if (existsSync(paths.storyDirectory)) {
          throw new Error("Variant marker and active story-review directory cannot coexist");
        }
        const marker = readStoryReviewVariantMarker(
          paths.markerPath,
          paths.archiveRoot,
          options.toSourceGitSha,
        );
        if (marker.fromSourceGitSha !== options.fromSourceGitSha) {
          throw new Error("Existing variant marker belongs to a different source lineage");
        }
        foldOwnedVariantExposure(ledger, marker);
        return { ...marker, archivePath };
      }
      parentMarkerBytes = readFileSync(paths.markerPath);
      parentMarker = readStoryReviewVariantMarkerForConfig(
        paths.markerPath,
        paths.archiveRoot,
        options.fromSourceGitSha,
        REJECTED_VARIANT_CONFIG_SHA256,
      );
    }

    if (existsSync(paths.storyDirectory) && existsSync(archivedStoryPath)) {
      throw new Error("Active and archived story-review data cannot coexist");
    }
    if (!existsSync(paths.storyDirectory) && !existsSync(archivedStoryPath)) {
      throw new Error("No story-review data exists to archive");
    }

    const ledgerBefore = ledger.snapshot();
    if (parentMarker === null) {
      assertMigratableLedger(ledgerBefore, options.fromSourceGitSha);
    } else {
      assertChainedMigratableLedger(ledgerBefore, options.fromSourceGitSha, parentMarker);
    }
    const inspectionPath = existsSync(paths.storyDirectory)
      ? paths.storyDirectory
      : archivedStoryPath;
    const storyInspection = inspectArchivedStories(
      inspectionPath,
      options.fromSourceGitSha,
      parentMarker === null ? PREVIOUS_PROMPT_VERSION : REJECTED_PROMPT_VERSION,
    );
    const priorLineageExposureUsd = parentMarker?.carriedExposureUsd ?? 0;
    const currentVariantExposureUsd = roundMoney(
      ledgerBefore.totalExposureUsd - priorLineageExposureUsd,
    );
    if (
      Math.abs(storyInspection.uniqueResponseCostUsd - currentVariantExposureUsd) >
      MONEY_EPSILON_USD
    ) {
      throw new Error(
        "Archived unique response cost does not match the durable story-review exposure",
      );
    }
    if (
      parentMarker !== null &&
      storyInspection.stories.some(
        ({ committedChapters, databasePresent }) => !databasePresent || committedChapters !== 10,
      )
    ) {
      throw new Error("Rejected story-review variant must contain six complete ten-chapter POVs");
    }
    if (existsSync(paths.storyDirectory)) {
      mkdirSync(archivePath, { recursive: true });
      renameSync(paths.storyDirectory, archivedStoryPath);
    }

    let parentMarkerFile: z.infer<typeof ArchiveFileSchema> | null = null;
    if (parentMarker !== null && parentMarkerBytes !== null) {
      parentMarkerFile = archiveParentMarker(archivePath, parentMarkerBytes);
    }

    const manifestPath = resolve(archivePath, "manifest.json");
    let manifest: z.infer<typeof StoryReviewVariantArchiveManifestSchema>;
    if (existsSync(manifestPath)) {
      manifest = StoryReviewVariantArchiveManifestSchema.parse(
        JSON.parse(readFileSync(manifestPath, "utf8")) as unknown,
      );
    } else {
      const commonManifest = {
        archivedAt: new Date().toISOString(),
        carriedExposureUsd: ledgerBefore.totalExposureUsd,
        files: inventoryFiles(archivedStoryPath, archivePath),
        fromSourceGitSha: options.fromSourceGitSha,
        stories: storyInspection.stories,
        toSourceGitSha: options.toSourceGitSha,
        toTotalCapUsd: STORY_REVIEW_TOTAL_CAP_USD,
        toVariant: STORY_REVIEW_VARIANT_CONFIG,
        toVariantConfigSha256: STORY_REVIEW_VARIANT_CONFIG_SHA256,
        uniqueResponseCostUsd: storyInspection.uniqueResponseCostUsd,
        uniqueResponseCount: storyInspection.uniqueResponseCount,
      };
      manifest = StoryReviewVariantArchiveManifestSchema.parse(
        parentMarker === null
          ? {
              ...commonManifest,
              archiveSchemaVersion: ARCHIVE_SCHEMA_VERSION,
              fromLedgerSourceId: `fresh:${options.fromSourceGitSha}`,
              fromTotalCapUsd: PREVIOUS_TOTAL_CAP_USD,
              fromVariant: PREVIOUS_VARIANT_CONFIG,
              fromVariantConfigSha256: sha256Json(PREVIOUS_VARIANT_CONFIG),
              reason: MIGRATION_REASON,
            }
          : {
              ...commonManifest,
              archiveSchemaVersion: CHAINED_ARCHIVE_SCHEMA_VERSION,
              fromLedgerSourceId: storyReviewLedgerSourceId(options.fromSourceGitSha, parentMarker),
              fromTotalCapUsd: STORY_REVIEW_TOTAL_CAP_USD,
              fromVariant: REJECTED_VARIANT_CONFIG,
              fromVariantConfigSha256: REJECTED_VARIANT_CONFIG_SHA256,
              lineageDepth: markerLineageDepth(parentMarker) + 1,
              parentManifestSha256: parentMarker.manifestSha256,
              parentMarkerFile,
              parentMarkerSha256: sha256Bytes(parentMarkerBytes!),
              priorLineageExposureUsd,
              reason: CHAINED_MIGRATION_REASON,
            },
      );
      writeAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
    validateManifest(
      manifest,
      options,
      archivedStoryPath,
      archivePath,
      ledgerBefore.totalExposureUsd,
      storyInspection,
      parentMarker,
    );
    const manifestSha256 = sha256Bytes(readFileSync(manifestPath));
    const commonMarker = {
      archiveDirectory,
      carriedExposureUsd: ledgerBefore.totalExposureUsd,
      fromSourceGitSha: options.fromSourceGitSha,
      manifestSha256,
      toSourceGitSha: options.toSourceGitSha,
      variantConfigSha256: STORY_REVIEW_VARIANT_CONFIG_SHA256,
    };
    const marker = StoryReviewVariantMarkerSchema.parse(
      parentMarker === null
        ? {
            ...commonMarker,
            markerSchemaVersion: MARKER_SCHEMA_VERSION,
            reason: MIGRATION_REASON,
          }
        : {
            ...commonMarker,
            lineageDepth: markerLineageDepth(parentMarker) + 1,
            markerSchemaVersion: CHAINED_MARKER_SCHEMA_VERSION,
            parentManifestSha256: parentMarker.manifestSha256,
            parentMarkerSha256: sha256Bytes(parentMarkerBytes!),
            reason: CHAINED_MIGRATION_REASON,
          },
    );
    writeAtomic(paths.markerPath, `${JSON.stringify(marker, null, 2)}\n`);
    foldOwnedVariantExposure(ledger, marker);
    return { ...marker, archivePath };
  });
}

export function readStoryReviewVariantMarker(
  markerPath: string,
  archiveRoot: string,
  expectedSourceGitSha: string,
  expectedVariantConfigSha256 = STORY_REVIEW_VARIANT_CONFIG_SHA256,
): StoryReviewVariantMarker {
  return readStoryReviewVariantMarkerForConfig(
    markerPath,
    archiveRoot,
    expectedSourceGitSha,
    expectedVariantConfigSha256,
  );
}

function readStoryReviewVariantMarkerForConfig(
  markerPath: string,
  archiveRoot: string,
  expectedSourceGitSha: string,
  expectedVariantConfigSha256: string,
): StoryReviewVariantMarker {
  const marker = StoryReviewVariantMarkerSchema.parse(
    JSON.parse(readFileSync(markerPath, "utf8")) as unknown,
  );
  if (
    marker.toSourceGitSha !== expectedSourceGitSha ||
    marker.variantConfigSha256 !== expectedVariantConfigSha256
  ) {
    throw new Error("Story-review variant marker does not match the requested quality lineage");
  }
  validateMarkerArchive(marker, resolve(archiveRoot), new Set());
  return marker;
}

function validateMarkerArchive(
  marker: StoryReviewVariantMarker,
  archiveRoot: string,
  visitedArchives: Set<string>,
): void {
  const archivePath = resolve(archiveRoot, marker.archiveDirectory);
  assertInside(archiveRoot, archivePath, "variant archive");
  if (visitedArchives.has(marker.archiveDirectory)) {
    throw new Error("Story-review variant marker lineage contains a cycle");
  }
  visitedArchives.add(marker.archiveDirectory);
  const manifestPath = resolve(archivePath, "manifest.json");
  const bytes = readFileSync(manifestPath);
  if (sha256Bytes(bytes) !== marker.manifestSha256) {
    throw new Error("Story-review variant archive manifest hash does not match its marker");
  }
  const manifest = StoryReviewVariantArchiveManifestSchema.parse(
    JSON.parse(bytes.toString("utf8")) as unknown,
  );
  if (
    manifest.fromSourceGitSha !== marker.fromSourceGitSha ||
    manifest.toSourceGitSha !== marker.toSourceGitSha ||
    manifest.toVariantConfigSha256 !== marker.variantConfigSha256 ||
    sha256Json(manifest.fromVariant) !== manifest.fromVariantConfigSha256 ||
    sha256Json(manifest.toVariant) !== manifest.toVariantConfigSha256 ||
    Math.abs(manifest.carriedExposureUsd - marker.carriedExposureUsd) > MONEY_EPSILON_USD
  ) {
    throw new Error("Story-review variant marker does not match its archive manifest");
  }
  if (marker.markerSchemaVersion === CHAINED_MARKER_SCHEMA_VERSION) {
    if (
      manifest.archiveSchemaVersion !== CHAINED_ARCHIVE_SCHEMA_VERSION ||
      manifest.lineageDepth !== marker.lineageDepth ||
      manifest.parentManifestSha256 !== marker.parentManifestSha256 ||
      manifest.parentMarkerSha256 !== marker.parentMarkerSha256
    ) {
      throw new Error("Story-review chained marker does not match its archive lineage");
    }
    const parentMarkerPath = resolve(archivePath, manifest.parentMarkerFile.path);
    assertInside(archivePath, parentMarkerPath, "parent marker");
    const parentMarkerBytes = readFileSync(parentMarkerPath);
    if (
      manifest.parentMarkerFile.path !== "parent-marker.json" ||
      parentMarkerBytes.byteLength !== manifest.parentMarkerFile.sizeBytes ||
      sha256Bytes(parentMarkerBytes) !== manifest.parentMarkerFile.sha256 ||
      sha256Bytes(parentMarkerBytes) !== marker.parentMarkerSha256
    ) {
      throw new Error("Story-review parent marker file does not match chained provenance");
    }
    const parentMarker = StoryReviewVariantMarkerSchema.parse(
      JSON.parse(parentMarkerBytes.toString("utf8")) as unknown,
    );
    if (
      parentMarker.toSourceGitSha !== marker.fromSourceGitSha ||
      parentMarker.manifestSha256 !== marker.parentManifestSha256 ||
      parentMarker.variantConfigSha256 !== manifest.fromVariantConfigSha256 ||
      marker.lineageDepth !== markerLineageDepth(parentMarker) + 1 ||
      Math.abs(parentMarker.carriedExposureUsd - manifest.priorLineageExposureUsd) >
        MONEY_EPSILON_USD
    ) {
      throw new Error("Story-review parent marker does not match chained provenance");
    }
    validateMarkerArchive(parentMarker, archiveRoot, visitedArchives);
  } else if (manifest.archiveSchemaVersion !== ARCHIVE_SCHEMA_VERSION) {
    throw new Error("Story-review marker and archive schema versions disagree");
  }
  validateManifestFiles(manifest, resolve(archivePath, "stories"), archivePath);
  visitedArchives.delete(marker.archiveDirectory);
}

export function storyReviewLedgerSourceId(
  sourceGitSha: string,
  marker: StoryReviewVariantMarker | null,
): string {
  if (marker === null) return `fresh:${sourceGitSha}`;
  if (marker.toSourceGitSha !== sourceGitSha) {
    throw new Error("Story-review variant marker uses a different source Git SHA");
  }
  return `fresh:${sourceGitSha}:${marker.manifestSha256}`;
}

export function storyReviewVariantArchiveReference(marker: StoryReviewVariantMarker) {
  return StoryReviewVariantArchiveReferenceSchema.parse({
    archiveDirectory: marker.archiveDirectory,
    carriedExposureUsd: marker.carriedExposureUsd,
    fromSourceGitSha: marker.fromSourceGitSha,
    manifestSha256: marker.manifestSha256,
    reason: marker.reason,
    toSourceGitSha: marker.toSourceGitSha,
    variantConfigSha256: marker.variantConfigSha256,
    ...(marker.markerSchemaVersion === CHAINED_MARKER_SCHEMA_VERSION
      ? {
          lineageDepth: marker.lineageDepth,
          parentManifestSha256: marker.parentManifestSha256,
          parentMarkerSha256: marker.parentMarkerSha256,
        }
      : {}),
  });
}

export function assertStoryReviewVariantLedger(
  snapshot: LiveSpendSnapshot,
  marker: StoryReviewVariantMarker,
): void {
  if (snapshot.totalCapUsd !== STORY_REVIEW_TOTAL_CAP_USD) {
    throw new Error("Story-review ledger does not use the authorized quality-variant cap");
  }
  if (snapshot.sourceReportSha256 !== storyReviewLedgerSourceId(marker.toSourceGitSha, marker)) {
    throw new Error("Story-review ledger source does not match the quality-variant archive");
  }
  if (Math.abs(snapshot.priorSpendUsd - marker.carriedExposureUsd) > MONEY_EPSILON_USD) {
    throw new Error(
      "Story-review ledger carried exposure does not match the quality-variant archive",
    );
  }
  if (snapshot.baselineAttemptCostUsd !== 0) {
    throw new Error("Story-review ledger baseline does not match the quality-variant archive");
  }
}

function inspectArchivedStories(
  storyPath: string,
  expectedGitSha: string,
  expectedPromptVersion: string,
): {
  readonly stories: z.infer<typeof ArchiveStorySchema>[];
  readonly uniqueResponseCostUsd: number;
  readonly uniqueResponseCount: number;
} {
  const globalResponses = new Map<string, number>();
  const stories = CHARACTER_IDS.map((characterId) => {
    const databasePath = resolve(storyPath, `${characterId}.db`);
    if (!existsSync(databasePath)) {
      return ArchiveStorySchema.parse({
        characterId,
        committedChapters: 0,
        databasePresent: false,
        failedTurns: 0,
        traceRunIds: [],
        uniqueResponseCostUsd: 0,
        uniqueResponseCount: 0,
      });
    }
    const storyResponses = new Map<string, number>();
    const runIds: string[] = [];
    const database = new Database(databasePath, { fileMustExist: true, readonly: true });
    try {
      const committedRows = readTraceRows(database, "traces");
      const failedRows = readTraceRows(database, "failed_turn_traces");
      for (const row of committedRows) {
        const trace = PersistedTraceEnvelopeSchema.parse(JSON.parse(row.trace_json) as unknown);
        assertArchivedTrace(trace, expectedGitSha, expectedPromptVersion);
        recordTraceAttempts(trace.attempts, trace.totalEstimatedCostUsd, storyResponses);
        runIds.push(trace.runId);
      }
      for (const row of failedRows) {
        const trace = FailedTurnTraceSchema.parse(JSON.parse(row.trace_json) as unknown);
        assertArchivedTrace(trace, expectedGitSha, expectedPromptVersion);
        recordTraceAttempts(trace.attempts, trace.totalEstimatedCostUsd, storyResponses);
        runIds.push(trace.runId);
      }
      for (const [responseId, costNano] of storyResponses) {
        const priorCost = globalResponses.get(responseId);
        if (priorCost !== undefined) {
          throw new Error("Archived response ID is reused across stories");
        }
        globalResponses.set(responseId, costNano);
      }
      return ArchiveStorySchema.parse({
        characterId,
        committedChapters: committedRows.length,
        databasePresent: true,
        failedTurns: failedRows.length,
        traceRunIds: [...new Set(runIds)].sort(),
        uniqueResponseCostUsd: nanoToUsd(sumNanos(storyResponses.values())),
        uniqueResponseCount: storyResponses.size,
      });
    } finally {
      database.close();
    }
  });
  return {
    stories,
    uniqueResponseCostUsd: nanoToUsd(sumNanos(globalResponses.values())),
    uniqueResponseCount: globalResponses.size,
  };
}

function readTraceRows(
  database: Database.Database,
  table: string,
): { readonly trace_json: string }[] {
  const found = database
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { readonly found: number } | undefined;
  if (!found) throw new Error(`Story-review archive database lacks ${table}`);
  return database.prepare(`SELECT trace_json FROM ${table}`).all() as {
    readonly trace_json: string;
  }[];
}

function assertArchivedTrace(
  trace: { readonly gitSha: string; readonly promptVersion: string },
  expectedGitSha: string,
  expectedPromptVersion: string,
): void {
  if (trace.gitSha !== expectedGitSha || trace.promptVersion !== expectedPromptVersion) {
    throw new Error("Archived story-review trace uses a different source quality variant");
  }
}

function recordTraceAttempts(
  attempts: readonly z.infer<typeof RuntimeAttemptTraceSchema>[],
  traceCostUsd: number,
  responses: Map<string, number>,
): void {
  const traceCostNano = attempts.reduce((sum, attempt) => sum + usdToNano(attempt.costUsd), 0);
  if (traceCostNano !== usdToNano(traceCostUsd)) {
    throw new Error("Archived trace total does not match its runtime attempts");
  }
  for (const attempt of attempts) {
    const costNano = usdToNano(attempt.costUsd);
    if (attempt.responseId === null) {
      if (costNano !== 0) throw new Error("Archived response-less attempt has a nonzero cost");
      continue;
    }
    const priorCost = responses.get(attempt.responseId);
    if (priorCost !== undefined && priorCost !== costNano) {
      throw new Error("Archived response ID has conflicting trace costs");
    }
    responses.set(attempt.responseId, costNano);
  }
}

function validateManifest(
  manifest: z.infer<typeof StoryReviewVariantArchiveManifestSchema>,
  options: StoryReviewVariantMigrationOptions,
  archivedStoryPath: string,
  archivePath: string,
  exposureUsd: number,
  storyInspection: ReturnType<typeof inspectArchivedStories>,
  parentMarker: StoryReviewVariantMarker | null,
): void {
  if (
    manifest.fromSourceGitSha !== options.fromSourceGitSha ||
    manifest.toSourceGitSha !== options.toSourceGitSha ||
    manifest.toVariantConfigSha256 !== STORY_REVIEW_VARIANT_CONFIG_SHA256 ||
    sha256Json(manifest.fromVariant) !== manifest.fromVariantConfigSha256 ||
    sha256Json(manifest.toVariant) !== manifest.toVariantConfigSha256 ||
    Math.abs(manifest.carriedExposureUsd - exposureUsd) > MONEY_EPSILON_USD ||
    Math.abs(manifest.uniqueResponseCostUsd - storyInspection.uniqueResponseCostUsd) >
      MONEY_EPSILON_USD ||
    manifest.uniqueResponseCount !== storyInspection.uniqueResponseCount ||
    JSON.stringify(manifest.stories) !== JSON.stringify(storyInspection.stories)
  ) {
    throw new Error("Existing story-review variant manifest does not match this migration");
  }
  if (parentMarker === null) {
    if (
      manifest.archiveSchemaVersion !== ARCHIVE_SCHEMA_VERSION ||
      manifest.fromLedgerSourceId !== `fresh:${options.fromSourceGitSha}` ||
      manifest.fromTotalCapUsd !== PREVIOUS_TOTAL_CAP_USD ||
      manifest.fromVariantConfigSha256 !== sha256Json(PREVIOUS_VARIANT_CONFIG) ||
      Math.abs(manifest.uniqueResponseCostUsd - exposureUsd) > MONEY_EPSILON_USD
    ) {
      throw new Error("Existing initial story-review variant manifest is invalid");
    }
  } else {
    if (
      manifest.archiveSchemaVersion !== CHAINED_ARCHIVE_SCHEMA_VERSION ||
      manifest.fromLedgerSourceId !==
        storyReviewLedgerSourceId(options.fromSourceGitSha, parentMarker) ||
      manifest.fromTotalCapUsd !== STORY_REVIEW_TOTAL_CAP_USD ||
      manifest.fromVariantConfigSha256 !== REJECTED_VARIANT_CONFIG_SHA256 ||
      manifest.parentManifestSha256 !== parentMarker.manifestSha256 ||
      manifest.lineageDepth !== markerLineageDepth(parentMarker) + 1 ||
      Math.abs(manifest.priorLineageExposureUsd - parentMarker.carriedExposureUsd) >
        MONEY_EPSILON_USD ||
      Math.abs(manifest.priorLineageExposureUsd + manifest.uniqueResponseCostUsd - exposureUsd) >
        MONEY_EPSILON_USD
    ) {
      throw new Error("Existing chained story-review variant manifest is invalid");
    }
    validateParentMarkerFile(manifest, archivePath, parentMarker);
  }
  validateManifestFiles(manifest, archivedStoryPath, archivePath);
}

function validateManifestFiles(
  manifest: z.infer<typeof StoryReviewVariantArchiveManifestSchema>,
  archivedStoryPath: string,
  archivePath: string,
): void {
  const currentFiles = inventoryFiles(archivedStoryPath, archivePath);
  if (JSON.stringify(currentFiles) !== JSON.stringify(manifest.files)) {
    throw new Error("Story-review variant archive files do not match the manifest");
  }
}

function archiveParentMarker(
  archivePath: string,
  parentMarkerBytes: Buffer,
): z.infer<typeof ArchiveFileSchema> {
  const path = resolve(archivePath, "parent-marker.json");
  assertInside(archivePath, path, "parent marker");
  if (existsSync(path)) {
    const existing = readFileSync(path);
    if (!existing.equals(parentMarkerBytes)) {
      throw new Error("Archived parent marker differs from active lineage marker");
    }
  } else {
    writeAtomic(path, parentMarkerBytes.toString("utf8"));
  }
  return ArchiveFileSchema.parse({
    path: "parent-marker.json",
    sha256: sha256Bytes(parentMarkerBytes),
    sizeBytes: parentMarkerBytes.byteLength,
  });
}

function validateParentMarkerFile(
  manifest: z.infer<typeof StoryReviewVariantArchiveManifestV2Schema>,
  archivePath: string,
  parentMarker: StoryReviewVariantMarker,
): void {
  const path = resolve(archivePath, manifest.parentMarkerFile.path);
  assertInside(archivePath, path, "parent marker");
  const bytes = readFileSync(path);
  if (
    manifest.parentMarkerFile.path !== "parent-marker.json" ||
    bytes.byteLength !== manifest.parentMarkerFile.sizeBytes ||
    sha256Bytes(bytes) !== manifest.parentMarkerFile.sha256 ||
    sha256Bytes(bytes) !== manifest.parentMarkerSha256 ||
    JSON.stringify(
      StoryReviewVariantMarkerSchema.parse(JSON.parse(bytes.toString("utf8")) as unknown),
    ) !== JSON.stringify(parentMarker)
  ) {
    throw new Error("Story-review parent marker does not match the chained manifest");
  }
}

function markerLineageDepth(marker: StoryReviewVariantMarker): number {
  return marker.markerSchemaVersion === CHAINED_MARKER_SCHEMA_VERSION ? marker.lineageDepth : 1;
}

function inventoryFiles(storyPath: string, archivePath: string) {
  const paths: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) throw new Error("Story-review archive rejects symbolic links");
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) paths.push(path);
      else throw new Error("Story-review archive contains an unsupported filesystem entry");
    }
  };
  visit(storyPath);
  return paths
    .sort((left, right) => left.localeCompare(right))
    .map((path) => {
      const bytes = readFileSync(path);
      return ArchiveFileSchema.parse({
        path: relative(archivePath, path).replaceAll("\\", "/"),
        sha256: sha256Bytes(bytes),
        sizeBytes: bytes.byteLength,
      });
    });
}

function withVariantLedgerLock<T>(
  ledgerPath: string,
  operation: (ledger: LiveSpendLedger) => T,
): T {
  const initialSnapshot = readLiveSpendSnapshot(ledgerPath);
  if (
    initialSnapshot.totalCapUsd !== PREVIOUS_TOTAL_CAP_USD &&
    initialSnapshot.totalCapUsd !== STORY_REVIEW_TOTAL_CAP_USD
  ) {
    throw new Error("Story-review ledger uses an unauthorized cap");
  }
  const ledger = new LiveSpendLedger(ledgerPath, initialSnapshot.totalCapUsd);
  let ownsRun = false;
  try {
    const lock = readLedgerLock(ledgerPath);
    if (lock === null) {
      ledger.acquireRun(STORY_REVIEW_VARIANT_MIGRATION_RUN_ID);
    } else {
      if (lock !== STORY_REVIEW_VARIANT_MIGRATION_RUN_ID) {
        throw new Error(`Story-review spend ledger is locked by run ${lock}`);
      }
      const snapshot = ledger.snapshot();
      if (snapshot.sourceReportSha256 === null || snapshot.uncertainReservationCostUsd !== 0) {
        throw new Error("Variant migration cannot recover an uninitialized or uncertain ledger");
      }
      ledger.recoverStaleRun(
        STORY_REVIEW_VARIANT_MIGRATION_RUN_ID,
        {
          attemptCostUsd: snapshot.baselineAttemptCostUsd,
          priorSpendUsd: snapshot.priorSpendUsd,
          sourceReportSha256: snapshot.sourceReportSha256,
        },
        snapshot.baselineAttemptCostUsd + snapshot.knownReservationCostUsd,
      );
    }
    ownsRun = true;
    return operation(ledger);
  } finally {
    if (ownsRun && ledger.snapshot().activeReservationCount === 0) {
      ledger.releaseRun(STORY_REVIEW_VARIANT_MIGRATION_RUN_ID);
    }
    ledger.close();
  }
}

function foldOwnedVariantExposure(ledger: LiveSpendLedger, marker: StoryReviewVariantMarker): void {
  const expectedNewSourceId = storyReviewLedgerSourceId(marker.toSourceGitSha, marker);
  let snapshot = ledger.snapshot();
  if (
    snapshot.activeReservationCount !== 0 ||
    snapshot.uncertainReservationCostUsd !== 0 ||
    Math.abs(snapshot.totalExposureUsd - marker.carriedExposureUsd) > MONEY_EPSILON_USD
  ) {
    throw new Error("Variant migration requires exact settled durable exposure");
  }
  const oldSourceId =
    marker.markerSchemaVersion === CHAINED_MARKER_SCHEMA_VERSION
      ? `fresh:${marker.fromSourceGitSha}:${marker.parentManifestSha256}`
      : `fresh:${marker.fromSourceGitSha}`;
  const usesOldSource = snapshot.sourceReportSha256 === oldSourceId;
  const usesNewSource = snapshot.sourceReportSha256 === expectedNewSourceId;
  if (!usesOldSource && !usesNewSource) {
    throw new Error("Story-review ledger source does not match the old or migrated variant");
  }
  if (usesNewSource && snapshot.totalCapUsd !== STORY_REVIEW_TOTAL_CAP_USD) {
    throw new Error("Migrated story-review ledger does not use the authorized total cap");
  }
  if (snapshot.totalCapUsd === PREVIOUS_TOTAL_CAP_USD) {
    ledger.increaseTotalCap(STORY_REVIEW_VARIANT_MIGRATION_RUN_ID, STORY_REVIEW_TOTAL_CAP_USD);
    snapshot = ledger.snapshot();
  }
  if (snapshot.totalCapUsd !== STORY_REVIEW_TOTAL_CAP_USD) {
    throw new Error("Variant migration did not apply the authorized total cap");
  }
  if (usesOldSource) {
    ledger.synchronizeBaseline(STORY_REVIEW_VARIANT_MIGRATION_RUN_ID, {
      attemptCostUsd: 0,
      priorSpendUsd: snapshot.totalExposureUsd,
      sourceReportSha256: expectedNewSourceId,
    });
  } else if (
    snapshot.sourceReportSha256 !== expectedNewSourceId ||
    snapshot.priorSpendUsd !== marker.carriedExposureUsd ||
    snapshot.baselineAttemptCostUsd !== 0 ||
    snapshot.knownReservationCostUsd !== 0
  ) {
    throw new Error("Story-review ledger does not match the old or migrated variant source");
  }
  assertStoryReviewVariantLedger(ledger.snapshot(), marker);
}

function assertMigratableLedger(
  snapshot: ReturnType<typeof readLiveSpendSnapshot>,
  fromSourceGitSha: string,
): void {
  if (
    snapshot.totalCapUsd !== PREVIOUS_TOTAL_CAP_USD ||
    snapshot.sourceReportSha256 !== `fresh:${fromSourceGitSha}` ||
    snapshot.activeReservationCount !== 0 ||
    snapshot.uncertainReservationCostUsd !== 0
  ) {
    throw new Error("Story-review ledger is not settled on the requested source lineage");
  }
}

function assertChainedMigratableLedger(
  snapshot: ReturnType<typeof readLiveSpendSnapshot>,
  fromSourceGitSha: string,
  parentMarker: StoryReviewVariantMarker,
): void {
  const currentVariantExposureUsd = roundMoney(
    snapshot.totalExposureUsd - parentMarker.carriedExposureUsd,
  );
  if (
    snapshot.totalCapUsd !== STORY_REVIEW_TOTAL_CAP_USD ||
    snapshot.sourceReportSha256 !== storyReviewLedgerSourceId(fromSourceGitSha, parentMarker) ||
    snapshot.activeReservationCount !== 0 ||
    snapshot.uncertainReservationCostUsd !== 0 ||
    snapshot.baselineAttemptCostUsd !== 0 ||
    Math.abs(snapshot.priorSpendUsd - parentMarker.carriedExposureUsd) > MONEY_EPSILON_USD ||
    Math.abs(snapshot.knownReservationCostUsd - currentVariantExposureUsd) > MONEY_EPSILON_USD ||
    currentVariantExposureUsd < 0
  ) {
    throw new Error("Story-review ledger is not settled on the requested chained lineage");
  }
}

function readLedgerLock(path: string): string | null {
  const database = new Database(path, { fileMustExist: true, readonly: true });
  try {
    const row = database.prepare("SELECT run_id FROM run_lock WHERE id = 1").get() as
      { readonly run_id: string } | undefined;
    return row?.run_id ?? null;
  } finally {
    database.close();
  }
}

function validatedPaths(options: StoryReviewVariantMigrationOptions) {
  if (!/^[a-f0-9]{40}$/u.test(options.fromSourceGitSha)) {
    throw new Error("Variant migration from-source Git SHA is invalid");
  }
  if (!/^[a-f0-9]{40}$/u.test(options.toSourceGitSha)) {
    throw new Error("Variant migration to-source Git SHA is invalid");
  }
  if (options.fromSourceGitSha === options.toSourceGitSha) {
    throw new Error("Variant migration requires a new source Git SHA");
  }
  const reportDirectory = resolve(options.reportDirectory);
  const paths = {
    archiveRoot: resolve(options.archiveRoot),
    ledgerPath: resolve(options.ledgerPath),
    markerPath: resolve(options.markerPath),
    reportDirectory,
    storyDirectory: resolve(options.storyDirectory),
  };
  for (const [label, path] of Object.entries(paths)) {
    if (label === "reportDirectory") continue;
    assertInside(reportDirectory, path, label);
  }
  return paths;
}

function assertInside(parent: string, child: string, label: string): void {
  const relativePath = relative(parent, child);
  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    resolve(parent, relativePath) !== child
  ) {
    throw new Error(`${label} must stay inside its expected parent directory`);
  }
}

function writeAtomic(path: string, value: string): void {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, value, "utf8");
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
  }
}

function usdToNano(value: number): number {
  const nano = Math.round(value * 1_000_000_000);
  if (!Number.isSafeInteger(nano) || nano < 0) throw new Error("Archive cost is invalid");
  return nano;
}

function nanoToUsd(value: number): number {
  return value / 1_000_000_000;
}

function sumNanos(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function roundMoney(value: number): number {
  return nanoToUsd(usdToNano(value));
}

function sha256Json(value: unknown): string {
  return sha256Bytes(Buffer.from(JSON.stringify(value)));
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
