import { expect, test, type Page, type Route } from "@playwright/test";
import { DEFAULT_STORY_SETUP } from "@infinite-litrpg/shared";

const baseStory = {
  chapter: {
    choices: [
      { description: "Follow the ash trail beyond Cinder Village", id: "choice-1" },
      { description: "Question Nyra about the unmarked class sigil", id: "choice-2" },
    ],
    prose:
      "Smoke clung to the low eaves like a living thing, reluctant to leave. Rowan crouched beneath the shattered watchpost, the taste of ash and copper thick on their tongue.\n\nCinder Village was mostly silence now, save for the soft crackle of lingering flames and the distant groan of a beam giving way. The raiders were gone. Whatever they had wanted, they had taken.\n\nAt the center of the square, a trail of gray ash wound between toppled stalls and broken carts. It was not windblown. It was stepped through.\n\nBehind them, a voice spoke from the shadow of a half-fallen awning. “You do not have to do this alone.” Nyra’s tone was calm, unreadable.",
    title: "Embers Remember",
  },
  chapterHistory: [{ chapter: 1, title: "Embers Remember" }],
  continuationPlan: null,
  pov: {
    beliefs: ["Power without restraint destroyed the old kingdom."],
    characterClass: "Ashbound",
    conditions: [],
    experience: 0,
    experienceToNextLevel: 100,
    goals: ["Survive the ash-raider attack", "Hide his unusual magic"],
    health: { current: 42, maximum: 42 },
    id: "rowan-ashborn",
    inventory: [
      { equipped: true, id: "rusted-sword", name: "Rusted sword", quantity: 1 },
      { equipped: false, id: "coppers", name: "Coppers", quantity: 9 },
    ],
    level: 1,
    location: "Cinder Village",
    mana: { current: 18, maximum: 18 },
    name: "Rowan Ashborn",
    publicRole: "Malachar reincarnated as a level-one human",
    relationships: [{ id: "nyra-vale", label: "Uneasy ally", name: "Nyra Vale", score: 8 }],
    skills: [
      { id: "ember-sense", name: "Ember Sense", rank: 1 },
      { id: "sovereigns-echo", name: "Sovereign’s Echo", rank: 1 },
    ],
    stats: { agility: 7, intellect: 12, strength: 6, vitality: 8, willpower: 14 },
    status: "alive",
  },
  visibleEvents: [
    {
      id: "event-ash-trail",
      location: "Cinder Village",
      summary: "Ash trail leads out of Cinder Village.",
    },
    {
      id: "event-smoke",
      location: "Ash Road",
      summary: "Wind carries the scent of smoke and iron.",
    },
  ],
  world: {
    act: 1,
    calendar: { day: 1, label: "Ashfall, First Bell" },
    chapter: 1,
    id: "ashen-crown",
    terminal: false,
    terminalReason: null,
    threat: "Ash raiders crossed the northern ridge",
    version: 2,
  },
};

function storyAtChapter(chapter: number, title: string, canContinue = false) {
  const endChapter = chapter < 47 ? 47 : chapter < 97 ? 97 : 100;
  return {
    ...baseStory,
    chapter: { ...baseStory.chapter, title },
    chapterHistory: Array.from({ length: chapter }, (_, index) => ({
      chapter: index + 1,
      title: index + 1 === chapter ? title : `Chapter ${index + 1}`,
    })),
    continuationPlan: canContinue
      ? {
          chapterCount: endChapter - chapter,
          endChapter,
        }
      : null,
    world: { ...baseStory.world, chapter, version: chapter + 1 },
  };
}

function openingDraft() {
  return {
    ...baseStory,
    chapter: {
      choices: [
        {
          description: "Awaken in the new life and understand the immediate danger.",
          id: "choice-1",
        },
      ],
      prose: "Your new life is ready to begin.",
      title: "Before the First Step",
    },
    chapterHistory: [],
    continuationPlan: null,
    world: { ...baseStory.world, chapter: 0, version: 1 },
  };
}

interface StorySummaryFixture {
  readonly chapterCount: number;
  readonly createdAt: string;
  readonly id: string;
  readonly povCharacterId: string;
  readonly status: "active" | "rejected";
  readonly title: string;
  readonly updatedAt: string;
}

const FIXTURE_TIME = "2026-07-21T00:00:00.000Z";

function storySummary(
  id = "rowan-story",
  title = "Rowan's Ashen Crown",
  chapterCount = 1,
  status: StorySummaryFixture["status"] = "active",
  povCharacterId = "rowan-ashborn",
): StorySummaryFixture {
  return {
    chapterCount,
    createdAt: FIXTURE_TIME,
    id,
    povCharacterId,
    status,
    title,
    updatedAt: FIXTURE_TIME,
  };
}

