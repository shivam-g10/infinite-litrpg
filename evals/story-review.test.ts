import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CHARACTER_IDS, PROMPT_VERSION } from "@infinite-litrpg/shared";
import { describe, expect, it } from "vitest";

import { createStoryReviewClient } from "./run-story-review";

import {
  STORY_REVIEW_CHAPTERS_PER_STORY,
  STORY_REVIEW_TOTAL_CAP_USD,
  StoryReviewEvidenceSchema,
  StoryReviewSourceEvidenceSchema,
  buildStoryReviewChapter,
  buildStoryReviewEvidence,
  buildStoryReviewMarkdown,
  buildStoryReviewPreflight,
  mergeStoryReviewHumanSections,
  parseStoryReviewWorktreePaths,
  parseStoryReviewArgs,
  splitStoryReviewGitLines,
  storyReviewMarkdownMatches,
  validateFirstChoiceBranch,
  validateStoryReviewGitBridge,
  validateStoryReviewPrefix,
  validateStoryReviewSourceIdentities,
} from "./story-review";

describe("ten-chapter story review evidence", () => {
  it("disables invisible SDK retries so every provider attempt is reserved", () => {
    expect(createStoryReviewClient("test-key").maxRetries).toBe(0);
  });

  it("publishes only a committed, audited runtime chapter with response provenance", () => {
    const demo = JSON.parse(
      readFileSync(resolve("docs/evidence/rowan-chapter-1-demo.json"), "utf8"),
    ) as {
      readonly result: {
        readonly canonicalNarrativeInput: {
          readonly chapterRecord: unknown;
          readonly stateAfter: unknown;
        };
        readonly trace: { readonly acceptedDelta: unknown };
      };
    };

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
            delta: demo.result.trace.acceptedDelta,
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
            delta: demo.result.trace.acceptedDelta,
            trace: demo.result.trace,
          },
        ],
        demo.result.canonicalNarrativeInput.stateAfter,
      ),
    ).toThrow(/source Git/u);
  });

  it("rejects chapter and trace usage totals that could not commit atomically", () => {
    const demo = JSON.parse(
      readFileSync(resolve("docs/evidence/rowan-chapter-1-demo.json"), "utf8"),
    ) as {
      readonly result: {
        readonly canonicalNarrativeInput: { readonly chapterRecord: unknown };
        readonly trace: unknown;
      };
    };
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
    const demo = JSON.parse(
      readFileSync(resolve("docs/evidence/rowan-chapter-1-demo.json"), "utf8"),
    ) as {
      readonly result: {
        readonly canonicalNarrativeInput: { readonly chapterRecord: unknown };
        readonly trace: unknown;
      };
    };
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
    const demo = JSON.parse(
      readFileSync(resolve("docs/evidence/rowan-chapter-1-demo.json"), "utf8"),
    ) as {
      readonly result: {
        readonly canonicalNarrativeInput: { readonly chapterRecord: unknown };
        readonly trace: unknown;
      };
    };
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

  it("recomputes the first-offered-choice branch instead of trusting its label", () => {
    const demo = JSON.parse(
      readFileSync(resolve("docs/evidence/rowan-chapter-1-demo.json"), "utf8"),
    ) as {
      readonly result: {
        readonly canonicalNarrativeInput: { readonly chapterRecord: unknown };
      };
    };
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

    expect(validateFirstChoiceBranch("rowan-ashborn", [first, second])).toHaveLength(2);
    second.playerAction.description = first.choices[1]!.description;
    expect(() => validateFirstChoiceBranch("rowan-ashborn", [first, second])).toThrow(
      /first offered choice/iu,
    );
    first.playerAction.source = "custom";
    expect(() => validateFirstChoiceBranch("rowan-ashborn", [first])).toThrow(
      /first offered choice/iu,
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
  });

  it("keeps the paid command on one exact 60-chapter ceiling", () => {
    expect(parseStoryReviewArgs(["--preflight-only"])).toMatchObject({
      chapterCapUsd: 0.0424,
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
        "0.0424",
        "--total-cap-usd",
        "2.5",
      ]),
    ).toThrow(/2\.544/u);
    expect(() =>
      parseStoryReviewArgs([
        "--confirm-cost",
        "--chapter-cap-usd",
        "0.05",
        "--total-cap-usd",
        "2.544",
      ]),
    ).toThrow(/0\.0424/u);
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
      maximumAdditionalExposureUsd: 2.544,
      projectedMaximumExposureUsd: 2.544,
      remainingChapters: 60,
    });
    expect(buildStoryReviewPreflight(partialProgress, 0.2)).toEqual({
      byCharacter: partialProgress,
      completedChapters: 12,
      durableExposureUsd: 0.2,
      maximumAdditionalExposureUsd: 2.0352,
      projectedMaximumExposureUsd: 2.2352,
      remainingChapters: 48,
    });
    expect(() =>
      buildStoryReviewPreflight({ ...emptyProgress, [CHARACTER_IDS[0]]: 11 }, 0),
    ).toThrow(/chapter count/u);
    expect(() => buildStoryReviewPreflight(emptyProgress, 2.545)).toThrow(/exposure/u);
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
    branchPolicy: "first-offered-choice",
    chapterCapUsd: 0.0424,
    chaptersPerStory: STORY_REVIEW_CHAPTERS_PER_STORY,
    generatedAt: "2026-07-21T00:00:00.000Z",
    promptVersion: PROMPT_VERSION,
    schemaVersion: "1.1.0-story-review",
    serviceTier: "flex",
    sourceGitSha: "a".repeat(40),
    stories,
    committedChapterCostUsd: 0.6,
    durableExposureUsd: 0.65,
    totalCapUsd: STORY_REVIEW_TOTAL_CAP_USD,
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
