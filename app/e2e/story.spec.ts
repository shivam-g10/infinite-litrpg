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
  estimatedCostUsd: 0.0241,
  godMode: {
    audit: { approved: true, evidence: ["POV-safe narration"] },
    calls: [
      {
        latencyMs: 4200,
        model: "gpt-5.6-luna",
        phase: "intent",
        responseId: "resp_intent",
      },
      {
        latencyMs: 3800,
        model: "gpt-5.6-terra",
        phase: "narration",
        responseId: "resp_narration",
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
    promptVersion: "v1",
    rejected: [{ code: "CONFLICT_LOST", id: "intent-varek", reason: "Remote conflict deferred." }],
    schemaVersion: "v1",
    stateAfterHash: "9d7e2b4c6a1f8e3d",
    stateBeforeHash: "2f1a9c7b8d3e4f6a",
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

function storyAtChapter(chapter: number, title: string) {
  return {
    ...baseStory,
    chapter: { ...baseStory.chapter, title },
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
    page.getByRole("list", { name: "Selectable characters" }).getByRole("button"),
  ).toHaveCount(6);

  await page.getByRole("button", { name: /Elara Voss/ }).click();
  await page.getByRole("button", { name: "Begin as Elara" }).click();

  await expect(
    page.locator(".reader-layout h1:visible, .mobile-story-context p:visible"),
  ).toContainText("Elara Voss");
  await expect(page.getByRole("heading", { level: 2, name: "Embers Remember" })).toBeVisible();
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

  await expect(page.getByRole("heading", { level: 2, name: "The Ash Road" })).toBeVisible();
  expect(postedBody).toMatchObject({
    choiceId: "choice-1",
    expectedWorldVersion: 2,
    type: "take_action",
  });
  expect((postedBody as { requestId: string }).requestId).toMatch(/^[0-9a-f-]{36}$/u);
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
  await page.getByLabel("Describe another attempt").fill("Set a false trail toward the river");
  await page.getByRole("button", { name: "Attempt", exact: true }).click();

  await expect(page.getByRole("heading", { level: 2, name: "A Quiet Gambit" })).toBeVisible();
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

  await expect(page.getByRole("heading", { level: 2, name: "Recovered Embers" })).toBeVisible();
  expect(postCount).toBe(2);
  expect(postedBodies[1]).toEqual(postedBodies[0]);
});

test("opens God Mode with intents, rejection, delta, usage, and trace", async ({ page }) => {
  await mockLoadedStory(page);
  await page.goto("/");

  await page.locator("button:visible", { hasText: "God Mode" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Background intents" })).toBeVisible();
  await expect(page.getByText("Verify the broken prophecy seal")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Rejected intents" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Canonical resolution" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Trace" })).toBeVisible();
  await expect(page.locator(".trace-column").getByText("$0.0241")).toBeVisible();
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
  await expect(page.getByRole("heading", { level: 2, name: "Embers Remember" })).toBeVisible();

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