function storyEnvelope(
  story: unknown,
  stories?: readonly StorySummaryFixture[],
  activeStoryId: string | null = story === null ? null : "rowan-story",
  generation: Readonly<{
    mode: "generate" | "rewrite";
    storyId: string;
    targetChapter: number;
  }> | null = null,
) {
  const storyRecord = story as {
    readonly pov?: { readonly id?: unknown };
    readonly world?: { readonly chapter?: unknown };
  } | null;
  const chapterCount = storyRecord?.world?.chapter;
  const povCharacterId = storyRecord?.pov?.id;
  const resolvedStories =
    stories ??
    (story === null
      ? []
      : [
          storySummary(
            "rowan-story",
            "Rowan's Ashen Crown",
            Number.isSafeInteger(chapterCount) ? (chapterCount as number) : 0,
            "active",
            typeof povCharacterId === "string" ? povCharacterId : "rowan-ashborn",
          ),
        ]);
  return {
    generation,
    library: { activeStoryId, stories: resolvedStories },
    story,
    warnings: [],
  };
}

function storyEvent(
  story: unknown,
  stories?: readonly StorySummaryFixture[],
  activeStoryId = "rowan-story",
) {
  return { ...storyEnvelope(story, stories, activeStoryId), type: "story" };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: "application/json",
    status,
  });
}

async function confirmContinuation(page: Page): Promise<void> {
  await page.getByText("Create several chapters", { exact: true }).click();
  await page.getByRole("button", { name: "Continue to next decision" }).click();
  await page.getByRole("button", { name: "Start generation" }).click();
}

async function fulfillNdjson(
  route: Route,
  events: readonly Readonly<Record<string, unknown>>[],
): Promise<void> {
  await route.fulfill({
    body: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    contentType: "application/x-ndjson",
    status: 200,
  });
}

async function mockLoadedStory(page: Page): Promise<void> {
  await page.route("**/api/story", async (route) => {
    await fulfillJson(route, storyEnvelope(baseStory));
  });
}

function expectFreshCreateBody(
  body: unknown,
  title: string,
  overrides: Partial<Pick<typeof DEFAULT_STORY_SETUP, "protagonistGender" | "startingLife">> = {},
): void {
  expect(body).toMatchObject({
    povCharacterId: "rowan-ashborn",
    setup: {
      backgrounds: DEFAULT_STORY_SETUP.backgrounds,
      foundation: "reincarnation-system",
      genres: DEFAULT_STORY_SETUP.genres,
      guidance: "",
      memory: DEFAULT_STORY_SETUP.memory,
      personalityTraits: DEFAULT_STORY_SETUP.personalityTraits,
      powerPath: DEFAULT_STORY_SETUP.powerPath,
      protagonistGender: overrides.protagonistGender ?? DEFAULT_STORY_SETUP.protagonistGender,
      rebirthCause: DEFAULT_STORY_SETUP.rebirthCause,
      startingLife: overrides.startingLife ?? DEFAULT_STORY_SETUP.startingLife,
      systemFocus: DEFAULT_STORY_SETUP.systemFocus,
    },
    title,
    type: "create",
  });
  const setup = (body as { setup: typeof DEFAULT_STORY_SETUP }).setup;
  expect(setup.cast).not.toEqual(DEFAULT_STORY_SETUP.cast);
  expect(setup.world).not.toEqual(DEFAULT_STORY_SETUP.world);
}

