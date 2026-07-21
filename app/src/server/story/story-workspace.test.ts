import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CONTRACT_VERSION,
  DEFAULT_STORY_SETUP,
  NARRATIVE_AUDIT_DIMENSIONS,
  RUNTIME_SCHEMA_VERSION,
  resolveTurn,
  stageWorldDelta,
  type ChapterRecord,
  type PlayerAction,
  type TraceEnvelope,
  type WorldState,
} from "@infinite-litrpg/shared";
import type OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoryFileStore } from "../storage/story-files";
import { RejectedStoryError, StoryLibrary } from "../storage/story-library";
import { StoryStore, type CommitTurnInput } from "../storage/story-store";
import { StoryService, type TurnCommand } from "./story-service";
import {
  StoryWorkspace,
  StoryWorkspaceClosedError,
  StoryWorkspaceDataError,
  LegacyStoryReadOnlyError,
  StoryTurnInProgressError,
  type StoryWorkspaceOptions,
  type StoryWorkspaceService,
  type StoryWorkspaceServiceFactoryInput,
} from "./story-workspace";

const WORLD_ID = "ashen-crown-v1";
const workspaces: StoryWorkspace[] = [];
let temporaryRoot = "";

beforeEach(() => {
  temporaryRoot = mkdtempSync(join(tmpdir(), "infinite-litrpg-workspace-"));
});

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map(async (workspace) => workspace.close()));
  rmSync(temporaryRoot, { force: true, recursive: true });
});

