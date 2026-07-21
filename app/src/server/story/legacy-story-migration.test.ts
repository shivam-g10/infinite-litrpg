import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type OpenAI from "openai";
import { afterEach, describe, expect, it } from "vitest";

import { StoryStore } from "../storage/story-store";
import { migrateLegacyStoryDatabase } from "./legacy-story-migration";
import { StoryService } from "./story-service";
import { StoryWorkspace } from "./story-workspace";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("legacy story migration", () => {
  it("copies the old singleton database into the ignored story library once", async () => {
    const root = temporaryRoot();
    const legacyPath = join(root, "data", "ashen-crown.db");
    mkdirSync(join(root, "data"));
    const legacyStore = new StoryStore(legacyPath);
    new StoryService(legacyStore, unusedClient(), serviceOptions()).selectPov("rowan-ashborn");
    expect(existsSync(`${legacyPath}-wal`)).toBe(true);

    const workspace = new StoryWorkspace({
      client: unusedClient(),
      rootDirectory: join(root, "stories"),
      serviceOptions: serviceOptions(),
    });
    try {
      try {
        const imported = await migrateLegacyStoryDatabase(workspace, legacyPath);

        expect(imported).toMatchObject({
          id: "imported-ashen-crown",
          povCharacterId: "rowan-ashborn",
          status: "active",
          title: "Ashen Crown",
        });
        expect(existsSync(legacyPath)).toBe(true);
        expect(existsSync(join(root, "stories", "imported-ashen-crown", "story.db"))).toBe(true);
        expect((await workspace.getActiveStory())?.story.pov.id).toBe("rowan-ashborn");
        await expect(migrateLegacyStoryDatabase(workspace, legacyPath)).resolves.toBeNull();
      } finally {
        legacyStore.close();
      }
    } finally {
      await workspace.close();
    }

    const preservedStore = new StoryStore(legacyPath);
    expect(preservedStore.loadWorldState("ashen-crown-v1")?.lockedPovId).toBe("rowan-ashborn");
    preservedStore.close();
  });

  it("does nothing when the legacy database is absent", async () => {
    const root = temporaryRoot();
    const workspace = new StoryWorkspace({
      client: unusedClient(),
      rootDirectory: join(root, "stories"),
      serviceOptions: serviceOptions(),
    });
    try {
      await expect(
        migrateLegacyStoryDatabase(workspace, join(root, "data", "missing.db")),
      ).resolves.toBeNull();
      expect(workspace.listStories()).toEqual([]);
    } finally {
      await workspace.close();
    }
  });
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "infinite-litrpg-migration-"));
  roots.push(root);
  return root;
}

function unusedClient(): OpenAI {
  return {} as OpenAI;
}

function serviceOptions() {
  return {
    maxBackgroundAgents: 0,
    maxCostUsdPerChapter: 1,
    nativeMultiAgent: false,
  } as const;
}