test("configures a reincarnation story and creates chapter one automatically", async ({ page }) => {
  let createBody: unknown = null;
  let openingBody: unknown = null;
  await page.route("**/api/story", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, storyEnvelope(null, [], null));
      return;
    }
    openingBody = route.request().postDataJSON();
    await fulfillNdjson(route, [
      { status: "generating", type: "status" },
      storyEvent(
        baseStory,
        [storySummary("second-life", "The Child Beneath the Crown", 1)],
        "second-life",
      ),
    ]);
  });
  await page.route("**/api/stories", async (route) => {
    createBody = route.request().postDataJSON();
    await fulfillJson(
      route,
      storyEnvelope(
        openingDraft(),
        [storySummary("second-life", "The Child Beneath the Crown", 0)],
        "second-life",
      ),
    );
  });

  await page.goto("/");
  await expect(page).toHaveTitle("Infinite LitRPG");
  await expect(page.getByRole("heading", { level: 1, name: "Create your story" })).toBeVisible();
  await expect(page.getByText("Reincarnation", { exact: true })).toBeVisible();
  await expect(page.getByText("System", { exact: true })).toBeVisible();
  await page.getByLabel("Story title").fill("The Child Beneath the Crown");
  await page.getByText("Born again", { exact: true }).click();
  await page.getByText("Female", { exact: true }).click();
  await page.getByRole("button", { name: "Create chapter one" }).click();

  await expect(page.locator(".reader-context strong")).toContainText("Rowan Ashborn");
  await expect(page.getByRole("heading", { level: 1, name: "Embers Remember" })).toBeVisible();
  await expect(page.getByText("Viewpoint locked")).toBeAttached();
  expectFreshCreateBody(createBody, "The Child Beneath the Crown", {
    protagonistGender: "female",
    startingLife: "birth",
  });
  expect(openingBody).toMatchObject({
    choiceId: "choice-1",
    expectedWorldVersion: 1,
    type: "take_action",
  });
});

test("takes a suggested choice and renders the committed chapter", async ({ page }) => {
  let postedBody: unknown = null;
  await page.route("**/api/story", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, storyEnvelope(baseStory));
      return;
    }
    postedBody = route.request().postDataJSON();
    expect(route.request().headers().accept).toContain("application/x-ndjson");
    await fulfillNdjson(route, [
      { text: "Validated prose chunk one. ", type: "chunk" },
      { text: "Validated prose chunk two.", type: "chunk" },
      storyEvent(storyAtChapter(2, "The Ash Road")),
    ]);
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Follow the ash trail beyond Cinder Village" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "The Ash Road" })).toBeVisible();
  expect(postedBody).toMatchObject({
    choiceId: "choice-1",
    expectedWorldVersion: 2,
    type: "take_action",
  });
  expect((postedBody as { requestId: string }).requestId).toMatch(/^[0-9a-f-]{36}$/u);
  await expect(page.getByRole("heading", { level: 1, name: "The Ash Road" })).toBeFocused();
});

test("creates one routine chapter without starting a batch", async ({ page }) => {
  let postedBody: unknown = null;
  await page.route("**/api/story", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, storyEnvelope(storyAtChapter(1, "Embers Remember", true)));
      return;
    }
    postedBody = route.request().postDataJSON();
    await fulfillNdjson(route, [storyEvent(storyAtChapter(2, "The Ash Road", true))]);
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Create chapter 2" })).toBeVisible();
  await page.getByRole("button", { name: "Create chapter 2" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "The Ash Road" })).toBeVisible();
  expect(postedBody).toMatchObject({ choiceId: "choice-1", type: "take_action" });
});

test("reviews saved chapters without generating another turn", async ({ page }) => {
  let postCount = 0;
  const openedChapters: number[] = [];
  await page.route("**/api/story**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      postCount += 1;
      await fulfillJson(route, { error: "Unexpected generation request" }, 500);
      return;
    }
    const chapter = new URL(request.url()).searchParams.get("chapter");
    if (chapter) {
      const chapterNumber = Number(chapter);
      openedChapters.push(chapterNumber);
      await fulfillJson(route, {
        chapter: {
          chapter: chapterNumber,
          prose: `Saved prose for chapter ${chapterNumber}.`,
          title: `Chapter ${chapterNumber}`,
        },
      });
      return;
    }
    await fulfillJson(route, storyEnvelope(storyAtChapter(3, "Third Ember", true)));
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Previous saved chapter" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Chapter 2" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create chapter 4" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Return to chapter 3" })).toBeVisible();
  await expect(page.getByText("Saved prose for chapter 2.")).toBeVisible();

  await page.getByRole("button", { name: "Next saved chapter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Third Ember" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create chapter 4" })).toBeVisible();
  expect(openedChapters).toEqual([2]);
  expect(postCount).toBe(0);
});

