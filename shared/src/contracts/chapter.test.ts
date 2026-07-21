import { describe, expect, it } from "vitest";

import { ChapterDraftSchema, ChapterRecordSchema } from "./chapter";

const HASH = "a".repeat(64);

describe("unbounded chapter prose and cost contracts", () => {
  it("accepts complete draft prose outside the former word and character limits", () => {
    expect(
      ChapterDraftSchema.parse({
        choices: [],
        contractVersion: "1.1.0",
        prose: "x".repeat(20_001),
        terminal: true,
        title: "The Last Gate",
      }).prose,
    ).toHaveLength(20_001);
  });

  it("accepts committed prose and recorded cost above the former limits", () => {
    const prose = "A short complete scene.";
    const record = ChapterRecordSchema.parse({
      chapter: 350,
      choices: [],
      estimatedCostUsd: 4,
      id: "chapter-350",
      latencyMs: 1,
      narrativeAudit: {
        approved: true,
        evidence: [
          "choiceFulfillment",
          "characterAutonomy",
          "povSafety",
          "litrpgMechanics",
          "continuity",
          "arcProgress",
          "prose",
        ].map((dimension) => ({ detail: "Pass", dimension, issueCode: "pass" })),
        leakedFactIds: [],
        proseHash: HASH,
        scores: {
          arcProgress: 2,
          characterAutonomy: 2,
          choiceFulfillment: 2,
          continuity: 2,
          litrpgMechanics: 2,
          povSafety: 2,
          prose: 2,
        },
      },
      playerAction: {
        action: { type: "wait" },
        actorId: "rowan-ashborn",
        description: "Hold the final gate.",
        milestoneId: null,
        source: "custom",
        stateVersion: 349,
      },
      povCharacterId: "rowan-ashborn",
      prose,
      proseHash: HASH,
      safeContextHash: HASH,
      stateAfterVersion: 350,
      stateBeforeVersion: 349,
      terminal: true,
      title: "The Last Gate",
      traceId: "6ac053af-cde4-45c2-bdf8-89cbefc3f85d",
      usage: {
        cacheWriteTokens: 0,
        cachedInputTokens: 0,
        inputTokens: 1,
        outputTokens: 1,
        reasoningTokens: 0,
        totalTokens: 2,
      },
    });

    expect(record.prose).toBe(prose);
    expect(record.estimatedCostUsd).toBe(4);
  });
});