describe("StoryWorkspace library lifecycle", () => {
  it("logs the real genesis failure to the server console", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const workspace = openWorkspace({
      genesisFactory: async (_setup, onProgress) => {
        onProgress({
          cycle: 3,
          level: "retry",
          message: "Candidate map is disconnected at palace-gate.",
          phase: "world",
        });
        throw new Error("Candidate map is disconnected at palace-gate.");
      },
      idGenerator: sequence("broken1"),
    });

    await expect(
      workspace.createStory({
        povCharacterId: "rowan-ashborn",
        requestId: "request-console-log",
        setup: DEFAULT_STORY_SETUP,
        title: "Broken Genesis",
      }),
    ).rejects.toThrow("Candidate map is disconnected at palace-gate.");

    const logged = consoleError.mock.calls.map(([line]) => String(line)).join("\n");
    expect(logged).toContain('"scope":"story-generation"');
    expect(logged).toContain('"requestId":"request-console-log"');
    expect(logged).toContain("Candidate map is disconnected at palace-gate.");
    expect(workspace.listStories()).toEqual([]);
    consoleError.mockRestore();
  });

  it("opens missing-genesis stories read-only after restart", async () => {
    const first = openWorkspace();
    const created = await first.createStory({
      povCharacterId: "rowan-ashborn",
      title: "Legacy Draft",
    });
    await first.close();

    const reopened = openWorkspace();
    expect(await reopened.exportMarkdown(created.metadata.id)).toContain("# Legacy Draft");
    await expect(
      reopened.takeTurn(created.metadata.id, command(created.story.world.version as number)),
    ).rejects.toBeInstanceOf(LegacyStoryReadOnlyError);
    await expect(reopened.restartStory(created.metadata.id)).rejects.toBeInstanceOf(
      LegacyStoryReadOnlyError,
    );
  });
  it("creates a safe generated ID, locks POV, and exposes active story metadata", async () => {
    const workspace = openWorkspace({ idGenerator: sequence("A1B2C3D4") });

    const created = await workspace.createStory({
      povCharacterId: "rowan-ashborn",
      title: "Ashes & Old Crowns!",
    });

    expect(created.metadata).toMatchObject({
      chapterCount: 0,
      id: "ashes-old-crowns-a1b2c3d4",
      povCharacterId: "rowan-ashborn",
      status: "active",
      title: "Ashes & Old Crowns!",
    });
    expect(created.story.pov.id).toBe("rowan-ashborn");
    expect(workspace.listStories()).toEqual([created.metadata]);
    expect(workspace.getStoryMetadata(created.metadata.id)).toEqual(created.metadata);
    expect(workspace.getActiveStoryMetadata()).toEqual(created.metadata);
    expect((await workspace.getActiveStory())?.metadata).toEqual(created.metadata);
    expect(existsSync(workspace.library.storyDatabasePath(created.metadata.id))).toBe(true);
  });

  it("accepts a safe deterministic ID for trusted local review tooling", async () => {
    const workspace = openWorkspace({ idGenerator: sequence("unused") });

    const created = await workspace.createStory({
      id: "review-rowan-ashborn",
      povCharacterId: "rowan-ashborn",
      title: "Rowan Ashborn Review",
    });

    expect(created.metadata.id).toBe("review-rowan-ashborn");
    expect(existsSync(workspace.library.storyDatabasePath(created.metadata.id))).toBe(true);
    await expect(
      workspace.createStory({
        id: "../unsafe",
        povCharacterId: "rowan-ashborn",
        title: "Unsafe",
      }),
    ).rejects.toThrow("storyId must be a safe lowercase ASCII identifier");
  });

  it("keeps an isolated story.db per story and can reject, inspect, then reopen", async () => {
    const workspace = openWorkspace({ idGenerator: sequence("rowan1", "elara2") });
    const rowan = await workspace.createStory({
      povCharacterId: "rowan-ashborn",
      title: "Rowan Returns",
    });
    const elara = await workspace.createStory({
      povCharacterId: "elara-voss",
      title: "Elara in Exile",
    });
    const rowanDatabase = workspace.library.storyDatabasePath(rowan.metadata.id);
    const elaraDatabase = workspace.library.storyDatabasePath(elara.metadata.id);
    const preservedFile = join(workspace.library.storyDirectoryPath(rowan.metadata.id), "keep.txt");
    writeFileSync(preservedFile, "preserve", "utf8");

    expect(rowanDatabase).not.toBe(elaraDatabase);
    expect(existsSync(rowanDatabase)).toBe(true);
    expect(existsSync(elaraDatabase)).toBe(true);
    expect(workspace.getActiveStoryMetadata()?.id).toBe(elara.metadata.id);

    const rejected = await workspace.rejectStory(rowan.metadata.id);
    expect(rejected.status).toBe("rejected");
    expect(existsSync(rowanDatabase)).toBe(true);
    expect(readFileSync(preservedFile, "utf8")).toBe("preserve");
    expect((await workspace.getStory(rowan.metadata.id))?.story.pov.id).toBe("rowan-ashborn");
    await expect(workspace.takeTurn(rowan.metadata.id, command(1))).rejects.toBeInstanceOf(
      RejectedStoryError,
    );

    const reopened = await workspace.reopenStory(rowan.metadata.id);
    expect(reopened.metadata.status).toBe("active");
    expect(workspace.getActiveStoryMetadata()?.id).toBe(rowan.metadata.id);
  });

  it("creates the replacement before rejecting the old story and preserves the old files", async () => {
    const workspace = openWorkspace({ idGenerator: sequence("old1", "new2", "unused3") });
    const original = await workspace.createStory({
      povCharacterId: "rowan-ashborn",
      title: "Crown Trial",
    });
    const oldDatabase = workspace.library.storyDatabasePath(original.metadata.id);

    const restarted = await workspace.restartStory(original.metadata.id, {
      title: "Crown Trial, Second Life",
    });

    expect(restarted.rejected).toMatchObject({ id: original.metadata.id, status: "rejected" });
    expect(restarted.replacement.metadata).toMatchObject({
      id: "crown-trial-second-life-new2",
      povCharacterId: "rowan-ashborn",
      status: "active",
    });
    expect(workspace.getActiveStoryMetadata()?.id).toBe(restarted.replacement.metadata.id);
    expect(existsSync(oldDatabase)).toBe(true);

    await expect(
      workspace.restartStory(restarted.replacement.metadata.id, { title: " bad title " }),
    ).rejects.toThrow("title must be trimmed");
    expect(workspace.getStoryMetadata(restarted.replacement.metadata.id)?.status).toBe("active");
    expect(workspace.getActiveStoryMetadata()?.id).toBe(restarted.replacement.metadata.id);
  });

  it("gives a default restart a distinct title while preserving the prior draft", async () => {
    const workspace = openWorkspace({ idGenerator: sequence("old1", "new2") });
    const original = await workspace.createStory({
      povCharacterId: "rowan-ashborn",
      title: "Crown Trial",
    });

    const restarted = await workspace.restartStory(original.metadata.id);

    expect(restarted.replacement.metadata.title).toBe("Crown Trial — Restart");
    expect(restarted.rejected).toMatchObject({ title: "Crown Trial", status: "rejected" });
  });

  it("does not invent a new canon database when library metadata points to missing data", async () => {
    const library = new StoryLibrary({ rootDirectory: temporaryRoot });
    const metadata = library.createStory({
      id: "missing-canon",
      povCharacterId: "rowan-ashborn",
      title: "Missing Canon",
    });
    const workspace = openWorkspace();

    await expect(workspace.getStory(metadata.id)).rejects.toBeInstanceOf(StoryWorkspaceDataError);
    expect(existsSync(library.storyDatabasePath(metadata.id))).toBe(false);
  });
});

