import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  CHARACTER_IDS,
  PROMPT_VERSION,
  WorldStateSchema,
  buildPovContext,
  resolveTurn,
  stageWorldDelta,
  type ChapterRecord,
} from "@infinite-litrpg/shared";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  REVIEW_STORY_MODELS,
  initialChoices,
  loadSeedWorld,
} from "../app/src/server/story/story-service";
import {
  buildStoryReviewServiceOptions,
  buildStoryReviewWorkspaceOptions,
  createStoryReviewWorkspace,
  createStoryReviewClient,
  readStoryReviewProgress,
  requireStoryReviewLedgerState,
  runStoryReviewGenerationSchedule,
  storyReviewDatabasePath,
  storyReviewPromptCacheKey,
  storyReviewStoryId,
  storyReviewTitle,
} from "./run-story-review";

import {
  STORY_REVIEW_CHAPTERS_PER_STORY,
  STORY_REVIEW_BRANCH_POLICY,
  STORY_REVIEW_SCHEMA_VERSION,
  STORY_REVIEW_SOURCE_BRIDGE_FROM_GIT_SHA,
  STORY_REVIEW_SOURCE_BRIDGE_INTERMEDIATE_GIT_SHA,
  STORY_REVIEW_SOURCE_BRIDGE_PATHS,
  STORY_REVIEW_SOURCE_VARIANT_CONFIG_SHA256,
  STORY_REVIEW_TOTAL_CAP_USD,
  STORY_REVIEW_VARIANT_CONFIG_SHA256,
  StoryReviewEvidenceSchema,
  StoryReviewSourceEvidenceSchema,
  assertStoryReviewDatabaseQuality,
  buildStoryReviewChapter,
  buildStoryReviewEvidence,
  buildStoryReviewMarkdown,
  buildStoryReviewPreflight,
  buildStoryReviewSourceBridge,
  mergeStoryReviewHumanSections,
  parseStoryReviewWorktreePaths,
  parseStoryReviewArgs,
  selectStoryReviewChoice,
  splitStoryReviewGitLines,
  storyReviewMarkdownMatches,
  validateStoryReviewBranch,
  validateStoryReviewGitBridge,
  validateStoryReviewPrefix,
  validateStoryReviewSourceIdentities,
} from "./story-review";

