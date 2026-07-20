import { expect, test, type Page, type Route } from "@playwright/test";

const baseStory = {
  adapterMode: "sequential",
  chapter: {
    choices: [
      { description: "Follow the ash trail beyond Cinder Village", id: "choice-1" },
      { description: "Question Nyra about the unmarked class sigil", id: "choice-2" },
    ],
    prose:
      "Smoke clung to the low eaves like a living thing, reluctant to leave. Rowan crouched beneath the shattered watchpost, the taste of ash and copper thick on their tongue.\n\nCinder Village was mostly silence now, save for the soft crackle of lingering flames and the distant groan of a beam giving way. The raiders were gone. Whatever they had wanted, they had taken.\n\nAt the center of the square, a trail of gray ash wound between toppled stalls and broken carts. It was not windblown. It was stepped through.\n\nBehind them, a voice spoke from the shadow of a half-fallen awning. “You do not have to do this alone.” Nyra’s tone was calm, unreadable.",
    title: "Embers Remember",
  },
  continuationPlan: null,
  estimatedCostUsd: 0.0241,
  godMode: {
    audit: { approved: true, evidence: ["POV-safe narration"] },
    calls: [
      {
        latencyMs: 4200,
        model: "gpt-5.6-luna",
        phase: "intent",
        requestedServiceTier: "standard",
        responseId: "resp_intent",
        serviceTier: "standard",
      },
      {
        latencyMs: 3800,
        model: "gpt-5.6-luna",
        phase: "narration",
        requestedServiceTier: "standard",
        responseId: "resp_narration",
        serviceTier: "standard",
      },
    ],
    delta: {
      acceptedIntentIds: ["intent-elara", "intent-nyra"],
      clock: { fromAct: 1, fromChapter: 0, toAct: 1, toChapter: 1 },
      events: [{ id: "event-ash-trail", summary: "Ash trail leads out of Cinder Village." }],
      knowledgeMutations: [],
      rejectedIntents: [
        { code: "CONFLICT_LOST", intentId: "intent-varek", reason: "Remote conflict deferred." },
      ],
      stateMutations: [
        {
          characterId: "rowan-ashborn",
          fromLocationId: "cinder-village",
          toLocationIds: ["ash-road"],
          type: "set_location",
        },
      ],
    },
    gateResult: "passed",
    intents: [
      {
        accepted: true,
        actorId: "elara-voss",
        actorName: "Elara Voss",
        expectedEffect: "The broken seal is inspected.",
        goal: "Verify the broken prophecy seal",
        id: "intent-elara",
        phase: "Execution",
      },
      {
        accepted: true,
        actorId: "nyra-vale",
        actorName: "Nyra Vale",
        expectedEffect: "A matching sigil is found.",
        goal: "Trace the unmarked class sigil",
        id: "intent-nyra",
        phase: "Execution",
      },
      {
        accepted: false,
        actorId: "varek-thorn",
        actorName: "Varek Thorn",
        expectedEffect: "Survivors regroup.",
        goal: "Rally survivors at Black March",
        id: "intent-varek",
        phase: "Pending",
      },
    ],
    promptVersion: "1.4.11",
    rejected: [{ code: "CONFLICT_LOST", id: "intent-varek", reason: "Remote conflict deferred." }],
    schemaVersion: "1.1.0-runtime-candidates-5",
    stateAfterHash: "9d7e2b4c6a1f8e3d".repeat(4),
    stateBeforeHash: "2f1a9c7b8d3e4f6a".repeat(4),
  },
  latencyMs: 8400,
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
  progress: 1 / 350,
  usage: {
    cachedInputTokens: 200,
    inputTokens: 2184,
    outputTokens: 1106,
    reasoningTokens: 0,
    totalTokens: 3290,
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
    continuationPlan: canContinue
      ? {
          chapterCount: endChapter - chapter,
          endChapter,
          maxCostUsd: Math.round((endChapter - chapter) * 0.1 * 1_000_000_000) / 1_000_000_000,
          maxCostUsdPerChapter: 0.1,
        }
      : null,
    progress: chapter / 350,
    world: { ...baseStory.world, chapter, version: chapter + 1 },
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: "application/json",
    status,
  });
}

async function confirmContinuation(page: Page): Promise<void> {
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
    await fulfillJson(route, { story: baseStory });
  });
}

test("selects one of six characters, locks POV, and enters reader", async ({ page }) => {
  let postedBody: unknown = null;
  await page.route("**/api/story", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, { story: null });
      return;
    }
    postedBody = route.request().postDataJSON();
    const elaraStory = {
      ...baseStory,
      pov: {
        ...baseStory.pov,
        characterClass: "Sunblade",
        id: "elara-voss",
        level: 18,
        location: "Capital",
        name: "Elara Voss",
        publicRole: "Chosen Hero who doubts the prophecy",
      },
    };
    await fulfillJson(route, { story: elaraStory });
  });

  await page.goto("/");
  await expect(page).toHaveTitle("Infinite LitRPG");
  await expect(page.getByRole("heading", { level: 1, name: "Choose one life." })).toBeVisible();
  await expect(
    page.getByRole("radiogroup", { name: "Selectable characters" }).getByRole("radio"),
  ).toHaveCount(6);

  await page.getByRole("radio", { name: /Rowan Ashborn/ }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: /Elara Voss/ })).toBeChecked();
  await page.getByRole("button", { name: "Begin as Elara" }).click();

  await expect(page.locator(".reader-context strong")).toContainText("Elara Voss");
  await expect(page.getByRole("heading", { level: 1, name: "Embers Remember" })).toBeVisible();
  await expect(page.getByText("Viewpoint locked")).toBeAttached();
  expect(postedBody).toEqual({ povCharacterId: "elara-voss", type: "select_pov" });
});

