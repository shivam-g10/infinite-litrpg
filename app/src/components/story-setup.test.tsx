import { DEFAULT_STORY_SETUP } from "@infinite-litrpg/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  buildStoryPremise,
  createStorySetupSubmission,
  StorySetupCreator,
  toggleLimitedSelection,
} from "./story-setup";

describe("StorySetupCreator", () => {
  it("renders the fixed foundation and accessible choice controls", () => {
    const markup = renderToStaticMarkup(<StorySetupCreator onCreate={vi.fn()} />);

    expect(markup).toContain("Create your story");
    expect(markup).toContain("Reincarnation");
    expect(markup).toContain("System");
    expect(markup).toContain("Create chapter one");
    expect(markup).toContain('type="radio"');
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('maxLength="100"');
    expect(markup).toContain('maxLength="500"');
  });

  it("keeps saved drafts reachable from the creator", () => {
    const markup = renderToStaticMarkup(
      <StorySetupCreator
        onCreate={vi.fn()}
        onOpenStory={vi.fn()}
        savedStories={[{ chapterCount: 7, id: "saved-story", title: "Second Dawn" }]}
      />,
    );

    expect(markup).toContain("Continue a saved story");
    expect(markup).toContain("Second Dawn");
    expect(markup).toContain("Chapter 7");
  });

  it("announces the server-owned world phase", () => {
    const markup = renderToStaticMarkup(
      <StorySetupCreator busy creationPhase="world-checking" onCreate={vi.fn()} />,
    );
    expect(markup).toContain("Checking the world…");
  });

  it("builds a trimmed, schema-checked integration payload", () => {
    expect(createStorySetupSubmission("  New Dawn  ", DEFAULT_STORY_SETUP, "Ilyra Venn")).toEqual({
      povCharacterId: "actor-protagonist",
      setup: {
        ...DEFAULT_STORY_SETUP,
        protagonistName: "Ilyra Venn",
      },
      title: "New Dawn",
    });
    expect(createStorySetupSubmission("   ", DEFAULT_STORY_SETUP)).toBeNull();
    expect(createStorySetupSubmission("x".repeat(101), DEFAULT_STORY_SETUP)).toBeNull();
    expect(
      createStorySetupSubmission("New Dawn", {
        ...DEFAULT_STORY_SETUP,
        guidance: "  Keep the System dangerous.  ",
      })?.setup.guidance,
    ).toBe("Keep the System dangerous.");
  });

  it("sends only preferences and an optional protagonist name", () => {
    const submission = createStorySetupSubmission("First", DEFAULT_STORY_SETUP, "");
    expect(submission?.setup.protagonistName).toBeNull();
    expect(submission?.setup).not.toHaveProperty("cast");
    expect(submission?.setup).not.toHaveProperty("world");
  });

  it("keeps multi-select values inside their stated bounds without mutation", () => {
    const selected = ["adventure", "action", "drama"] as const;

    expect(toggleLimitedSelection(selected, "romance", 3)).toEqual(selected);
    expect(toggleLimitedSelection(selected, "action", 3)).toEqual(["adventure", "drama"]);
    expect(toggleLimitedSelection(["outcast"] as const, "outcast", 2)).toEqual(["outcast"]);
    expect(selected).toEqual(["adventure", "action", "drama"]);
  });

  it("updates the live premise from the setup contract", () => {
    expect(
      buildStoryPremise({
        ...DEFAULT_STORY_SETUP,
        genres: ["mystery", "dark-fantasy"],
        personalityTraits: ["curious"],
        protagonistGender: "female",
        startingLife: "birth",
      }),
    ).toBe(
      "A female protagonist is reincarnated from birth and guided by a System. This weak to strong story blends mystery, dark fantasy, shaped by a curious nature.",
    );
  });
});
