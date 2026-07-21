import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { CHARACTER_IDS, PROMPT_VERSION } from "@infinite-litrpg/shared";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { REVIEW_STORY_MODELS } from "../app/src/server/story/story-service";
import {
  buildStoryReviewServiceOptions,
  buildStoryReviewWorkspaceOptions,
  createStoryReviewWorkspace,
  createStoryReviewClient,
  readStoryReviewProgress,
  requireStoryReviewLedgerState,
  storyReviewDatabasePath,
  storyReviewPromptCacheKey,
  storyReviewStoryId,
  storyReviewTitle,
} from "./run-story-review";

import {
  STORY_REVIEW_CHAPTERS_PER_STORY,
  STORY_REVIEW_BRANCH_POLICY,
  STORY_REVIEW_SCHEMA_VERSION,
  STORY_REVIEW_TOTAL_CAP_USD,
  STORY_REVIEW_VARIANT_CONFIG_SHA256,
  StoryReviewEvidenceSchema,
  StoryReviewSourceEvidenceSchema,
  assertStoryReviewDatabaseQuality,
  buildStoryReviewChapter,
  buildStoryReviewEvidence,
  buildStoryReviewMarkdown,
  buildStoryReviewPreflight,
  mergeStoryReviewHumanSections,
  parseStoryReviewWorktreePaths,
  parseStoryReviewArgs,
  splitStoryReviewGitLines,
  storyReviewMarkdownMatches,
  validateStoryReviewBranch,
  validateStoryReviewGitBridge,
  validateStoryReviewPrefix,
  validateStoryReviewSourceIdentities,
} from "./story-review";