test("takes a suggested choice and renders the committed chapter", async ({ page }) => {
  let postedBody: unknown = null;
  await page.route("**/api/story", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, { story: baseStory });
      return;
    }
    postedBody = route.request().postDataJSON();
    expect(route.request().headers().accept).toContain("application/x-ndjson");
    await fulfillNdjson(route, [
      { text: "Validated prose chunk one. ", type: "chunk" },
      { text: "Validated prose chunk two.", type: "chunk" },
      { story: storyAtChapter(2, "The Ash Road"), type: "story" },
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
      await fulfillJson(route, { story: storyAtChapter(1, "Embers Remember", true) });
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
    await fulfillJson(route, {
      story: storyAtChapter(chapter, `Chapter ${chapter}`, canContinue),
    });
  });

  await page.goto("/");
  await expect(page.getByText("Up to 46 chapters · maximum $4.6000")).toBeVisible();
  await page.getByRole("button", { name: "Continue to next decision" }).click();
  await expect(page.getByRole("heading", { name: "Create up to 46 chapters?" })).toBeVisible();
  await expect(page.getByText(/Through chapter 47\. Maximum \$4\.6000/u)).toBeVisible();
  await page.getByRole("button", { name: "Start generation" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Chapter 47" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Follow the ash trail beyond Cinder Village" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Chapter 48" })).toBeVisible();
  await confirmContinuation(page);
  await expect(page.getByRole("heading", { level: 1, name: "Chapter 97" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Follow the ash trail beyond Cinder Village" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Chapter 98" })).toBeVisible();
  await confirmContinuation(page);
  await expect(
    page.getByRole("heading", { exact: true, level: 1, name: "Chapter 100" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { exact: true, level: 1, name: "Chapter 100" }),
  ).toBeFocused();
  await expect(page.getByText("Chapter 100 of 100", { exact: true })).toBeVisible();
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
      await fulfillJson(route, { story: storyAtChapter(1, "Embers Remember", true) });
      return;
    }
    postCount += 1;
    await requestMayFinish;
    await fulfillJson(route, { story: storyAtChapter(2, "The Next Ember", true) });
  });

  await page.goto("/");
  await confirmContinuation(page);
  await page.getByRole("button", { name: "Stop after this chapter" }).click();
  finishRequest();

  await expect(page.getByRole("heading", { level: 1, name: "The Next Ember" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "The Next Ember" })).toBeFocused();
  await expect(page.getByText("Stopped after chapter 2.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to next decision" })).toBeVisible();
  expect(postCount).toBe(1);
});

test("submits a custom action", async ({ page }) => {
  let postedBody: unknown = null;
  await page.route("**/api/story", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, { story: baseStory });
      return;
    }
    postedBody = route.request().postDataJSON();
    await fulfillJson(route, { story: storyAtChapter(2, "A Quiet Gambit") });
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
      await fulfillJson(route, { story: baseStory });
      return;
    }
    postCount += 1;
    postedBodies.push(route.request().postDataJSON());
    if (postCount === 1) {
      await fulfillJson(route, { error: "World resolution timed out." }, 504);
      return;
    }
    await fulfillJson(route, { story: storyAtChapter(2, "Recovered Embers") });
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

test("opens God Mode with intents, rejection, delta, usage, and trace", async ({ page }) => {
  await mockLoadedStory(page);
  await page.goto("/");

  await page.locator("button:visible", { hasText: "God Mode" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "God Mode" })).toBeAttached();
  await expect(page.getByRole("heading", { level: 2, name: "Background intents" })).toBeVisible();
  await expect(page.getByText("Verify the broken prophecy seal")).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Rejected intents" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Canonical resolution" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Trace" })).toBeVisible();
  await expect(page.locator(".trace-column").getByText("$0.0241")).toBeVisible();
  await expect(page.locator(".trace-column").getByText("1.4.11", { exact: true })).toBeVisible();
  await expect(
    page.locator(".trace-column").getByText("1.1.0-runtime-candidates-5", { exact: true }),
  ).toBeVisible();

  const hashLayout = await page.locator(".trace-hashes > div").evaluateAll((rows) =>
    rows.map((row) => {
      const term = row.querySelector("dt")?.getBoundingClientRect();
      const value = row.querySelector("dd")?.getBoundingClientRect();
      const bounds = row.getBoundingClientRect();
      return {
        fits: Boolean(
          term &&
          value &&
          term.right <= value.left + 1 &&
          value.right <= bounds.right + 1 &&
          row.scrollWidth <= row.clientWidth,
        ),
      };
    }),
  );
  expect(hashLayout).toEqual([{ fits: true }, { fits: true }]);
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
});

test("exposes Markdown and JSON export endpoints", async ({ page }) => {
  await mockLoadedStory(page);
  await page.goto("/");

  await expect(page.locator('a[href="/api/story/export?format=markdown"]')).toHaveCount(2);
  await expect(page.locator('a[href="/api/story/export?format=json"]')).toHaveCount(2);
  await expect(page.locator('a[href="/api/story/export?format=markdown"]').first()).toHaveAttribute(
    "download",
    "",
  );
  await expect(page.locator('a[href="/api/story/export?format=json"]').first()).toHaveAttribute(
    "download",
    "",
  );
  await page.locator("button:visible", { hasText: "God Mode" }).click();
  await expect(page.locator('a[href="/api/story/export?format=json&scope=god"]')).toHaveCount(2);
  await expect(page.getByText("God Mode JSON").first()).toBeAttached();
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