describe("StoryWorkspace canonical projection", () => {
  it("commits by explicit story ID, projects Markdown, and updates library chapter count", async () => {
    const turnCalls = vi.fn();
    const workspace = openWorkspace({
      idGenerator: sequence("rowan1", "elara2"),
      serviceFactory: committingServiceFactory(turnCalls),
    });
    const rowan = await workspace.createStory({
      povCharacterId: "rowan-ashborn",
      title: "Rowan Canon",
    });
    const elara = await workspace.createStory({
      povCharacterId: "elara-voss",
      title: "Elara Canon",
    });

    const result = await workspace.takeTurn(rowan.metadata.id, command(1));

    expect(turnCalls).toHaveBeenCalledTimes(1);
    expect(result.story.world.chapter).toBe(1);
    expect(result.metadata.chapterCount).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(workspace.getStoryMetadata(elara.metadata.id)?.chapterCount).toBe(0);
    expect((await workspace.getStory(rowan.metadata.id))?.story.world.chapter).toBe(1);
    expect((await workspace.getStory(elara.metadata.id))?.story.world.chapter).toBe(0);

    const files = new StoryFileStore({ rootDirectory: temporaryRoot });
    const markdown = await files.readChapter(rowan.metadata.id, 1);
    expect(markdown).toMatchObject({
      chapter: 1,
      pov: "Rowan Ashborn",
      storyId: rowan.metadata.id,
      title: "Ash Road Vigil",
      worldVersion: 2,
    });
    expect(markdown?.prose.split(/\s+/u)).toHaveLength(900);
    expect(existsSync(workspace.library.chapterMarkdownPath(elara.metadata.id, 1))).toBe(false);
  });

  it("recreates missing Markdown from SQLite without a model or turn call", async () => {
    const turnCalls = vi.fn();
    const workspace = openWorkspace({
      idGenerator: sequence("rowan1"),
      serviceFactory: committingServiceFactory(turnCalls),
    });
    const created = await workspace.createStory({
      povCharacterId: "rowan-ashborn",
      title: "Recoverable Ashes",
    });
    await workspace.takeTurn(created.metadata.id, command(1));
    const markdownPath = workspace.library.chapterMarkdownPath(created.metadata.id, 1);
    unlinkSync(markdownPath);

    const reconciled = await workspace.reconcileStory(created.metadata.id);

    expect(reconciled).toEqual({
      canonicalChapterCount: 1,
      projectedChapterCount: 1,
      warnings: [],
    });
    expect(turnCalls).toHaveBeenCalledTimes(1);
    expect(existsSync(markdownPath)).toBe(true);
    expect(readFileSync(markdownPath, "utf8")).toContain("# Chapter 1: Ash Road Vigil");
  });

  it("returns committed story plus a recoverable warning when Markdown projection fails", async () => {
    const workspace = openWorkspace({
      idGenerator: sequence("rowan1"),
      projectionStore: {
        readChapter: vi.fn(async () => null),
        writeChapter: vi.fn(async () => {
          throw new Error("disk unavailable");
        }),
      },
      serviceFactory: committingServiceFactory(),
    });
    const created = await workspace.createStory({
      povCharacterId: "rowan-ashborn",
      title: "SQLite Survives",
    });

    const result = await workspace.takeTurn(created.metadata.id, command(1));

    expect(result.story.world.chapter).toBe(1);
    expect(result.metadata.chapterCount).toBe(1);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        chapter: 1,
        code: "chapter-projection-failed",
        committed: true,
        retryable: true,
        storyId: created.metadata.id,
      }),
    ]);
    expect(result.warnings[0]?.message).toContain("remains canonical in SQLite");

    const canonical = new StoryStore(workspace.library.storyDatabasePath(created.metadata.id));
    try {
      expect(canonical.loadChapter(WORLD_ID, 1)?.title).toBe("Ash Road Vigil");
    } finally {
      canonical.close();
    }
  });

  it("routes latest rewrites and exports only the requested story", async () => {
    const rerollCalls = vi.fn();
    const workspace = openWorkspace({
      idGenerator: sequence("rowan1", "elara2"),
      serviceFactory: committingServiceFactory(undefined, rerollCalls),
    });
    const rowan = await workspace.createStory({
      povCharacterId: "rowan-ashborn",
      title: "Rowan's New Road",
    });
    const elara = await workspace.createStory({
      povCharacterId: "elara-voss",
      title: "Elara's Quiet Oath",
    });
    await workspace.takeTurn(rowan.metadata.id, command(1));

    const rewritten = await workspace.rerollLatest(rowan.metadata.id, {
      expectedWorldVersion: 2,
      requestId: randomUUID(),
    });

    expect(rerollCalls).toHaveBeenCalledTimes(1);
    expect(rewritten.story.world.chapter).toBe(1);
    expect(await workspace.exportMarkdown(rowan.metadata.id)).toMatch(/^# Rowan's New Road\n/mu);
    expect(await workspace.exportMarkdown(elara.metadata.id)).toMatch(/^# Elara's Quiet Oath\n/mu);
    expect(await workspace.exportJson(rowan.metadata.id)).toContain('"chapter": 1');
    expect(await workspace.exportJson(elara.metadata.id)).toContain('"chapter": 0');
  });
});