test("switches stories, updates scoped exports, and clears the chapter cache", async ({ page }) => {
  const firstSummary = storySummary("story-a", "First Path", 3);
  const secondSummary = storySummary("story-b", "Second Path", 3, "active", "elara-voss");
  const summaries = [firstSummary, secondSummary];
  const firstStory = storyAtChapter(3, "First Latest", true);
  const secondStory = {
    ...storyAtChapter(3, "Second Latest", true),
    pov: {
      ...baseStory.pov,
      characterClass: "Sunblade",
      id: "elara-voss",
      name: "Elara Voss",
    },
  };
  const openedChapters: string[] = [];
  let lifecycleBody: unknown = null;

  await page.route("**/api/story**", async (route) => {
    const url = new URL(route.request().url());
    const chapter = url.searchParams.get("chapter");
    if (chapter) {
      const storyId = url.searchParams.get("storyId") ?? "missing";
      openedChapters.push(`${storyId}:${chapter}`);
      await fulfillJson(route, {
        chapter: {
          chapter: Number(chapter),
          prose: `${storyId} saved prose.`,
          title: `${storyId} saved chapter ${chapter}`,
        },
      });
      return;
    }
    await fulfillJson(route, storyEnvelope(firstStory, summaries, "story-a"));
  });
  await page.route("**/api/stories", async (route) => {
    lifecycleBody = route.request().postDataJSON();
    await fulfillJson(route, storyEnvelope(secondStory, summaries, "story-b"));
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Previous saved chapter" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "story-a saved chapter 2" }),
  ).toBeVisible();

  await page.getByLabel("Open story library. Current story: First Path").click();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByLabel("Open story library. Current story: Second Path")).toBeVisible();
  await expect(
    page.locator('a[href="/api/story/export?format=markdown&storyId=story-b"]'),
  ).toHaveCount(2);

  await page.getByRole("button", { name: "Previous saved chapter" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "story-b saved chapter 2" }),
  ).toBeVisible();
  expect(openedChapters).toEqual(["story-a:2", "story-b:2"]);
  expect(lifecycleBody).toEqual({ storyId: "story-b", type: "activate" });
});

test("starts a new story and exposes remaining stories after rejecting it", async ({ page }) => {
  const firstSummary = storySummary("story-a", "First Path", 1);
  const secondSummary = storySummary("story-b", "Second Path", 1);
  const lifecycleBodies: unknown[] = [];

  await page.route("**/api/story", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, storyEnvelope(baseStory, [firstSummary], "story-a"));
      return;
    }
    await fulfillNdjson(route, [storyEvent(baseStory, [firstSummary, secondSummary], "story-b")]);
  });
  await page.route("**/api/stories", async (route) => {
    const body = route.request().postDataJSON() as { type: string };
    lifecycleBodies.push(body);
    if (body.type === "create") {
      await fulfillJson(
        route,
        storyEnvelope(
          openingDraft(),
          [firstSummary, { ...secondSummary, chapterCount: 0 }],
          "story-b",
        ),
      );
      return;
    }
    if (body.type === "reopen") {
      await fulfillJson(
        route,
        storyEnvelope(baseStory, [firstSummary, { ...secondSummary, status: "active" }], "story-b"),
      );
      return;
    }
    if (body.type === "activate") {
      await fulfillJson(
        route,
        storyEnvelope(
          baseStory,
          [firstSummary, { ...secondSummary, status: "rejected" }],
          "story-a",
        ),
      );
      return;
    }
    await fulfillJson(
      route,
      storyEnvelope(null, [firstSummary, { ...secondSummary, status: "rejected" }], null),
    );
  });

  await page.goto("/");
  await page.getByLabel("Open story library. Current story: First Path").click();
  await page.getByRole("button", { name: "Start new story" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Create your story" })).toBeVisible();
  await page.getByRole("button", { name: "Back to library" }).click();
  await expect(page.getByLabel("Open story library. Current story: First Path")).toBeVisible();
  expect(lifecycleBodies).toEqual([]);

  await page.getByLabel("Open story library. Current story: First Path").click();
  await page.getByRole("button", { name: "Start new story" }).click();
  await page.getByLabel("Story title").fill("Second Path");
  await page.getByRole("button", { name: "Create chapter one" }).click();
  await expect(page.getByLabel("Open story library. Current story: Second Path")).toBeVisible();

  await page.getByLabel("Open story library. Current story: Second Path").click();
  await page.getByRole("button", { name: "Try another" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Create your story" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Continue a saved story" })).toBeVisible();
  await page.getByRole("button", { name: "First Path Chapter 1" }).click();
  await expect(page.getByLabel("Open story library. Current story: First Path")).toBeVisible();
  expect(lifecycleBodies).toHaveLength(3);
  expectFreshCreateBody(lifecycleBodies[0], "Second Path");
  expect(lifecycleBodies.slice(1)).toEqual([
    { storyId: "story-b", type: "reject" },
    { storyId: "story-a", type: "activate" },
  ]);
});

