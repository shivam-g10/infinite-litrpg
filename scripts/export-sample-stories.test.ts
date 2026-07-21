import { describe, expect, it } from "vitest";

import {
  assertStoryReviewHumanSignoff,
  mergeFreshStoryReviewHumanSections,
} from "./export-sample-stories";

const EVIDENCE_SHA256 = "a".repeat(64);
const CHARACTER_IDS = [
  "rowan-ashborn",
  "elara-voss",
  "maelin-rook",
  "varek-thorn",
  "lucan-aurelis",
  "nyra-vale",
] as const;

function validSection(characterId: (typeof CHARACTER_IDS)[number]): string {
  return [
    `<!-- STORY_REVIEW_HUMAN_START:${characterId} -->`,
    "",
    "### Progression review",
    "",
    `- Reviewed evidence SHA-256: \`${EVIDENCE_SHA256}\``,
    "",
    "Reviewer notes stay editable.",
    "",
    "- Memorable scene 1: Chapter 1: The opening choice establishes a personal cost.",
    "- Memorable scene 2: Chapter 5: The alliance changes after a costly confession.",
    "- Memorable scene 3: Chapter 10: The promised confrontation pays off.",
    "- Relationship turn 1: Chapter 3: Distrust becomes a fragile working pact.",
    "- Relationship turn 2: Chapter 8: The pact survives a meaningful betrayal.",
    "- System tradeoff 1: Chapter 2: Power is gained by accepting a lasting burden.",
    "- System tradeoff 2: Chapter 7: A stronger skill closes another route.",
    "- Earned payoff: Chapter 10: The early sacrifice enables the final victory.",
    "- Filler chapters: 1",
    "- Would read chapter 11: yes",
    "- Overall verdict: pass",
    "",
    `<!-- STORY_REVIEW_HUMAN_END:${characterId} -->`,
  ].join("\n");
}

function validPack(): string {
  return CHARACTER_IDS.map(validSection).join("\n\n");
}

describe("six-story human signoff", () => {
  it("accepts six explicit passing reviews without rewriting reviewer notes", () => {
    const markdown = validPack();

    expect(() => assertStoryReviewHumanSignoff(markdown, EVIDENCE_SHA256)).not.toThrow();
    expect(markdown).toContain("Reviewer notes stay editable.");
  });

  it.each([
    ["Memorable scene 3", "three memorable scene citations"],
    ["Relationship turn 2", "two relationship turn citations"],
    ["System tradeoff 2", "two System tradeoff citations"],
    ["Earned payoff", "one earned payoff citation"],
    ["Filler chapters", "one numeric filler chapter count"],
    ["Would read chapter 11", "one would-read-chapter-11 answer"],
    ["Overall verdict", "one overall verdict"],
  ])("rejects missing %s evidence", (label, expectedError) => {
    const markdown = validPack().replace(new RegExp(`^- ${label}.*\\n`, "mu"), "");

    expect(() => assertStoryReviewHumanSignoff(markdown, EVIDENCE_SHA256)).toThrow(
      `rowan-ashborn human review requires ${expectedError}`,
    );
  });

  it("rejects revise, excess filler, and refusal to continue", () => {
    expect(() =>
      assertStoryReviewHumanSignoff(
        validPack().replace("- Overall verdict: pass", "- Overall verdict: revise"),
        EVIDENCE_SHA256,
      ),
    ).toThrow("rowan-ashborn overall verdict must be pass");
    expect(() =>
      assertStoryReviewHumanSignoff(
        validPack().replace("- Filler chapters: 1", "- Filler chapters: 2"),
        EVIDENCE_SHA256,
      ),
    ).toThrow("rowan-ashborn filler chapters must be 0 or 1");
    expect(() =>
      assertStoryReviewHumanSignoff(
        validPack().replace("- Would read chapter 11: yes", "- Would read chapter 11: no"),
        EVIDENCE_SHA256,
      ),
    ).toThrow("rowan-ashborn would-read-chapter-11 answer must be yes");
  });

  it("rejects malformed, duplicate, and placeholder citations", () => {
    expect(() =>
      assertStoryReviewHumanSignoff(
        validPack().replace(
          "- Memorable scene 1: Chapter 1: The opening choice establishes a personal cost.",
          "- Memorable scene 1: Chapter eleven: The opening choice establishes a personal cost.",
        ),
        EVIDENCE_SHA256,
      ),
    ).toThrow(
      'rowan-ashborn memorable scene citation must use "- Memorable scene N: Chapter 1-10: evidence"',
    );
    expect(() =>
      assertStoryReviewHumanSignoff(
        validPack().replace("- Memorable scene 2:", "- Memorable scene 1:"),
        EVIDENCE_SHA256,
      ),
    ).toThrow("rowan-ashborn memorable scene citations must be numbered 1 through 3 once each");
    expect(() =>
      assertStoryReviewHumanSignoff(
        validPack().replace(
          "- Earned payoff: Chapter 10: The early sacrifice enables the final victory.",
          "- Earned payoff: Chapter 10: TBD",
        ),
        EVIDENCE_SHA256,
      ),
    ).toThrow("rowan-ashborn earned payoff citation needs substantive evidence");
  });

  it("rejects missing and mismatched human-section markers", () => {
    expect(() =>
      assertStoryReviewHumanSignoff(
        validPack().replace("<!-- STORY_REVIEW_HUMAN_END:rowan-ashborn -->", ""),
        EVIDENCE_SHA256,
      ),
    ).toThrow("Human review pack must contain one bounded section for each of the six characters");
  });

  it("rejects human notes copied from different runtime evidence", () => {
    expect(() => assertStoryReviewHumanSignoff(validPack(), "b".repeat(64))).toThrow(
      `rowan-ashborn reviewed evidence SHA-256 must be ${"b".repeat(64)}`,
    );
  });

  it("preserves current drafts but drops notes bound to old runtime evidence", () => {
    const generated = validPack()
      .replaceAll(`- Reviewed evidence SHA-256: \`${EVIDENCE_SHA256}\`\n\n`, "")
      .replaceAll("Reviewer notes stay editable.", "Fresh review template.");

    expect(mergeFreshStoryReviewHumanSections(generated, validPack(), EVIDENCE_SHA256)).toContain(
      "Reviewer notes stay editable.",
    );

    const freshEvidenceSha256 = "b".repeat(64);
    const fresh = mergeFreshStoryReviewHumanSections(generated, validPack(), freshEvidenceSha256);
    expect(fresh).not.toContain("Reviewer notes stay editable.");
    expect(fresh).toContain("Fresh review template.");
    expect(fresh).toContain(`- Reviewed evidence SHA-256: \`${freshEvidenceSha256}\``);
  });
});