describe("ten-chapter story review evidence", () => {
  it("disables invisible SDK retries so every provider attempt is reserved", () => {
    expect(createStoryReviewClient("test-key").maxRetries).toBe(0);
  });

  it("binds the quality variant to exact models, quality gates, and stable POV cache keys", () => {
    const costHooks = {
      markUncertain: () => undefined,
      reserve: () => undefined,
      settle: () => undefined,
    };

    expect(buildStoryReviewServiceOptions("rowan-ashborn", costHooks, 0.0848)).toEqual({
      costHooks,
      enforceNarrativeQuality: true,
      maxBackgroundAgents: 3,
      maxCostUsdPerChapter: 0.0848,
      modelConfig: REVIEW_STORY_MODELS,
      nativeMultiAgent: false,
      promptCacheKey: storyReviewPromptCacheKey("rowan-ashborn"),
      serviceTier: "flex",
    });
    expect(REVIEW_STORY_MODELS).toEqual({
      audit: { model: "gpt-5.6-terra", reasoningEffort: "low" },
      frame: { model: "gpt-5.6-sol", reasoningEffort: "low" },
      narration: { model: "gpt-5.6-sol", reasoningEffort: "low" },
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
    const options = buildStoryReviewWorkspaceOptions(client, costHooks, 0.0848, rootDirectory);
    const workspace = createStoryReviewWorkspace(client, costHooks, 0.0848, rootDirectory);

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
    expect(chapter.chosenAction).toBe("Travel toward Ash Road.");
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

  it("avoids repeating an action type when an offered alternative exists", () => {
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
    const variedChoice = second.choices[1]!;
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
    second.playerAction.description = first.choices[1]!.description;
    expect(() => validateStoryReviewBranch("rowan-ashborn", [first, second])).toThrow(
      /least-used-action-type/iu,
    );
    first.playerAction.source = "custom";
    expect(() => validateStoryReviewBranch("rowan-ashborn", [first])).toThrow(
      /least-used-action-type/iu,
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

  it("keeps the paid command on one exact 60-chapter ceiling", () => {
    expect(parseStoryReviewArgs(["--preflight-only"])).toMatchObject({
      chapterCapUsd: 0.0848,
      confirmCost: false,
      preflightOnly: true,
      totalCapUsd: STORY_REVIEW_TOTAL_CAP_USD,
    });
    expect(() => parseStoryReviewArgs([])).toThrow(/--confirm-cost/u);
    expect(parseStoryReviewArgs(["--finalize-only"])).toMatchObject({
      confirmCost: false,
      finalizeOnly: true,
      preflightOnly: false,
    });
    expect(() => parseStoryReviewArgs(["--preflight-only", "--finalize-only"])).toThrow(
      /cannot be combined/u,
    );
    expect(() =>
      parseStoryReviewArgs([
        "--confirm-cost",
        "--chapter-cap-usd",
        "0.0848",
        "--total-cap-usd",
        "5",
      ]),
    ).toThrow(/5\.088/u);
    expect(() =>
      parseStoryReviewArgs([
        "--confirm-cost",
        "--chapter-cap-usd",
        "0.05",
        "--total-cap-usd",
        "5.088",
      ]),
    ).toThrow(/0\.0848/u);
  });

  it("projects only the missing suffix while retaining the hard aggregate cap", () => {
    const emptyProgress = Object.fromEntries(
      CHARACTER_IDS.map((characterId) => [characterId, 0]),
    ) as Record<(typeof CHARACTER_IDS)[number], number>;
    const partialProgress = Object.fromEntries(
      CHARACTER_IDS.map((characterId, index) => [characterId, index < 2 ? 6 : 0]),
    ) as Record<(typeof CHARACTER_IDS)[number], number>;
    expect(buildStoryReviewPreflight(emptyProgress, 0)).toEqual({
      byCharacter: emptyProgress,
      completedChapters: 0,
      durableExposureUsd: 0,
      effectiveChapterCapUsd: 0.0848,
      fullPlanFitsAuthorizedCap: true,
      maximumAdditionalExposureUsd: 5.088,
      projectedMaximumExposureUsd: 5.088,
      remainingChapters: 60,
      requestedPlanMaximumExposureUsd: 5.088,
    });
    expect(buildStoryReviewPreflight(partialProgress, 0.2)).toEqual({
      byCharacter: partialProgress,
      completedChapters: 12,
      durableExposureUsd: 0.2,
      effectiveChapterCapUsd: 0.0848,
      fullPlanFitsAuthorizedCap: true,
      maximumAdditionalExposureUsd: 4.0704,
      projectedMaximumExposureUsd: 4.2704,
      remainingChapters: 48,
      requestedPlanMaximumExposureUsd: 4.2704,
    });
    expect(buildStoryReviewPreflight(emptyProgress, 0.86713)).toEqual({
      byCharacter: emptyProgress,
      completedChapters: 0,
      durableExposureUsd: 0.86713,
      effectiveChapterCapUsd: 0.070347833,
      fullPlanFitsAuthorizedCap: true,
      maximumAdditionalExposureUsd: 4.22086998,
      projectedMaximumExposureUsd: 5.08799998,
      remainingChapters: 60,
      requestedPlanMaximumExposureUsd: 5.95513,
    });
    expect(() =>
      buildStoryReviewPreflight({ ...emptyProgress, [CHARACTER_IDS[0]]: 11 }, 0),
    ).toThrow(/chapter count/u);
    expect(() => buildStoryReviewPreflight(emptyProgress, 5.089)).toThrow(/exposure/u);
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
    chapterCapUsd: 0.0848,
    chaptersPerStory: STORY_REVIEW_CHAPTERS_PER_STORY,
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
    totalCapUsd: STORY_REVIEW_TOTAL_CAP_USD,
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
    acceptedDelta: { promptVersion: string };
    intents: { promptVersion: string }[];
    promptVersion: string;
  };
  trace.promptVersion = PROMPT_VERSION;
  trace.acceptedDelta.promptVersion = PROMPT_VERSION;
  for (const intent of trace.intents) intent.promptVersion = PROMPT_VERSION;
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