describe("StoryWorkspace queues and shutdown", () => {
  it("keeps reads responsive and rejects a duplicate turn while generation is active", async () => {
    let releaseTurn!: () => void;
    let markEntered!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const workspace = openWorkspace({
      idGenerator: sequence("rowan1"),
      serviceFactory: gatedServiceFactory(entered, release, markEntered),
    });
    const rowan = await workspace.createStory({
      povCharacterId: "rowan-ashborn",
      title: "Responsive Rowan",
    });

    const generating = workspace.takeTurn(rowan.metadata.id, command(1));
    await entered;

    expect(workspace.getGenerationStatus(rowan.metadata.id)).toMatchObject({
      mode: "generate",
      phase: "preparing",
      targetChapter: 1,
    });
    expect(workspace.listGenerationStatuses()).toEqual([
      expect.objectContaining({ storyId: rowan.metadata.id, targetChapter: 1 }),
    ]);
    await expect(workspace.getStory(rowan.metadata.id)).resolves.toMatchObject({
      story: { world: { chapter: 0 } },
    });
    await expect(workspace.getReaderChapter(rowan.metadata.id, 1)).rejects.toThrow(
      "outside the saved story",
    );
    await expect(workspace.takeTurn(rowan.metadata.id, command(1))).rejects.toBeInstanceOf(
      StoryTurnInProgressError,
    );

    releaseTurn();
    await generating;
    expect(workspace.getGenerationStatus(rowan.metadata.id)).toBeNull();
  });

  it("returns the committed chapter when generation finishes during a responsive read", async () => {
    let releaseRead!: () => void;
    let markReadEntered!: () => void;
    const readMayFinish = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const readEntered = new Promise<void>((resolve) => {
      markReadEntered = resolve;
    });
    const files = new StoryFileStore({ rootDirectory: temporaryRoot });
    let blockNextChapterRead = false;
    const workspace = openWorkspace({
      idGenerator: sequence("rowan1"),
      projectionStore: {
        readChapter: async (storyId, chapter) => {
          if (blockNextChapterRead && chapter === 1) {
            blockNextChapterRead = false;
            markReadEntered();
            await readMayFinish;
          }
          return files.readChapter(storyId, chapter);
        },
        writeChapter: (input, options) => files.writeChapter(input, options),
      },
      serviceFactory: committingServiceFactory(),
    });
    const rowan = await workspace.createStory({
      povCharacterId: "rowan-ashborn",
      title: "Refresh Race",
    });
    await workspace.takeTurn(rowan.metadata.id, command(1));

    blockNextChapterRead = true;
    const refresh = workspace.getStory(rowan.metadata.id);
    await readEntered;
    const committed = await workspace.takeTurn(rowan.metadata.id, command(2));
    expect(committed.story.world.chapter).toBe(2);
    releaseRead();

    await expect(refresh).resolves.toMatchObject({
      generation: null,
      metadata: { chapterCount: 2 },
      story: { world: { chapter: 2 } },
    });
    expect(workspace.getStoryMetadata(rowan.metadata.id)?.chapterCount).toBe(2);
  });

  it("allows different stories to progress together", async () => {
    const activeByPov = new Map<string, number>();
    const maxByPov = new Map<string, number>();
    let globalActive = 0;
    let maxGlobalActive = 0;
    const workspace = openWorkspace({
      idGenerator: sequence("rowan1", "elara2"),
      serviceFactory: delayedServiceFactory({
        onEnter(povId) {
          const active = (activeByPov.get(povId) ?? 0) + 1;
          activeByPov.set(povId, active);
          maxByPov.set(povId, Math.max(maxByPov.get(povId) ?? 0, active));
          globalActive += 1;
          maxGlobalActive = Math.max(maxGlobalActive, globalActive);
        },
        onExit(povId) {
          activeByPov.set(povId, (activeByPov.get(povId) ?? 1) - 1);
          globalActive -= 1;
        },
      }),
    });
    const rowan = await workspace.createStory({
      povCharacterId: "rowan-ashborn",
      title: "Queued Rowan",
    });
    const elara = await workspace.createStory({
      povCharacterId: "elara-voss",
      title: "Queued Elara",
    });

    maxGlobalActive = 0;
    await Promise.all([
      workspace.takeTurn(rowan.metadata.id, command(1)),
      workspace.takeTurn(elara.metadata.id, command(1)),
    ]);
    expect(maxGlobalActive).toBe(2);
  });

  it("waits for queued work, closes every per-story store, and rejects later use", async () => {
    const closeSpies: ReturnType<typeof vi.spyOn>[] = [];
    const workspace = openWorkspace({
      idGenerator: sequence("rowan1", "elara2"),
      serviceFactory: delayedServiceFactory(),
      storeFactory(databasePath) {
        const store = new StoryStore(databasePath);
        closeSpies.push(vi.spyOn(store, "close"));
        return store;
      },
    });
    const rowan = await workspace.createStory({
      povCharacterId: "rowan-ashborn",
      title: "Closing Rowan",
    });
    await workspace.createStory({
      povCharacterId: "elara-voss",
      title: "Closing Elara",
    });
    const queued = workspace.takeTurn(rowan.metadata.id, command(1));

    await workspace.close();
    await queued;

    expect(closeSpies).toHaveLength(2);
    expect(closeSpies.every((spy) => spy.mock.calls.length === 1)).toBe(true);
    expect(() => workspace.listStories()).toThrow(StoryWorkspaceClosedError);
    await expect(workspace.getStory(rowan.metadata.id)).rejects.toBeInstanceOf(
      StoryWorkspaceClosedError,
    );
    await workspace.close();
  });
});

