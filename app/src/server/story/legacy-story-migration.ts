import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";

import { StoryStore } from "../storage/story-store";
import type { StoryMetadata } from "../storage/story-library";
import type { StoryWorkspace } from "./story-workspace";

const WORLD_ID = "ashen-crown-v1";
const IMPORTED_STORY_ID = "imported-ashen-crown";

/**
 * Copies the old singleton save into the new story library once. The source is
 * never deleted or moved. SQLite's backup API includes committed WAL pages.
 */
export async function migrateLegacyStoryDatabase(
  workspace: StoryWorkspace,
  legacyDatabasePath: string,
): Promise<StoryMetadata | null> {
  if (workspace.listStories().length > 0 || !existsSync(legacyDatabasePath)) return null;

  mkdirSync(workspace.rootDirectory, { recursive: true });
  const snapshotPath = join(workspace.rootDirectory, `.legacy-${randomUUID()}.db`);
  let source: Database.Database | null = null;

  try {
    try {
      source = new Database(legacyDatabasePath, { fileMustExist: true });
      await source.backup(snapshotPath);
    } finally {
      source?.close();
    }
  } catch (error) {
    rmSync(snapshotPath, { force: true });
    throw error;
  }

  let snapshotStore: StoryStore | null = null;
  try {
    snapshotStore = new StoryStore(snapshotPath);
    const state = snapshotStore.loadWorldState(WORLD_ID);
    if (state?.lockedPovId === null || state === null) return null;

    const metadata = workspace.library.createStory({
      id: IMPORTED_STORY_ID,
      povCharacterId: state.lockedPovId,
      title: "Ashen Crown",
    });
    snapshotStore.close();
    snapshotStore = null;

    try {
      renameSync(snapshotPath, workspace.library.storyDatabasePath(metadata.id));
    } catch (error) {
      workspace.library.rejectStory(metadata.id);
      throw error;
    }
    return metadata;
  } finally {
    snapshotStore?.close();
    rmSync(snapshotPath, { force: true });
  }
}