describe("ten-chapter story review evidence", () => {
  it("binds the unbounded quality variant to one exact Git child and file set", () => {
    const toSourceGitSha = "d".repeat(40);
    const bridge = buildStoryReviewSourceBridge({
      changedPaths: STORY_REVIEW_SOURCE_BRIDGE_PATHS,
      diffSha256: "e".repeat(64),
      fromSourceGitSha: STORY_REVIEW_SOURCE_BRIDGE_FROM_GIT_SHA,
      intermediateSourceGitSha: STORY_REVIEW_SOURCE_BRIDGE_INTERMEDIATE_GIT_SHA,
      toSourceGitSha,
    });
    expect(bridge).toEqual({
      changedPaths: STORY_REVIEW_SOURCE_BRIDGE_PATHS,
      diffSha256: "e".repeat(64),
      fromSourceGitSha: STORY_REVIEW_SOURCE_BRIDGE_FROM_GIT_SHA,
      fromVariantConfigSha256: STORY_REVIEW_SOURCE_VARIANT_CONFIG_SHA256,
      intermediateSourceGitSha: STORY_REVIEW_SOURCE_BRIDGE_INTERMEDIATE_GIT_SHA,
      reason: "unbounded-generation-and-fixed-quality-bar",
      toSourceGitSha,
      toVariantConfigSha256: STORY_REVIEW_VARIANT_CONFIG_SHA256,
    });
    expect(() =>
      buildStoryReviewSourceBridge({
        changedPaths: STORY_REVIEW_SOURCE_BRIDGE_PATHS.slice(0, -1),
        diffSha256: "e".repeat(64),
        fromSourceGitSha: STORY_REVIEW_SOURCE_BRIDGE_FROM_GIT_SHA,
        intermediateSourceGitSha: STORY_REVIEW_SOURCE_BRIDGE_INTERMEDIATE_GIT_SHA,
        toSourceGitSha,
      }),
    ).toThrow(/approved hotfix/u);
    expect(() =>
      buildStoryReviewSourceBridge({
        changedPaths: STORY_REVIEW_SOURCE_BRIDGE_PATHS,
        diffSha256: "e".repeat(64),
        fromSourceGitSha: "f".repeat(40),
        intermediateSourceGitSha: STORY_REVIEW_SOURCE_BRIDGE_INTERMEDIATE_GIT_SHA,
        toSourceGitSha,
      }),
    ).toThrow();

    const base = fixtureEvidence();
    const bridgedEvidence = {
      ...base,
      qualityVariantArchive: {
        ...base.qualityVariantArchive,
        toSourceGitSha: STORY_REVIEW_SOURCE_BRIDGE_FROM_GIT_SHA,
        variantConfigSha256: STORY_REVIEW_SOURCE_VARIANT_CONFIG_SHA256,
      },
      sourceBridge: bridge,
      sourceGitSha: toSourceGitSha,
      stories: base.stories.map((story) => ({
        ...story,
        chapters: story.chapters.map((chapter) => ({
          ...chapter,
          sourceGitSha: toSourceGitSha,
        })),
      })),
    };
    expect(StoryReviewEvidenceSchema.safeParse(bridgedEvidence).success).toBe(true);
    expect(
      StoryReviewEvidenceSchema.safeParse({
        ...bridgedEvidence,
        qualityVariantArchive: {
          ...bridgedEvidence.qualityVariantArchive,
          variantConfigSha256: STORY_REVIEW_VARIANT_CONFIG_SHA256,
        },
      }).success,
    ).toBe(false);
    expect(
      StoryReviewEvidenceSchema.safeParse({
        ...bridgedEvidence,
        sourceBridge: undefined,
      }).success,
    ).toBe(false);
    expect(
      StoryReviewEvidenceSchema.safeParse({
        ...bridgedEvidence,
        sourceBridge: {
          ...bridge,
          fromVariantConfigSha256: STORY_REVIEW_VARIANT_CONFIG_SHA256,
        },
      }).success,
    ).toBe(false);
  });

  it("disables invisible SDK retries so every provider attempt is reserved", () => {
    expect(createStoryReviewClient("test-key").maxRetries).toBe(0);
  });

  it("generates all six stories in one stretch with at most two concurrent", async () => {
    const started: string[] = [];
    const completed: string[] = [];
    let active = 0;
    let maximumActive = 0;

    await runStoryReviewGenerationSchedule(async (characterId) => {
      started.push(characterId);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      completed.push(characterId);
    });

    expect(maximumActive).toBe(2);
    expect(started).toEqual(CHARACTER_IDS);
    expect(completed).toEqual(CHARACTER_IDS);
  });

  it("binds the quality variant to exact models, quality gates, and stable POV cache keys", () => {
    const costHooks = {
      markUncertain: () => undefined,
      reserve: () => undefined,
      settle: () => undefined,
    };

    expect(buildStoryReviewServiceOptions("rowan-ashborn", costHooks)).toEqual({
      costHooks,
      enforceNarrativeQuality: true,
      maxBackgroundAgents: 3,
      maxCostUsdPerChapter: null,
      modelConfig: REVIEW_STORY_MODELS,
      nativeMultiAgent: false,
      promptCacheKey: storyReviewPromptCacheKey("rowan-ashborn"),
      serviceTier: "flex",
    });
    expect(REVIEW_STORY_MODELS).toEqual({
      audit: { model: "gpt-5.6-terra", reasoningEffort: "low" },
      frame: { model: "gpt-5.6-sol", reasoningEffort: "medium" },
      narration: { model: "gpt-5.6-sol", reasoningEffort: "medium" },
    });
    expect(storyReviewPromptCacheKey("rowan-ashborn")).toBe(
      storyReviewPromptCacheKey("rowan-ashborn"),
    );
    expect(storyReviewPromptCacheKey("rowan-ashborn")).not.toBe(
      storyReviewPromptCacheKey("elara-voss"),
    );
  });

  it("uses canonical review story directories without replacing unrelated stories", async () => {
    const rootDirectory = mkdtempSync(resolve(tmpdir(), "story-review-workspace-"));
    const client = createStoryReviewClient("test-key");
    const costHooks = {
      markUncertain: () => undefined,
      reserve: () => undefined,
      settle: () => undefined,
    };
    const options = buildStoryReviewWorkspaceOptions(client, costHooks, rootDirectory);
    const workspace = createStoryReviewWorkspace(client, costHooks, rootDirectory);

    try {
      expect(options.rootDirectory).toBe(resolve(rootDirectory));
      expect(typeof options.serviceOptions).toBe("function");
      await workspace.createStory({
        id: "imported-ashen-crown",
        povCharacterId: "rowan-ashborn",
        title: "Imported Ashen Crown",
      });
      const created = await workspace.createStory({
        id: storyReviewStoryId("rowan-ashborn"),
        povCharacterId: "rowan-ashborn",
        title: storyReviewTitle("rowan-ashborn"),
      });
      await workspace.close();

      expect(created.metadata.id).toBe("review-rowan-ashborn");
      expect(created.metadata.title).toBe("Ashen Crown — Rowan Ashborn");
      expect(storyReviewDatabasePath("rowan-ashborn", rootDirectory)).toBe(
        resolve(rootDirectory, "review-rowan-ashborn", "story.db"),
      );
      expect(existsSync(storyReviewDatabasePath("rowan-ashborn", rootDirectory))).toBe(true);
      expect(existsSync(resolve(rootDirectory, "imported-ashen-crown", "story.db"))).toBe(true);
      expect(
        JSON.parse(readFileSync(resolve(rootDirectory, "library.json"), "utf8")),
      ).toMatchObject({
        stories: expect.arrayContaining([
          expect.objectContaining({ id: "imported-ashen-crown" }),
          expect.objectContaining({
            chapterCount: 0,
            id: "review-rowan-ashborn",
            povCharacterId: "rowan-ashborn",
          }),
        ]),
      });
      expect(readStoryReviewProgress("a".repeat(40), rootDirectory)).toEqual({
        byCharacter: Object.fromEntries(CHARACTER_IDS.map((id) => [id, 0])),
        completedChapters: 0,
      });
    } finally {
      await workspace.close();
      rmSync(rootDirectory, { force: true, recursive: true });
    }
  });

  it("blocks a provenance-valid pack when one POV fails provider-free quality gates", () => {
    const databasePath = resolve(tmpdir(), `story-review-quality-${randomUUID()}.db`);
    writeLoopingStoryDatabase(databasePath);
    try {
      expect(() => assertStoryReviewDatabaseQuality("rowan-ashborn", databasePath)).toThrow(
        /rowan-ashborn.*dialogue-presence.*scene-movement-streak/iu,
      );
    } finally {
      rmSync(databasePath, { force: true });
      rmSync(`${databasePath}-shm`, { force: true });
      rmSync(`${databasePath}-wal`, { force: true });
    }
  });

  it("prints recovery first, blocks orphaned active work, and permits charged uncertainty", () => {
    const marker = {
      archiveDirectory: `${"b".repeat(40)}-to-${"a".repeat(40)}`,
      carriedExposureUsd: 0.05,
      fromSourceGitSha: "b".repeat(40),
      manifestSha256: "c".repeat(64),
      markerSchemaVersion: "1.0.0-story-review-variant-marker" as const,
      reason: "narration-route-reversal-and-repetitive-branching" as const,
      toSourceGitSha: "a".repeat(40),
      variantConfigSha256: STORY_REVIEW_VARIANT_CONFIG_SHA256,
    };
    const snapshot = {
      activeReservationCount: 0,
      baselineAttemptCostUsd: 0,
      headroomUsd: 5.018,
      knownReservationCostUsd: 0,
      priorSpendUsd: 0.05,
      sourceReportSha256: `fresh:${"a".repeat(40)}:${"c".repeat(64)}`,
      totalCapUsd: STORY_REVIEW_TOTAL_CAP_USD,
      totalExposureUsd: 0.07,
      uncertainReservationCostUsd: 0.02,
    };

    expect(() =>
      requireStoryReviewLedgerState(
        { runId: "00000000-0000-4000-8000-000000000610", snapshot },
        marker,
      ),
    ).toThrow(/review:stories:recover/iu);
    expect(
      requireStoryReviewLedgerState({ runId: null, snapshot }, marker).uncertainReservationCostUsd,
    ).toBe(0.02);
    expect(() =>
      requireStoryReviewLedgerState(
        { runId: null, snapshot: { ...snapshot, activeReservationCount: 1 } },
        marker,
      ),
    ).toThrow(/interruption reconciliation/iu);
  });

  it("publishes only a committed, audited runtime chapter with response provenance", () => {
    const demo = readCurrentDemo();
    const trace = demo.result.trace as { readonly acceptedDelta: unknown };

    const chapter = buildStoryReviewChapter(
      "rowan-ashborn",
      demo.result.canonicalNarrativeInput.chapterRecord,
      demo.result.trace,
    );

    expect(chapter.chapter).toBe(1);
    expect(chapter.auditApproved).toBe(true);
    expect(chapter.responseIds.length).toBeGreaterThan(0);
    expect(chapter.proseHash).toBe(sha256(chapter.prose));
    expect(chapter.chapterRecordHash).toBe(
      sha256(JSON.stringify(demo.result.canonicalNarrativeInput.chapterRecord)),
    );
    expect(chapter.chosenAction).toBe("Confront Nyra Vale about what must happen next.");
    expect(chapter.adapterMode).toBe("sequential");
    expect(chapter.serviceTier).toBe("flex");
    expect(
      validateStoryReviewPrefix(
        "rowan-ashborn",
        chapter.sourceGitSha,
        [
          {
            chapter: demo.result.canonicalNarrativeInput.chapterRecord,
            delta: trace.acceptedDelta,
            trace: demo.result.trace,
          },
        ],
        demo.result.canonicalNarrativeInput.stateAfter,
      ),
    ).toBe(1);
    expect(() =>
      validateStoryReviewPrefix(
        "rowan-ashborn",
        "b".repeat(40),
        [
          {
            chapter: demo.result.canonicalNarrativeInput.chapterRecord,
            delta: trace.acceptedDelta,
            trace: demo.result.trace,
          },
        ],
        demo.result.canonicalNarrativeInput.stateAfter,
      ),
    ).toThrow(/source Git/u);
  });

  it("accepts canonical nano-USD trace cost within raw Flex repricing tolerance", () => {
    const demo = readCurrentDemo();
    const chapter = structuredClone(demo.result.canonicalNarrativeInput.chapterRecord) as {
      estimatedCostUsd: number;
      usage: Record<string, number>;
    };
    const trace = structuredClone(demo.result.trace) as {
      attempts: {
        costUsd: number;
        model: string;
        phase: string;
        responseId: string | null;
        usage: Record<string, number>;
      }[];
      calls: {
        estimatedCostUsd: number;
        model: string;
        phase: string;
        responseId: string;
        usage: Record<string, number>;
      }[];
      totalEstimatedCostUsd: number;
      totalUsage: Record<string, number>;
    };
    const auditAttempt = trace.attempts.find(({ phase }) => phase === "audit")!;
    const auditCall = trace.calls.find(({ responseId }) => responseId === auditAttempt.responseId)!;
    const terraFlexUsage = {
      cacheWriteTokens: 3_167,
      cachedInputTokens: 0,
      inputTokens: 3_170,
      outputTokens: 319,
      reasoningTokens: 266,
      totalTokens: 3_489,
    };
    auditAttempt.costUsd = 0.007_344_688;
    auditAttempt.model = "gpt-5.6-terra";
    auditAttempt.usage = terraFlexUsage;
    auditCall.estimatedCostUsd = 0.007_344_688;
    auditCall.model = "gpt-5.6-terra";
    auditCall.usage = terraFlexUsage;
    trace.totalEstimatedCostUsd = trace.attempts.reduce((sum, attempt) => sum + attempt.costUsd, 0);
    trace.totalUsage = trace.attempts.reduce<Record<string, number>>((total, attempt) => {
      for (const [key, value] of Object.entries(attempt.usage)) {
        total[key] = (total[key] ?? 0) + value;
      }
      return total;
    }, {});
    chapter.estimatedCostUsd = trace.totalEstimatedCostUsd;
    chapter.usage = trace.totalUsage;

    expect(() => buildStoryReviewChapter("rowan-ashborn", chapter, trace)).not.toThrow();
  });

  it("rejects chapter and trace usage totals that could not commit atomically", () => {
    const demo = readCurrentDemo();
    const tampered = structuredClone(demo.result.canonicalNarrativeInput.chapterRecord) as {
      usage: { totalTokens: number };
    };
    tampered.usage.totalTokens += 1;

    expect(() => buildStoryReviewChapter("rowan-ashborn", tampered, demo.result.trace)).toThrow(
      /usage/iu,
    );

    const missingAttempts = structuredClone(demo.result.trace) as { attempts: unknown[] };
    missingAttempts.attempts = [];
    expect(() =>
      buildStoryReviewChapter(
        "rowan-ashborn",
        demo.result.canonicalNarrativeInput.chapterRecord,
        missingAttempts,
      ),
    ).toThrow(/attempt/iu);

    const unboundCall = structuredClone(demo.result.trace) as {
      calls: { responseId: string }[];
    };
    unboundCall.calls[0]!.responseId = "resp_unbound_review_call";
    expect(() =>
      buildStoryReviewChapter(
        "rowan-ashborn",
        demo.result.canonicalNarrativeInput.chapterRecord,
        unboundCall,
      ),
    ).toThrow(/call.*attempt/iu);

    const wrongVersions = structuredClone(demo.result.trace) as {
      pricingVersion: string;
      schemaVersion: string;
    };
    wrongVersions.pricingVersion = "bogus-pricing";
    wrongVersions.schemaVersion = "bogus-schema";
    expect(() =>
      buildStoryReviewChapter(
        "rowan-ashborn",
        demo.result.canonicalNarrativeInput.chapterRecord,
        wrongVersions,
      ),
    ).toThrow(/pricing|schema/iu);

    const zeroCostChapter = structuredClone(demo.result.canonicalNarrativeInput.chapterRecord) as {
      estimatedCostUsd: number;
    };
    zeroCostChapter.estimatedCostUsd = 0;
    const zeroCostTrace = structuredClone(demo.result.trace) as {
      attempts: { costUsd: number }[];
      calls: { estimatedCostUsd: number }[];
      totalEstimatedCostUsd: number;
    };
    zeroCostTrace.totalEstimatedCostUsd = 0;
    zeroCostTrace.attempts.forEach((attempt) => {
      attempt.costUsd = 0;
    });
    zeroCostTrace.calls.forEach((call) => {
      call.estimatedCostUsd = 0;
    });
    expect(() => buildStoryReviewChapter("rowan-ashborn", zeroCostChapter, zeroCostTrace)).toThrow(
      /priced/iu,
    );

    const refusedCall = structuredClone(demo.result.trace) as {
      calls: { refusal: boolean }[];
    };
    refusedCall.calls[0]!.refusal = true;
    expect(() =>
      buildStoryReviewChapter(
        "rowan-ashborn",
        demo.result.canonicalNarrativeInput.chapterRecord,
        refusedCall,
      ),
    ).toThrow(/model call/iu);
  });

  it("accepts a complete product retry group without double-counting its final call", () => {
    const demo = readCurrentDemo();
    const retriedTrace = structuredClone(demo.result.trace) as {
      attempts: {
        agentId: string | null;
        attempt: number;
        costUsd: number;
        errorCode: string | null;
        latencyMs: number;
        model: string;
        phase: string;
        requestedServiceTier: string;
        responseId: string | null;
        serviceTier: string | null;
        usage: Record<string, number>;
      }[];
      calls: { retries: number }[];
    };
    const finalAttempt = retriedTrace.attempts[0]!;
    const failedAttempt = structuredClone(finalAttempt);
    failedAttempt.attempt = 0;
    failedAttempt.costUsd = 0;
    failedAttempt.errorCode = "TIMEOUT";
    failedAttempt.responseId = null;
    failedAttempt.serviceTier = null;
    failedAttempt.usage = Object.fromEntries(
      Object.keys(failedAttempt.usage).map((key) => [key, 0]),
    );
    finalAttempt.attempt = 1;
    retriedTrace.attempts.unshift(failedAttempt);
    retriedTrace.calls[0]!.retries = 1;

    expect(() =>
      buildStoryReviewChapter(
        "rowan-ashborn",
        demo.result.canonicalNarrativeInput.chapterRecord,
        retriedTrace,
      ),
    ).not.toThrow();
  });

  it("rejects a soft-zero narrative score even when the runtime audit marked it approved", () => {
    const demo = readCurrentDemo();
    const chapter = structuredClone(demo.result.canonicalNarrativeInput.chapterRecord) as {
      narrativeAudit: {
        evidence: { dimension: string; issueCode: string }[];
        scores: Record<string, number>;
      };
    };
    chapter.narrativeAudit.scores.choiceFulfillment = 0;
    const evidence = chapter.narrativeAudit.evidence.find(
      ({ dimension }) => dimension === "choiceFulfillment",
    )!;
    evidence.issueCode = "choice-not-fulfilled";

    expect(() => buildStoryReviewChapter("rowan-ashborn", chapter, demo.result.trace)).toThrow(
      /every narrative audit dimension/iu,
    );
  });

  it("rejects reused source trace, request, and response identities", () => {
    const chapter = (requestId: string | undefined, runId: string, responseId: string) => ({
      chapterRecord: { requestId },
      trace: { attempts: [{ responseId }], runId },
    });
    const first = chapter(
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000101",
      "resp_story_review_1",
    );
    const second = chapter(
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000102",
      "resp_story_review_2",
    );

    expect(() =>
      validateStoryReviewSourceIdentities([{ chapters: [first, second] }]),
    ).not.toThrow();
    expect(() =>
      validateStoryReviewSourceIdentities([
        { chapters: [first, { ...second, trace: { ...second.trace, runId: first.trace.runId } }] },
      ]),
    ).toThrow(/trace IDs/iu);
    expect(() =>
      validateStoryReviewSourceIdentities([
        {
          chapters: [
            first,
            { ...second, chapterRecord: { requestId: first.chapterRecord.requestId } },
          ],
        },
      ]),
    ).toThrow(/request IDs/iu);
    expect(() =>
      validateStoryReviewSourceIdentities([
        {
          chapters: [
            first,
            {
              ...second,
              trace: { ...second.trace, attempts: [{ responseId: "resp_story_review_1" }] },
            },
          ],
        },
      ]),
    ).toThrow(/response IDs/iu);
    expect(() =>
      validateStoryReviewSourceIdentities([
        {
          chapters: [first, { ...second, chapterRecord: { requestId: undefined } }],
        },
      ]),
    ).toThrow(/lacks a runtime request ID/iu);
  });

  it("accepts only documented review files between runtime source and checkout", () => {
    expect(() =>
      validateStoryReviewGitBridge({
        committedPaths: ["README.md", "docs/SAMPLE_STORIES.md", "docs/STATUS.md"],
        sourceIsAncestor: true,
        worktreePaths: ["docs/story-review-evidence.json"],
      }),
    ).not.toThrow();
    expect(() =>
      validateStoryReviewGitBridge({
        committedPaths: [],
        sourceIsAncestor: false,
        worktreePaths: [],
      }),
    ).toThrow(/not an ancestor/iu);
    expect(() =>
      validateStoryReviewGitBridge({
        committedPaths: ["app/src/server/story/story-service.ts"],
        sourceIsAncestor: true,
        worktreePaths: [],
      }),
    ).toThrow(/stale.*committed/iu);
    expect(() =>
      validateStoryReviewGitBridge({
        committedPaths: [],
        sourceIsAncestor: true,
        worktreePaths: ["shared/src/contracts/chapter.ts"],
      }),
    ).toThrow(/stale.*worktree/iu);
    expect(parseStoryReviewWorktreePaths([" M docs/STATUS.md", "?? docs/new.md"])).toEqual([
      "docs/STATUS.md",
      "docs/new.md",
    ]);
    expect(
      parseStoryReviewWorktreePaths(
        splitStoryReviewGitLines(" M docs/SAMPLE_STORIES.md\r\n?? docs/new.md\r\n"),
      ),
    ).toEqual(["docs/SAMPLE_STORIES.md", "docs/new.md"]);
    expect(() =>
      parseStoryReviewWorktreePaths(["R  app/src/server/story/story-service.ts -> docs/STATUS.md"]),
    ).toThrow(/renames and copies/iu);
  });

  it("follows director rank while preserving the final action-diversity bar", () => {
    const demo = readCurrentDemo();
    const first = structuredClone(demo.result.canonicalNarrativeInput.chapterRecord) as {
      choices: { action: unknown; description: string; milestoneId: string | null }[];
      playerAction: { source: string };
    };
    const second = structuredClone(first) as typeof first & {
      chapter: number;
      id: string;
      playerAction: {
        action: unknown;
        actorId: string;
        description: string;
        milestoneId: string | null;
        source: string;
        stateVersion: number;
      };
      stateAfterVersion: number;
      stateBeforeVersion: number;
    };
    const nextChoice = first.choices[0]!;
    second.chapter = 2;
    second.id = "chapter-002";
    second.playerAction = {
      action: nextChoice.action,
      actorId: "rowan-ashborn",
      description: nextChoice.description,
      milestoneId: nextChoice.milestoneId,
      source: "suggested",
      stateVersion: 2,
    };
    second.stateBeforeVersion = 2;
    second.stateAfterVersion = 3;

    const third = structuredClone(second) as typeof second;
    const variedChoice = second.choices[0]!;
    third.chapter = 3;
    third.id = "chapter-003";
    third.playerAction = {
      action: variedChoice.action,
      actorId: "rowan-ashborn",
      description: variedChoice.description,
      milestoneId: variedChoice.milestoneId,
      source: "suggested",
      stateVersion: 3,
    };
    third.stateBeforeVersion = 3;
    third.stateAfterVersion = 4;

    expect(validateStoryReviewBranch("rowan-ashborn", [first, second, third])).toHaveLength(3);
    const repeatedDirectorActions = [
      second.playerAction,
      { ...second.playerAction, stateVersion: second.playerAction.stateVersion + 1 },
    ];
    expect(
      selectStoryReviewChoice(
        repeatedDirectorActions as ChapterRecord["playerAction"][],
        second.choices as ChapterRecord["choices"],
      ),
    ).toEqual(second.choices[1]);
    expect(
      selectStoryReviewChoice(
        repeatedDirectorActions.slice(0, 1) as ChapterRecord["playerAction"][],
        second.choices as ChapterRecord["choices"],
      ),
    ).toEqual(second.choices[0]);
    second.playerAction.description = first.choices[1]!.description;
    expect(() => validateStoryReviewBranch("rowan-ashborn", [first, second])).toThrow(
      /director-ranked-with-final-feasibility-guard/iu,
    );
    first.playerAction.source = "custom";
    expect(() => validateStoryReviewBranch("rowan-ashborn", [first])).toThrow(
      /director-ranked-with-final-feasibility-guard/iu,
    );
  });

  it("renders six contiguous ten-chapter stories with progression review prompts", () => {
    const evidence = fixtureEvidence();

    const markdown = buildStoryReviewMarkdown(evidence);

    expect(markdown.match(/^### Chapter \d+:/gmu)).toHaveLength(60);
    expect(markdown.match(/^\*\*Chosen action:\*\*/gmu)).toHaveLength(60);
    expect(markdown.match(/^### Progression review$/gmu)).toHaveLength(6);
    expect(markdown).toContain("Chapters 1 through 10 are contiguous runtime output");
    for (const characterId of CHARACTER_IDS) {
      expect(markdown).toContain(`Story evidence: \`${characterId}\``);
    }
  });

  it("keeps human notes editable without allowing generated prose drift", () => {
    const generated = buildStoryReviewMarkdown(fixtureEvidence());
    const reviewed = generated.replace(
      "| 1 |  |  |  |  |",
      "| 1 | carried | earned | none | yes |",
    );

    expect(storyReviewMarkdownMatches(generated, reviewed)).toBe(true);
    expect(mergeStoryReviewHumanSections(generated, reviewed)).toBe(reviewed);
    const changedGenerated = generated.replace("authentic review prose", "new runtime prose");
    expect(mergeStoryReviewHumanSections(changedGenerated, reviewed)).toBe(changedGenerated);
    expect(
      storyReviewMarkdownMatches(
        generated,
        reviewed.replace("authentic review prose", "changed prose"),
      ),
    ).toBe(false);
  });

  it("rejects a missing chapter instead of presenting a broken progression", () => {
    const evidence = fixtureEvidence();
    const first = evidence.stories[0]!;

    expect(() =>
      StoryReviewEvidenceSchema.parse({
        ...evidence,
        stories: [
          { ...first, chapters: first.chapters.filter(({ chapter }) => chapter !== 7) },
          ...evidence.stories.slice(1),
        ],
      }),
    ).toThrow(/10 chapters|contiguous/u);
  });

  it("rejects reused derived response provenance across chapters", () => {
    const evidence = fixtureEvidence();
    const first = evidence.stories[0]!;
    const chapters = structuredClone(first.chapters);
    chapters[1]!.responseIds = chapters[0]!.responseIds;

    expect(() =>
      StoryReviewEvidenceSchema.parse({
        ...evidence,
        stories: [{ ...first, chapters }, ...evidence.stories.slice(1)],
      }),
    ).toThrow(/Response IDs/iu);
  });

  it("rejects tampered prose and any chapter without an approved audit", () => {
    const evidence = fixtureEvidence();
    const first = evidence.stories[0]!;
    const firstChapter = first.chapters[0]!;

    expect(() =>
      StoryReviewEvidenceSchema.parse({
        ...evidence,
        stories: [
          {
            ...first,
            chapters: [
              { ...firstChapter, prose: `${firstChapter.prose} tampered` },
              ...first.chapters.slice(1),
            ],
          },
          ...evidence.stories.slice(1),
        ],
      }),
    ).toThrow(/prose hash/u);

    expect(() =>
      StoryReviewEvidenceSchema.parse({
        ...evidence,
        stories: [
          {
            ...first,
            chapters: [{ ...firstChapter, auditApproved: false }, ...first.chapters.slice(1)],
          },
          ...evidence.stories.slice(1),
        ],
      }),
    ).toThrow(/audit/u);
  });

  it("keeps failed or uncertain exposure outside committed chapter cost", () => {
    const evidence = fixtureEvidence();
    expect(evidence.durableExposureUsd).toBeGreaterThan(evidence.committedChapterCostUsd);
    expect(() =>
      StoryReviewEvidenceSchema.parse({
        ...evidence,
        durableExposureUsd: evidence.committedChapterCostUsd - 0.01,
      }),
    ).toThrow(/durable exposure/iu);
    expect(() =>
      StoryReviewEvidenceSchema.parse({ ...evidence, priorVariantExposureUsd: 0.1 }),
    ).toThrow(/prior variant exposure/iu);
    expect(() =>
      StoryReviewEvidenceSchema.parse({
        ...evidence,
        priorVariantExposureUsd: 0,
        qualityVariantArchive: null,
      }),
    ).toThrow();
  });

  it("accepts telemetry above the historical story and chapter ceilings", () => {
    const evidence = fixtureEvidence();
    const [first, ...rest] = evidence.stories;
    if (!first) throw new Error("Fixture lacks its first story");
    const [firstChapter, ...remainingChapters] = first.chapters;
    if (!firstChapter) throw new Error("Fixture lacks its first chapter");
    const stories = [
      {
        ...first,
        chapters: [{ ...firstChapter, costUsd: 10 }, ...remainingChapters],
      },
      ...rest,
    ];

    expect(
      StoryReviewEvidenceSchema.parse({
        ...evidence,
        committedChapterCostUsd: 10.59,
        durableExposureUsd: 20,
        stories,
      }),
    ).toMatchObject({ costLimitEnabled: false, durableExposureUsd: 20 });
  });

  it("requires explicit unbounded-cost confirmation without accepting money limit flags", () => {
    expect(parseStoryReviewArgs(["--preflight-only"])).toMatchObject({
      confirmUnboundedCost: false,
      preflightOnly: true,
    });
    expect(() => parseStoryReviewArgs([])).toThrow(/--confirm-unbounded-cost/u);
    expect(parseStoryReviewArgs(["--confirm-unbounded-cost"])).toEqual({
      confirmUnboundedCost: true,
      finalizeOnly: false,
      preflightOnly: false,
    });
    expect(parseStoryReviewArgs(["--finalize-only"])).toMatchObject({
      confirmUnboundedCost: false,
      finalizeOnly: true,
      preflightOnly: false,
    });
    expect(() => parseStoryReviewArgs(["--preflight-only", "--finalize-only"])).toThrow(
      /cannot be combined/u,
    );
    expect(() =>
      parseStoryReviewArgs(["--confirm-unbounded-cost", "--chapter-cap-usd", "0.0848"]),
    ).toThrow(/unknown story-review argument/iu);
  });

  it("reports only finite review progress and telemetry exposure", () => {
    const emptyProgress = Object.fromEntries(
      CHARACTER_IDS.map((characterId) => [characterId, 0]),
    ) as Record<(typeof CHARACTER_IDS)[number], number>;
    const partialProgress = Object.fromEntries(
      CHARACTER_IDS.map((characterId, index) => [characterId, index < 2 ? 6 : 0]),
    ) as Record<(typeof CHARACTER_IDS)[number], number>;
    expect(buildStoryReviewPreflight(emptyProgress, 0)).toEqual({
      byCharacter: emptyProgress,
      completedChapters: 0,
      costLimitEnabled: false,
      durableExposureUsd: 0,
      remainingChapters: 60,
    });
    expect(buildStoryReviewPreflight(partialProgress, 0.2)).toEqual({
      byCharacter: partialProgress,
      completedChapters: 12,
      costLimitEnabled: false,
      durableExposureUsd: 0.2,
      remainingChapters: 48,
    });
    expect(buildStoryReviewPreflight(emptyProgress, 50.86713)).toEqual({
      byCharacter: emptyProgress,
      completedChapters: 0,
      costLimitEnabled: false,
      durableExposureUsd: 50.86713,
      remainingChapters: 60,
    });
    expect(() =>
      buildStoryReviewPreflight({ ...emptyProgress, [CHARACTER_IDS[0]]: 11 }, 0),
    ).toThrow(/chapter count/u);
    expect(() => buildStoryReviewPreflight(emptyProgress, Number.POSITIVE_INFINITY)).toThrow(
      /exposure/u,
    );
  });

  it("requires source ChapterRecord and TraceEnvelope payloads for tracked evidence", () => {
    const summaryOnly = fixtureEvidence();

    expect(StoryReviewSourceEvidenceSchema.safeParse(summaryOnly).success).toBe(false);
    expect(() => buildStoryReviewEvidence(summaryOnly)).toThrow();
  });
});

function fixtureEvidence() {
  const stories = CHARACTER_IDS.map((characterId, storyIndex) => ({
    chapters: Array.from({ length: STORY_REVIEW_CHAPTERS_PER_STORY }, (_, chapterIndex) => {
      const chapter = chapterIndex + 1;
      const prose = `${characterId} chapter ${chapter} authentic review prose.`;
      return {
        adapterMode: "sequential" as const,
        auditApproved: true,
        chapter,
        chapterRecordHash: sha256(`${characterId}:${chapter}:chapter`),
        chosenAction: `Continue ${characterId} chapter ${chapter}.`,
        costUsd: 0.01,
        promptVersion: PROMPT_VERSION,
        prose,
        proseHash: sha256(prose),
        responseIds: [`resp_review_${storyIndex}_${chapter}`],
        serviceTier: "flex" as const,
        sourceGitSha: "a".repeat(40),
        title: `${characterId} ${chapter}`,
        traceHash: sha256(`${characterId}:${chapter}:trace`),
        wordCount: 6,
        worldVersionAfter: chapter + 1,
        worldVersionBefore: chapter,
      };
    }),
    characterId,
  }));
  return StoryReviewEvidenceSchema.parse({
    branchPolicy: STORY_REVIEW_BRANCH_POLICY,
    chaptersPerStory: STORY_REVIEW_CHAPTERS_PER_STORY,
    costLimitEnabled: false,
    generatedAt: "2026-07-21T00:00:00.000Z",
    priorVariantExposureUsd: 0.05,
    promptVersion: PROMPT_VERSION,
    qualityVariantArchive: {
      archiveDirectory: `${"b".repeat(40)}-to-${"a".repeat(40)}`,
      carriedExposureUsd: 0.05,
      fromSourceGitSha: "b".repeat(40),
      manifestSha256: "c".repeat(64),
      reason: "narration-route-reversal-and-repetitive-branching",
      toSourceGitSha: "a".repeat(40),
      variantConfigSha256: STORY_REVIEW_VARIANT_CONFIG_SHA256,
    },
    schemaVersion: STORY_REVIEW_SCHEMA_VERSION,
    serviceTier: "flex",
    sourceGitSha: "a".repeat(40),
    stories,
    committedChapterCostUsd: 0.6,
    durableExposureUsd: 0.65,
    variantConfigSha256: STORY_REVIEW_VARIANT_CONFIG_SHA256,
  });
}

function readCurrentDemo(): {
  readonly result: {
    readonly canonicalNarrativeInput: {
      readonly chapterRecord: unknown;
      readonly stateAfter: unknown;
    };
    readonly trace: unknown;
  };
} {
  const demo = JSON.parse(
    readFileSync(resolve("docs/evidence/rowan-chapter-1-demo.json"), "utf8"),
  ) as ReturnType<typeof readCurrentDemo>;
  const trace = demo.result.trace as {
    acceptedDelta: unknown;
    intents: readonly { actorId: string; promptVersion: string }[];
    promptVersion: string;
    stateAfterHash: string;
    stateBeforeHash: string;
  };
  const chapter = demo.result.canonicalNarrativeInput.chapterRecord as ChapterRecord;
  const seed = loadSeedWorld();
  seed.lockedPovId = "rowan-ashborn";
  const stateBefore = WorldStateSchema.parse(seed);
  const firstChoice = initialChoices(stateBefore)[0];
  if (!firstChoice) throw new Error("Current Rowan seed lacks an initial choice");
  const playerAction = {
    action: firstChoice.action,
    actorId: "rowan-ashborn" as const,
    description: firstChoice.description,
    milestoneId: firstChoice.milestoneId,
    source: "suggested" as const,
    stateVersion: stateBefore.version,
  };
  const backgroundIntents = trace.intents
    .filter(({ actorId }) => actorId !== "rowan-ashborn")
    .map((intent) => ({ ...intent, promptVersion: PROMPT_VERSION }));
  const resolved = resolveTurn(stateBefore, playerAction, backgroundIntents);
  if (!resolved.ok)
    throw new Error(`Current Rowan demo cannot resolve: ${JSON.stringify(resolved.issues)}`);
  const staged = stageWorldDelta(stateBefore, resolved.data.intents, resolved.data.delta);
  if (!staged.ok)
    throw new Error(`Current Rowan demo cannot stage: ${JSON.stringify(staged.issues)}`);

  trace.promptVersion = PROMPT_VERSION;
  trace.acceptedDelta = resolved.data.delta;
  trace.intents = resolved.data.intents;
  trace.stateBeforeHash = sha256(JSON.stringify(stateBefore));
  trace.stateAfterHash = sha256(JSON.stringify(staged.data.state));
  chapter.playerAction = playerAction;
  chapter.safeContextHash = sha256(
    JSON.stringify(buildPovContext(staged.data.state, "rowan-ashborn")),
  );
  const canonical = demo.result.canonicalNarrativeInput as {
    chapterRecord: unknown;
    stateAfter: unknown;
  };
  canonical.stateAfter = staged.data.state;
  return demo;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function writeLoopingStoryDatabase(path: string): void {
  const database = new Database(path);
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
    for (let chapter = 1; chapter <= 10; chapter += 1) {
      insertChapter.run(
        "ashen-crown-v1",
        chapter,
        JSON.stringify({
          chapter,
          playerAction: { action: { locationId: "ash-road", type: "investigate" } },
          povCharacterId: "rowan-ashborn",
          prose:
            "Ash Road lay gray beneath the morning while Rowan inspected the same cold trail. He found no answer and returned to the same stone without changing his plan.",
          title: chapter % 2 === 0 ? "Read the Ash Road" : "Read the Ash Trail",
        }),
      );
      insertDelta.run(
        "ashen-crown-v1",
        chapter,
        JSON.stringify({
          events: [
            {
              locationId: "ash-road",
              participantIds: ["rowan-ashborn"],
            },
          ],
          knowledgeMutations: [],
          stateMutations: [
            {
              amount: 10,
              characterId: "rowan-ashborn",
              type: "gain_xp",
            },
          ],
        }),
      );
    }
  } finally {
    database.close();
  }
}