test("reopens a rejected story and restarts without deleting the old draft", async ({ page }) => {
  const firstSummary = storySummary("story-a", "First Path", 2);
  const rejectedSummary = storySummary("story-b", "Rejected Path", 3, "rejected", "elara-voss");
  const reopenedSummary = { ...rejectedSummary, status: "active" as const };
  const restartedSummary = storySummary(
    "story-c",
    "Rejected Path — Restart",
    0,
    "active",
    "elara-voss",
  );
  const elaraStory = {
    ...storyAtChapter(3, "A Reopened Ember"),
    pov: { ...baseStory.pov, id: "elara-voss", name: "Elara Voss" },
  };
  const restartedStory = {
    ...baseStory,
    chapter: null,
    chapterHistory: [],
    pov: { ...baseStory.pov, id: "elara-voss", name: "Elara Voss" },
    world: { ...baseStory.world, chapter: 0, version: 1 },
  };
  const lifecycleBodies: unknown[] = [];

  await page.route("**/api/story", async (route) => {
    await fulfillJson(
      route,
      storyEnvelope(storyAtChapter(2, "First Latest"), [firstSummary, rejectedSummary], "story-a"),
    );
  });
  await page.route("**/api/stories", async (route) => {
    const body = route.request().postDataJSON() as { type: string };
    lifecycleBodies.push(body);
    if (body.type === "reopen") {
      await fulfillJson(
        route,
        storyEnvelope(elaraStory, [firstSummary, reopenedSummary], "story-b"),
      );
      return;
    }
    await fulfillJson(
      route,
      storyEnvelope(restartedStory, [firstSummary, rejectedSummary, restartedSummary], "story-c"),
    );
  });

  await page.goto("/");
  await page.getByLabel("Open story library. Current story: First Path").click();
  await page.getByRole("button", { name: "Reopen" }).click();
  await expect(page.getByLabel("Open story library. Current story: Rejected Path")).toBeVisible();

  await page.getByLabel("Open story library. Current story: Rejected Path").click();
  await page.getByRole("button", { name: "Restart from beginning" }).click();
  await expect(page.getByRole("heading", { name: "Restart from the beginning?" })).toBeVisible();
  await page.getByRole("button", { name: "Restart story" }).click();
  await expect(
    page.getByLabel("Open story library. Current story: Rejected Path — Restart"),
  ).toBeVisible();
  await page.getByLabel("Open story library. Current story: Rejected Path — Restart").click();
  await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();
  expect(lifecycleBodies).toEqual([
    { storyId: "story-b", type: "reopen" },
    { storyId: "story-b", type: "restart" },
  ]);
});