function openWorkspace(overrides: Partial<StoryWorkspaceOptions> = {}): StoryWorkspace {
  const workspace = new StoryWorkspace({
    client: unusedClient(),
    idGenerator: sequence("default1", "default2", "default3"),
    rootDirectory: temporaryRoot,
    serviceOptions: serviceOptions(),
    ...overrides,
  });
  workspaces.push(workspace);
  return workspace;
}

function gatedServiceFactory(
  _entered: Promise<void>,
  release: Promise<void>,
  markEntered: () => void,
) {
  return (input: StoryWorkspaceServiceFactoryInput): StoryWorkspaceService => {
    const base = new StoryService(input.store, input.client, input.options, input.seedLoader);
    return {
      exportJson: () => base.exportJson(),
      exportMarkdown: () => base.exportMarkdown(),
      getReaderChapter: (chapter) => base.getReaderChapter(chapter),
      getStory: () => base.getStory(),
      initializeGenesis: (genesis) => base.initializeGenesis(genesis),
      rerollLatest: (rerollCommand, onChunk) => base.rerollLatest(rerollCommand, onChunk),
      selectPov: (pov, setup) => base.selectPov(pov, setup),
      takeTurn: async () => {
        markEntered();
        await release;
        return requireView(base.getStory());
      },
    };
  };
}