test("keeps the active chapter readable while later chapters generate", async ({ page }) => {
  let chapter = 1;
  let releaseSecondChapter!: () => void;
  const secondChapterMayFinish = new Promise<void>((resolve) => {
    releaseSecondChapter = resolve;
  });
  await page.route("**/api/story", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, storyEnvelope(storyAtChapter(1, "Embers Remember", true)));
      return;
    }
    chapter += 1;
    if (chapter === 3) await secondChapterMayFinish;
    const responseStory = storyAtChapter(chapter, `Chapter ${chapter}`, chapter === 2);
    await fulfillJson(
      route,
      storyEnvelope(chapter === 2 ? responseStory : { ...responseStory, continuationPlan: null }),
    );
  });

  await page.goto("/");
  await confirmContinuation(page);
  await expect(
    page.getByRole("status").getByRole("heading", { level: 2, name: "Chapter 3" }),
  ).toBeVisible();

  await expect(page.getByRole("heading", { level: 1, name: "Embers Remember" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Jump to saved chapter" })).toBeEnabled();

  releaseSecondChapter();
  await expect(page.getByText("Decision ready at chapter 3.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Embers Remember" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Return to chapter 3" })).toBeVisible();
});

test("keeps the reader pinned and resumes after a mid-batch failure", async ({ page }) => {
  let chapter = 1;
  let failedOnce = false;
  const postedVersions: number[] = [];
  await page.route("**/api/story", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(
        route,
        storyEnvelope(
          storyAtChapter(
            chapter,
            chapter === 1 ? "Embers Remember" : `Chapter ${chapter}`,
            chapter === 1 || chapter === 2,
          ),
        ),
      );
      return;
    }

    const body = route.request().postDataJSON() as { expectedWorldVersion: number };
    postedVersions.push(body.expectedWorldVersion);
    if (chapter === 2 && !failedOnce) {
      failedOnce = true;
      await fulfillJson(route, { error: "OpenAI was temporarily unavailable." }, 503);
      return;
    }

    chapter += 1;
    const nextStory = storyAtChapter(chapter, `Chapter ${chapter}`, chapter === 2);
    await fulfillJson(
      route,
      storyEnvelope(chapter === 3 ? { ...nextStory, continuationPlan: null } : nextStory),
    );
  });

  await page.goto("/");
  await confirmContinuation(page);

  await expect(
    page.getByText("Generation paused before chapter 3. Saved chapters are safe.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("OpenAI was temporarily unavailable.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Embers Remember" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Return to chapter 2" })).toBeVisible();

  await page.getByRole("button", { name: "Retry and resume generation" }).click();

  await expect(page.getByText("Decision ready at chapter 3.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Embers Remember" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Return to chapter 3" })).toBeVisible();
  expect(postedVersions).toEqual([2, 3, 3]);
});

test("rewrites only the latest saved chapter and keeps canon in place", async ({ page }) => {
  let finishRewrite!: () => void;
  const rewriteMayFinish = new Promise<void>((resolve) => {
    finishRewrite = resolve;
  });
  let postedBody: unknown = null;
  const latestStory = storyAtChapter(2, "Before Rewrite");
  const rewrittenStory = {
    ...latestStory,
    chapter: {
      ...latestStory.chapter,
      prose: "Rewritten prose follows the same accepted events.",
      title: "After Rewrite",
    },
  };

  await page.route("**/api/story**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      const chapter = new URL(request.url()).searchParams.get("chapter");
      if (chapter) {
        await fulfillJson(route, {
          chapter: { chapter: 1, prose: "Older saved prose.", title: "Older Chapter" },
        });
        return;
      }
      await fulfillJson(
        route,
        storyEnvelope(latestStory, [storySummary("rowan-story", "Rewrite Path", 2)]),
      );
      return;
    }
    postedBody = request.postDataJSON();
    await rewriteMayFinish;
    await fulfillNdjson(route, [
      storyEvent(rewrittenStory, [storySummary("rowan-story", "Rewrite Path", 2)]),
    ]);
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Rewrite latest chapter" }).click();
  await expect(
    page.getByRole("status").getByRole("heading", { level: 2, name: "Chapter 2" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Writing a new version.");
  await expect(page.getByRole("button", { name: "Rewrite latest chapter" })).toBeDisabled();
  finishRewrite();

  await expect(page.getByRole("heading", { level: 1, name: "After Rewrite" })).toBeVisible();
  await expect(page.getByText("Rewritten prose follows the same accepted events.")).toBeVisible();
  expect(postedBody).toMatchObject({ expectedWorldVersion: 3, type: "reroll_latest" });
  expect((postedBody as { requestId: string }).requestId).toMatch(/^[0-9a-f-]{36}$/u);

  await page.getByRole("button", { name: "Previous saved chapter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Older Chapter" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rewrite latest chapter" })).toHaveCount(0);
});

test("does not offer rewrite before chapter one commits", async ({ page }) => {
  const zeroChapterStory = {
    ...baseStory,
    chapterHistory: [],
    world: { ...baseStory.world, chapter: 0, version: 1 },
  };
  await page.route("**/api/story", async (route) => {
    await fulfillJson(
      route,
      storyEnvelope(
        zeroChapterStory,
        [storySummary("rowan-story", "Unwritten Path", 0)],
        "rowan-story",
      ),
    );
  });

  await page.goto("/");

  await expect(page.getByText("Chapter 0", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rewrite latest chapter" })).toHaveCount(0);
});

test("rejects a mismatched saved-chapter response", async ({ page }) => {
  await page.route("**/api/story**", async (route) => {
    const chapter = new URL(route.request().url()).searchParams.get("chapter");
    if (chapter) {
      await fulfillJson(route, {
        chapter: { chapter: 1, prose: "Wrong saved prose.", title: "Wrong chapter" },
      });
      return;
    }
    await fulfillJson(route, storyEnvelope(storyAtChapter(3, "Third Ember", true)));
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Previous saved chapter" }).click();

  await expect(
    page
      .getByRole("navigation", { name: "Saved chapters" })
      .getByText("Saved chapter response did not match the requested chapter.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Third Ember" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create chapter 4" })).toBeVisible();
});

test("continues routine chapters, pauses at both decisions, and stops at chapter 100", async ({
  page,
}) => {
  let chapter = 1;
  const postedBodies: Array<{
    approvedThroughChapter?: number;
    expectedWorldVersion: number;
    requestId: string;
    type: string;
  }> = [];
  await page.route("**/api/story", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, storyEnvelope(storyAtChapter(1, "Embers Remember", true)));
      return;
    }
    postedBodies.push(
      route.request().postDataJSON() as {
        approvedThroughChapter?: number;
        expectedWorldVersion: number;
        requestId: string;
        type: string;
      },
    );
    chapter += 1;
    const canContinue = chapter < 100 && chapter !== 47 && chapter !== 97;
    await fulfillJson(
      route,
      storyEnvelope(storyAtChapter(chapter, `Chapter ${chapter}`, canContinue)),
    );
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Create chapter 2" })).toBeVisible();
  await page.getByText("Create several chapters", { exact: true }).click();
  await expect(page.getByText("Up to 46 chapters, through chapter 47")).toBeVisible();
  await page.getByRole("button", { name: "Continue to next decision" }).click();
  await expect(page.getByRole("heading", { name: "Create up to 46 chapters?" })).toBeVisible();
  await expect(page.getByText(/Runs in the background through chapter 47/u)).toBeVisible();
  await page.getByRole("button", { name: "Start generation" }).click();
  await expect(page.getByText("Decision ready at chapter 47.", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { level: 1, name: "Embers Remember" })).toBeVisible();
  await page.getByRole("button", { name: "Return to chapter 47" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Chapter 47" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Follow the ash trail beyond Cinder Village" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Chapter 48" })).toBeVisible();
  await confirmContinuation(page);
  await expect(page.getByText("Decision ready at chapter 97.", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { level: 1, name: "Chapter 48" })).toBeVisible();
  await page.getByRole("button", { name: "Return to chapter 97" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Chapter 97" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Follow the ash trail beyond Cinder Village" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Chapter 98" })).toBeVisible();
  await confirmContinuation(page);
  await expect(page.getByText("Chapter 100 is ready for review.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Chapter 98" })).toBeVisible();
  await page.getByRole("button", { name: "Return to chapter 100" }).click();
  await expect(
    page.getByRole("heading", { exact: true, level: 1, name: "Chapter 100" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { exact: true, level: 1, name: "Chapter 100" }),
  ).toBeFocused();
  await expect(page.getByRole("progressbar", { name: "Chapter 100 of 100" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to next decision" })).toHaveCount(0);

  expect(postedBodies).toHaveLength(99);
  expect(postedBodies.filter(({ type }) => type === "continue_story")).toHaveLength(97);
  expect(
    postedBodies.filter(
      ({ approvedThroughChapter, type }) =>
        type === "continue_story" && approvedThroughChapter === 47,
    ),
  ).toHaveLength(46);
  expect(
    postedBodies.filter(
      ({ approvedThroughChapter, type }) =>
        type === "continue_story" && approvedThroughChapter === 97,
    ),
  ).toHaveLength(49);
  expect(
    postedBodies.filter(
      ({ approvedThroughChapter, type }) =>
        type === "continue_story" && approvedThroughChapter === 100,
    ),
  ).toHaveLength(2);
  expect(postedBodies.filter(({ type }) => type === "take_action")).toHaveLength(2);
  expect(postedBodies.map(({ expectedWorldVersion }) => expectedWorldVersion)).toEqual(
    Array.from({ length: 99 }, (_, index) => index + 2),
  );
  expect(new Set(postedBodies.map(({ requestId }) => requestId)).size).toBe(99);
});

test("stops an automatic run only after the active chapter commits", async ({ page }) => {
  let finishRequest!: () => void;
  const requestMayFinish = new Promise<void>((resolve) => {
    finishRequest = resolve;
  });
  let postCount = 0;
  await page.route("**/api/story", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, storyEnvelope(storyAtChapter(1, "Embers Remember", true)));
      return;
    }
    postCount += 1;
    await requestMayFinish;
    await fulfillJson(route, storyEnvelope(storyAtChapter(2, "The Next Ember", true)));
  });

  await page.goto("/");
  await confirmContinuation(page);
  await expect(page.getByRole("combobox", { name: "Jump to saved chapter" })).toBeEnabled();
  await page.getByRole("button", { name: "Stop after this chapter" }).click();
  finishRequest();

  await expect(page.getByRole("heading", { level: 1, name: "Embers Remember" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Return to chapter 2" })).toBeVisible();
  await expect(page.getByText("Stopped after chapter 2.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Return to chapter 2" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "The Next Ember" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Create chapter 3" })).toBeVisible();
  expect(postCount).toBe(1);
});

test("keeps the reader usable after refresh while a chapter finishes in the background", async ({
  page,
}) => {
  let getCount = 0;
  await page.route("**/api/story", async (route) => {
    getCount += 1;
    const generating = getCount === 1;
    await fulfillJson(
      route,
      storyEnvelope(
        generating
          ? storyAtChapter(1, "Embers Remember", true)
          : storyAtChapter(2, "The Next Ember", true),
        undefined,
        "rowan-story",
        generating ? { mode: "generate", storyId: "rowan-story", targetChapter: 2 } : null,
      ),
    );
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Embers Remember" })).toBeVisible();
  await expect(
    page.getByRole("status").getByRole("heading", { level: 2, name: "Chapter 2" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "The Next Ember" })).toBeVisible({
    timeout: 5_000,
  });
  expect(getCount).toBeGreaterThanOrEqual(2);
});

test("submits a custom action", async ({ page }) => {
  let postedBody: unknown = null;
  await page.route("**/api/story", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, storyEnvelope(baseStory));
      return;
    }
    postedBody = route.request().postDataJSON();
    await fulfillJson(route, storyEnvelope(storyAtChapter(2, "A Quiet Gambit")));
  });

  await page.goto("/");
  await page.getByText("Write a different action", { exact: true }).click();
  await page.getByLabel("Describe another attempt").fill("Set a false trail toward the river");
  await page.getByRole("button", { name: "Attempt", exact: true }).click();

  await expect(page.getByRole("heading", { level: 1, name: "A Quiet Gambit" })).toBeVisible();
  expect(postedBody).toEqual({
    description: "Set a false trail toward the river",
    expectedWorldVersion: 2,
    requestId: (postedBody as { requestId: string }).requestId,
    type: "custom_action",
  });
  expect((postedBody as { requestId: string }).requestId).toMatch(/^[0-9a-f-]{36}$/u);
});

test("shows a turn failure and retries the same command", async ({ page }) => {
  let postCount = 0;
  const postedBodies: unknown[] = [];
  await page.route("**/api/story", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, storyEnvelope(baseStory));
      return;
    }
    postCount += 1;
    postedBodies.push(route.request().postDataJSON());
    if (postCount === 1) {
      await fulfillJson(route, { error: "World resolution timed out." }, 504);
      return;
    }
    await fulfillJson(route, storyEnvelope(storyAtChapter(2, "Recovered Embers")));
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Question Nyra about the unmarked class sigil" }).click();
  await expect(page.locator(".error-rail[role=alert]")).toContainText(
    "World resolution timed out.",
  );
  await page.getByRole("button", { name: "Retry" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Recovered Embers" })).toBeVisible();
  expect(postCount).toBe(2);
  expect(postedBodies[1]).toEqual(postedBodies[0]);
});

test("keeps cost telemetry and developer controls out of Reader", async ({ page }) => {
  await mockLoadedStory(page);
  await page.goto("/");

  await expect(page.getByText("$0.0241")).toHaveCount(0);
  await expect(page.getByText(/3,290 tokens/u)).toHaveCount(0);
  await expect(page.getByText("God Mode", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Developer details" })).toHaveCount(0);
  await expect(page.getByText("More", { exact: true })).toHaveCount(0);
});

test("exposes Markdown and reader JSON export endpoints", async ({ page }) => {
  await mockLoadedStory(page);
  await page.goto("/");

  await expect(
    page.locator('a[href="/api/story/export?format=markdown&storyId=rowan-story"]'),
  ).toHaveCount(2);
  await expect(
    page.locator('a[href="/api/story/export?format=json&storyId=rowan-story"]'),
  ).toHaveCount(2);
  await expect(
    page.locator('a[href="/api/story/export?format=markdown&storyId=rowan-story"]').first(),
  ).toHaveAttribute("download", "");
  await expect(
    page.locator('a[href="/api/story/export?format=json&storyId=rowan-story"]').first(),
  ).toHaveAttribute("download", "");
});

test("mobile reader has no horizontal overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-only responsive proof");
  await mockLoadedStory(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Embers Remember" })).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
});

test("reports key readiness without exposing a key", async ({ request }) => {
  const response = await request.get("/api/health");
  const text = await response.text();
  const body = JSON.parse(text) as Record<string, unknown>;

  expect(response.ok()).toBe(true);
  expect(body.maxBackgroundAgents).toBe(3);
  expect(body).not.toHaveProperty("maxCostUsdPerChapter");
  expect(text).not.toContain("OPENAI_API_KEY");
  expect(text).not.toMatch(/sk-[A-Za-z0-9_-]{20,}/u);
});

test("does not reflect request headers in API errors", async ({ request }) => {
  const response = await request.post("/api/story", {
    data: { type: "not-a-command" },
    headers: { "x-secret-probe": "never-reflect-this-header" },
  });
  expect(response.status()).toBe(400);
  expect(await response.text()).not.toContain("never-reflect-this-header");
});