function serviceOptions() {
  return {
    maxBackgroundAgents: 0,
    maxCostUsdPerChapter: 1,
    nativeMultiAgent: false,
  } as const;
}

function sequence(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `generated${index}`;
}

function command(expectedWorldVersion: number): TurnCommand {
  return {
    description: "Investigate the immediate area for fresh tracks.",
    expectedWorldVersion,
    requestId: randomUUID(),
    type: "custom_action",
  };
}

function committingServiceFactory(
  turnCalls: ((command: TurnCommand) => unknown) | undefined = () => undefined,
  rerollCalls: (command: {
    readonly expectedWorldVersion: number;
    readonly requestId: string;
  }) => unknown = () => undefined,
) {
  return (input: StoryWorkspaceServiceFactoryInput): StoryWorkspaceService => {
    const base = new StoryService(input.store, input.client, input.options, input.seedLoader);
    return {
      exportJson: () => base.exportJson(),
      exportMarkdown: () => base.exportMarkdown(),
      getReaderChapter: (chapter) => base.getReaderChapter(chapter),
      getStory: () => base.getStory(),
      initializeGenesis: (genesis) => base.initializeGenesis(genesis),
      rerollLatest: async (rerollCommand) => {
        rerollCalls(rerollCommand);
        return requireView(base.getStory());
      },
      selectPov: (pov) => base.selectPov(pov),
      takeTurn: async (turnCommand) => {
        turnCalls(turnCommand);
        const existing = input.store.loadChapterByRequestId(WORLD_ID, turnCommand.requestId);
        if (existing !== null) return requireView(base.getStory());
        const before = input.store.loadWorldState(WORLD_ID);
        if (before === null) throw new Error("Test world is missing");
        input.store.commitTurn(makeTurn(before, turnCommand.requestId));
        return requireView(base.getStory());
      },
    };
  };
}

function delayedServiceFactory(
  hooks: {
    readonly onEnter?: (povId: string) => void;
    readonly onExit?: (povId: string) => void;
  } = {},
) {
  return (input: StoryWorkspaceServiceFactoryInput): StoryWorkspaceService => {
    const base = new StoryService(input.store, input.client, input.options, input.seedLoader);
    return {
      exportJson: () => base.exportJson(),
      exportMarkdown: () => base.exportMarkdown(),
      getReaderChapter: (chapter) => base.getReaderChapter(chapter),
      getStory: () => base.getStory(),
      initializeGenesis: (genesis) => base.initializeGenesis(genesis),
      rerollLatest: (rerollCommand, onChunk) => base.rerollLatest(rerollCommand, onChunk),
      selectPov: (pov) => base.selectPov(pov),
      takeTurn: async () => {
        const story = requireView(base.getStory());
        const povId = String(story.pov.id);
        hooks.onEnter?.(povId);
        try {
          await new Promise<void>((resolve) => setTimeout(resolve, 25));
          return story;
        } finally {
          hooks.onExit?.(povId);
        }
      },
    };
  };
}

function makeTurn(before: WorldState, requestId: string): CommitTurnInput {
  if (before.lockedPovId !== "rowan-ashborn") {
    throw new Error("The focused canonical commit fixture is Rowan-only");
  }
  const playerAction: PlayerAction = {
    action: { subjectId: "cinder-village", type: "investigate" },
    actorId: before.lockedPovId,
    description: "Watch the ash road before acting.",
    milestoneId: null,
    source: "suggested",
    stateVersion: before.version,
  };
  const resolved = resolveTurn(before, playerAction, []);
  if (!resolved.ok) throw new Error(JSON.stringify(resolved.issues));
  const staged = stageWorldDelta(before, resolved.data.intents, resolved.data.delta);
  if (!staged.ok) throw new Error(JSON.stringify(staged.issues));

  const traceId = randomUUID();
  const prose = words(
    "Ash drifted across the silent road while Rowan watched the ruined village",
    900,
  );
  const proseHash = createHash("sha256").update(prose).digest("hex");
  const usage = {
    cacheWriteTokens: 0,
    cachedInputTokens: 10,
    inputTokens: 100,
    outputTokens: 50,
    reasoningTokens: 5,
    totalTokens: 155,
  };
  const chapter: ChapterRecord = {
    chapter: staged.data.state.chapter,
    choices: [
      {
        action: { destinationId: "ash-road", type: "move" },
        description: "Follow the raider trail onto Ash Road.",
        id: "choice-1",
        milestoneId: null,
      },
      {
        action: { skillId: "ember-sense", targetId: null, type: "use_skill" },
        description: "Use Ember Sense on the village cinders.",
        id: "choice-2",
        milestoneId: null,
      },
    ],
    estimatedCostUsd: 0.01,
    id: `chapter-${String(staged.data.state.chapter).padStart(3, "0")}`,
    latencyMs: 125,
    narrativeAudit: {
      approved: true,
      evidence: NARRATIVE_AUDIT_DIMENSIONS.map((dimension) => ({
        detail: "The action, state, and viewpoint remain consistent.",
        dimension,
        issueCode: "pass",
      })),
      leakedFactIds: [],
      proseHash,
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
    playerAction,
    povCharacterId: before.lockedPovId,
    prose,
    proseHash,
    requestId,
    safeContextHash: "a".repeat(64),
    stateAfterVersion: staged.data.state.version,
    stateBeforeVersion: before.version,
    terminal: staged.data.state.terminal,
    title: "Ash Road Vigil",
    traceId,
    usage,
  };
  const trace: TraceEnvelope = {
    acceptedDelta: resolved.data.delta,
    adapterMode: "sequential",
    attempts: [
      {
        agentId: null,
        attempt: 0,
        costUsd: 0.01,
        errorCode: null,
        latencyMs: 125,
        model: "gpt-5.6-terra",
        phase: "narration",
        requestedServiceTier: "standard",
        responseId: `resp_workspace_narration_${before.version}`,
        serviceTier: "standard",
        usage,
      },
    ],
    calls: [
      modelCall("intent", `resp_workspace_intent_${before.version}`),
      modelCall("narration", `resp_workspace_narration_${before.version}`, usage, 0.01),
      modelCall("audit", `resp_workspace_audit_${before.version}`),
    ],
    contractVersion: CONTRACT_VERSION,
    fixtureId: before.id,
    fixtureVersion: before.fixtureVersion,
    gateResult: "passed",
    gitSha: "abcdef0",
    intents: [...resolved.data.intents],
    multiAgentOutputItems: [],
    pricingVersion: "test-pricing-v1",
    promptVersion: resolved.data.delta.promptVersion,
    runId: traceId,
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    seed: before.version,
    stateAfterHash: hashJson(staged.data.state),
    stateBeforeHash: hashJson(before),
    totalEstimatedCostUsd: 0.01,
    totalLatencyMs: 125,
    totalUsage: usage,
    validationFailures: [],
  };
  return { chapter, delta: resolved.data.delta, state: staged.data.state, trace };
}

function modelCall(
  phase: "audit" | "intent" | "narration",
  responseId: string,
  callUsage = zeroUsage(),
  estimatedCostUsd = 0,
): TraceEnvelope["calls"][number] {
  return {
    agentId: null,
    errorCode: null,
    estimatedCostUsd,
    latencyMs: estimatedCostUsd === 0 ? 0 : 125,
    model: phase === "narration" ? "gpt-5.6-terra" : "gpt-5.6-luna",
    phase,
    reasoningEffort: "none",
    refusal: false,
    requestedServiceTier: "standard",
    responseId,
    retries: 0,
    serviceTier: "standard",
    timedOut: false,
    usage: callUsage,
  };
}

function zeroUsage() {
  return {
    cacheWriteTokens: 0,
    cachedInputTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
}

function words(seed: string, count: number): string {
  const tokens = seed.split(/\s+/u);
  return Array.from({ length: count }, (_, index) => tokens[index % tokens.length]).join(" ");
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function requireView(view: ReturnType<StoryService["getStory"]>) {
  if (view === null) throw new Error("Test story view is missing");
  return view;
}

function unusedClient(): OpenAI {
  return {
    responses: {
      create: vi.fn(() => {
        throw new Error("Unexpected model call");
      }),
      stream: vi.fn(() => {
        throw new Error("Unexpected model call");
      }),
    },
  } as unknown as OpenAI;
}
