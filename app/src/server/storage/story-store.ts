import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  ChapterRecordSchema,
  FailedTurnTraceSchema,
  KnowledgeMutationSchema,
  PersistedTraceEnvelopeSchema,
  PersistedWorldDeltaSchema,
  TraceEnvelopeSchema,
  WorldDeltaSchema,
  WorldStateSchema,
  StorySetupSchema,
  stageWorldDelta,
  validateChapterDraft,
  validateNarrativeStateClaims,
  validateWorldState,
  type ChapterRecord,
  type FailedTurnTrace,
  type PersistedTraceEnvelope,
  type PersistedWorldDelta,
  type StorySetup,
  type TraceEnvelope,
  type WorldDelta,
  type WorldState,
} from "@infinite-litrpg/shared";

const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

export type CommitFailurePoint =
  | "after-world-create"
  | "after-story-setup-insert"
  | "after-world-update"
  | "after-delta-insert"
  | "after-knowledge-changes"
  | "after-chapter-insert"
  | "after-trace-insert"
  | "after-usage-insert"
  | "after-reroll-archive"
  | "after-reroll-chapter-update"
  | "after-reroll-trace-insert"
  | "after-reroll-usage-insert";

export interface StoryStoreOptions {
  readonly busyTimeoutMs?: number;
  /** Test seam. Throwing here proves SQLite rolls back the complete turn. */
  readonly failureInjector?: (point: CommitFailurePoint) => void;
}

export interface CommitTurnInput {
  /** Fully staged, validated post-turn state. */
  readonly state: WorldState;
  readonly delta: WorldDelta;
  readonly chapter: ChapterRecord;
  readonly trace: TraceEnvelope;
}

export interface ReplaceLatestChapterNarrationInput {
  readonly chapter: ChapterRecord;
  readonly expectedPriorProseHash: string;
  readonly expectedPriorTraceId: string;
  readonly expectedWorldVersion: number;
  readonly trace: TraceEnvelope | PersistedTraceEnvelope;
  readonly worldId: string;
}

export interface StoredTurnUsage {
  readonly chapterUsage: ChapterRecord["usage"];
  readonly totalEstimatedCostUsd: number;
  readonly totalLatencyMs: number;
  readonly traceUsage: TraceEnvelope["totalUsage"];
}

export interface StoredChapterRevision {
  readonly archivedByTraceId: string;
  readonly chapter: ChapterRecord;
  readonly revision: number;
  readonly trace: PersistedTraceEnvelope;
  readonly usage: StoredTurnUsage;
}

export class InvalidCommitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCommitError";
  }
}

export class StaleWorldVersionError extends Error {
  readonly expectedVersion: number;
  readonly worldId: string;

  constructor(worldId: string, expectedVersion: number) {
    super(`World ${worldId} is missing or no longer at version ${expectedVersion}`);
    this.name = "StaleWorldVersionError";
    this.expectedVersion = expectedVersion;
    this.worldId = worldId;
  }
}

export class StaleChapterNarrationError extends Error {
  readonly chapter: number;
  readonly worldId: string;

  constructor(worldId: string, chapter: number) {
    super(`Chapter ${chapter} in world ${worldId} no longer has the expected narration`);
    this.name = "StaleChapterNarrationError";
    this.chapter = chapter;
    this.worldId = worldId;
  }
}

interface JsonRow {
  readonly json: string;
}

interface KnowledgeJsonRow {
  readonly change_json: string;
}

interface UsageRow {
  readonly chapter_usage_json: string;
  readonly total_estimated_cost_usd: number;
  readonly total_latency_ms: number;
  readonly trace_usage_json: string;
}

interface StoredUsageRow extends UsageRow {
  readonly trace_id: string;
}

interface ChapterNumberRow {
  readonly chapter: number;
}

interface RevisionNumberRow {
  readonly revision: number | null;
}

interface ChapterRevisionRow extends UsageRow {
  readonly archived_by_trace_id: string;
  readonly chapter_json: string;
  readonly revision: number;
  readonly trace_json: string;
}

interface PreparedCommit {
  readonly chapter: ChapterRecord;
  readonly chapterJson: string;
  readonly delta: WorldDelta;
  readonly deltaJson: string;
  readonly knowledgeChanges: readonly {
    readonly characterId: string;
    readonly factId: string;
    readonly json: string;
    readonly sequence: number;
  }[];
  readonly state: WorldState;
  readonly stateJson: string;
  readonly trace: TraceEnvelope;
  readonly traceJson: string;
  readonly chapterUsageJson: string;
  readonly traceUsageJson: string;
}

interface PreparedNarrationReplacement {
  readonly chapter: ChapterRecord;
  readonly chapterJson: string;
  readonly trace: PersistedTraceEnvelope;
  readonly traceJson: string;
  readonly chapterUsageJson: string;
  readonly traceUsageJson: string;
}

export class StoryStore {
  private readonly db: Database.Database;
  private readonly failureInjector: ((point: CommitFailurePoint) => void) | undefined;

  constructor(filename = ":memory:", options: StoryStoreOptions = {}) {
    const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
    if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
      throw new RangeError("busyTimeoutMs must be a non-negative safe integer");
    }

    this.db = new Database(filename, { timeout: busyTimeoutMs });
    this.failureInjector = options.failureInjector;

    this.db.pragma("foreign_keys = ON");
    this.db.pragma(`busy_timeout = ${busyTimeoutMs}`);
    // In-memory databases keep their memory journal. File databases switch to WAL.
    this.db.pragma("journal_mode = WAL");
    this.createSchema();
  }

  close(): void {
    if (this.db.open) {
      this.db.close();
    }
  }

  createWorld(input: unknown, setupInput?: unknown): WorldState {
    const validated = validateWorldState(input);
    if (!validated.ok) {
      throw new InvalidCommitError(`Invalid initial world: ${JSON.stringify(validated.issues)}`);
    }
    const state = validated.data;
    const stateJson = JSON.stringify(state);
    const setup = parseStorySetup(setupInput);

    this.db
      .transaction(() => {
        this.db
          .prepare<[string, number, number, string]>(
            `INSERT INTO worlds (id, world_version, chapter, state_json)
             VALUES (?, ?, ?, ?)`,
          )
          .run(state.id, state.version, state.chapter, stateJson);
        this.injectFailure("after-world-create");

        if (setup) {
          this.db
            .prepare<[string, number, string]>(
              `INSERT INTO story_setups (world_id, setup_version, setup_json)
               VALUES (?, ?, ?)`,
            )
            .run(state.id, 1, JSON.stringify(setup));
          this.injectFailure("after-story-setup-insert");
        }
      })
      .immediate();

    return state;
  }

  loadStorySetup(worldId: string): StorySetup | null {
    const row = this.db
      .prepare<[string], JsonRow>("SELECT setup_json AS json FROM story_setups WHERE world_id = ?")
      .get(worldId);

    return row ? StorySetupSchema.parse(parseJson(row.json)) : null;
  }

  loadWorldState(worldId: string): WorldState | null {
    const row = this.db
      .prepare<[string], JsonRow>("SELECT state_json AS json FROM worlds WHERE id = ?")
      .get(worldId);

    return row ? WorldStateSchema.parse(parseJson(row.json)) : null;
  }

  loadDelta(worldId: string, resultingWorldVersion: number): PersistedWorldDelta | null {
    const row = this.db
      .prepare<[string, number], JsonRow>(
        `SELECT delta_json AS json
           FROM world_deltas
          WHERE world_id = ? AND resulting_world_version = ?`,
      )
      .get(worldId, resultingWorldVersion);

    return row ? PersistedWorldDeltaSchema.parse(parseJson(row.json)) : null;
  }

  loadChapter(worldId: string, chapter: number): ChapterRecord | null {
    const row = this.db
      .prepare<[string, number], JsonRow>(
        "SELECT record_json AS json FROM chapters WHERE world_id = ? AND chapter = ?",
      )
      .get(worldId, chapter);

    return row ? ChapterRecordSchema.parse(parseJson(row.json)) : null;
  }

  loadChapters(worldId: string): ChapterRecord[] {
    const rows = this.db
      .prepare<[string], JsonRow>(
        "SELECT record_json AS json FROM chapters WHERE world_id = ? ORDER BY chapter",
      )
      .all(worldId);
    return rows.map((row) => ChapterRecordSchema.parse(parseJson(row.json)));
  }

  loadChapterByRequestId(worldId: string, requestId: string): ChapterRecord | null {
    const row = this.db
      .prepare<[string, string], JsonRow>(
        `SELECT record_json AS json
           FROM chapters
          WHERE world_id = ?
            AND json_extract(record_json, '$.requestId') = ?`,
      )
      .get(worldId, requestId);
    if (row) return ChapterRecordSchema.parse(parseJson(row.json));

    const archived = this.db
      .prepare<[string, string], ChapterNumberRow>(
        `SELECT chapter
           FROM chapter_revisions
          WHERE world_id = ?
            AND json_extract(chapter_json, '$.requestId') = ?
          ORDER BY revision DESC
          LIMIT 1`,
      )
      .get(worldId, requestId);
    return archived ? this.loadChapter(worldId, archived.chapter) : null;
  }

  loadTrace(traceId: string): PersistedTraceEnvelope | null {
    const row = this.db
      .prepare<[string], JsonRow>("SELECT trace_json AS json FROM traces WHERE trace_id = ?")
      .get(traceId);

    return row ? PersistedTraceEnvelopeSchema.parse(parseJson(row.json)) : null;
  }

  loadFailedTurnTraces(worldId: string): FailedTurnTrace[] {
    const rows = this.db
      .prepare<[string], JsonRow>(
        `SELECT trace_json AS json
           FROM failed_turn_traces
          WHERE world_id = ?
          ORDER BY rowid`,
      )
      .all(worldId);
    return rows.map((row) => FailedTurnTraceSchema.parse(parseJson(row.json)));
  }

  recordFailedTurn(input: FailedTurnTrace): void {
    const trace = FailedTurnTraceSchema.parse(input);
    const attemptCost = trace.attempts.reduce((sum, attempt) => sum + attempt.costUsd, 0);
    const attemptUsage = trace.attempts.reduce(
      (sum, attempt) => ({
        cacheWriteTokens: sum.cacheWriteTokens + attempt.usage.cacheWriteTokens,
        cachedInputTokens: sum.cachedInputTokens + attempt.usage.cachedInputTokens,
        inputTokens: sum.inputTokens + attempt.usage.inputTokens,
        outputTokens: sum.outputTokens + attempt.usage.outputTokens,
        reasoningTokens: sum.reasoningTokens + attempt.usage.reasoningTokens,
        totalTokens: sum.totalTokens + attempt.usage.totalTokens,
      }),
      {
        cacheWriteTokens: 0,
        cachedInputTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
      },
    );
    if (
      Math.abs(attemptCost - trace.totalEstimatedCostUsd) > 0.000_000_001 ||
      !isDeepStrictEqual(attemptUsage, trace.totalUsage)
    ) {
      throw new InvalidCommitError("Failed trace totals do not equal recorded runtime attempts");
    }
    this.db
      .prepare<[string, string, string, number, string]>(
        `INSERT INTO failed_turn_traces (
           run_id,
           world_id,
           request_id,
           attempted_chapter,
           trace_json
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        trace.runId,
        trace.fixtureId,
        trace.requestId,
        trace.attemptedChapter,
        JSON.stringify(trace),
      );
  }

  loadKnowledgeChanges(
    worldId: string,
    resultingWorldVersion: number,
  ): WorldDelta["knowledgeMutations"] {
    const rows = this.db
      .prepare<[string, number], KnowledgeJsonRow>(
        `SELECT change_json
           FROM knowledge_changes
          WHERE world_id = ? AND resulting_world_version = ?
          ORDER BY sequence`,
      )
      .all(worldId, resultingWorldVersion);

    return rows.map((row) => KnowledgeMutationSchema.parse(parseJson(row.change_json)));
  }

  loadUsage(worldId: string, chapter: number): StoredTurnUsage | null {
    const row = this.db
      .prepare<[string, number], UsageRow>(
        `SELECT chapter_usage_json,
                total_estimated_cost_usd,
                total_latency_ms,
                trace_usage_json
           FROM turn_usage
          WHERE world_id = ? AND chapter = ?`,
      )
      .get(worldId, chapter);

    if (!row) return null;

    return {
      chapterUsage: ChapterRecordSchema.shape.usage.parse(parseJson(row.chapter_usage_json)),
      totalEstimatedCostUsd: row.total_estimated_cost_usd,
      totalLatencyMs: row.total_latency_ms,
      traceUsage: TraceEnvelopeSchema.shape.totalUsage.parse(parseJson(row.trace_usage_json)),
    };
  }

  loadChapterRevisions(worldId: string, chapter: number): StoredChapterRevision[] {
    const rows = this.db
      .prepare<[string, number], ChapterRevisionRow>(
        `SELECT revision,
                archived_by_trace_id,
                chapter_json,
                trace_json,
                chapter_usage_json,
                trace_usage_json,
                total_estimated_cost_usd,
                total_latency_ms
           FROM chapter_revisions
          WHERE world_id = ? AND chapter = ?
          ORDER BY revision`,
      )
      .all(worldId, chapter);

    return rows.map((row) => ({
      archivedByTraceId: row.archived_by_trace_id,
      chapter: ChapterRecordSchema.parse(parseJson(row.chapter_json)),
      revision: row.revision,
      trace: PersistedTraceEnvelopeSchema.parse(parseJson(row.trace_json)),
      usage: {
        chapterUsage: ChapterRecordSchema.shape.usage.parse(parseJson(row.chapter_usage_json)),
        totalEstimatedCostUsd: row.total_estimated_cost_usd,
        totalLatencyMs: row.total_latency_ms,
        traceUsage: TraceEnvelopeSchema.shape.totalUsage.parse(parseJson(row.trace_usage_json)),
      },
    }));
  }

  /**
   * Commits already-produced model artifacts. No model call or async work belongs here.
   * Better-sqlite3 rolls every write back when any statement or injected hook throws.
   */
  commitTurn(input: CommitTurnInput): void {
    const prepared = prepareCommit(input);

    this.db
      .transaction(() => {
        const currentRow = this.db
          .prepare<[string], JsonRow>("SELECT state_json AS json FROM worlds WHERE id = ?")
          .get(prepared.state.id);
        if (!currentRow) {
          throw new StaleWorldVersionError(prepared.state.id, prepared.delta.expectedWorldVersion);
        }
        const currentState = WorldStateSchema.parse(parseJson(currentRow.json));
        if (currentState.version !== prepared.delta.expectedWorldVersion) {
          throw new StaleWorldVersionError(prepared.state.id, prepared.delta.expectedWorldVersion);
        }
        if (
          currentState.lockedPovId === null ||
          prepared.chapter.povCharacterId !== currentState.lockedPovId ||
          prepared.chapter.playerAction.actorId !== currentState.lockedPovId
        ) {
          throw new InvalidCommitError("Chapter viewpoint does not match locked canon");
        }
        if (prepared.chapter.playerAction.stateVersion !== currentState.version) {
          throw new InvalidCommitError("Player action version does not match stored canon");
        }
        const restaged = stageWorldDelta(currentState, prepared.trace.intents, prepared.delta);
        if (!restaged.ok) {
          throw new InvalidCommitError(`Delta cannot restage: ${JSON.stringify(restaged.issues)}`);
        }
        if (!isDeepStrictEqual(restaged.data.state, prepared.state)) {
          throw new InvalidCommitError("Post-turn state does not equal deterministic staged state");
        }
        if (prepared.trace.stateBeforeHash !== hashJson(currentState)) {
          throw new InvalidCommitError("Trace state-before hash does not match stored canon");
        }
        if (prepared.trace.stateAfterHash !== hashJson(prepared.state)) {
          throw new InvalidCommitError("Trace state-after hash does not match staged canon");
        }
        const narrativeStateIssues = validateNarrativeStateClaims(
          currentState,
          prepared.state,
          prepared.chapter.prose,
        );
        if (narrativeStateIssues.length > 0) {
          throw new InvalidCommitError(
            `Chapter prose contradicts staged canon: ${JSON.stringify(narrativeStateIssues)}`,
          );
        }

        const update = this.db
          .prepare<[string, number, number, string, number]>(
            `UPDATE worlds
                SET state_json = ?, world_version = ?, chapter = ?
              WHERE id = ? AND world_version = ?`,
          )
          .run(
            prepared.stateJson,
            prepared.state.version,
            prepared.state.chapter,
            prepared.state.id,
            prepared.delta.expectedWorldVersion,
          );

        if (update.changes !== 1) {
          throw new StaleWorldVersionError(prepared.state.id, prepared.delta.expectedWorldVersion);
        }
        this.injectFailure("after-world-update");

        this.db
          .prepare<[string, number, number, number, string]>(
            `INSERT INTO world_deltas (
               world_id,
               chapter,
               expected_world_version,
               resulting_world_version,
               delta_json
             ) VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            prepared.state.id,
            prepared.chapter.chapter,
            prepared.delta.expectedWorldVersion,
            prepared.state.version,
            prepared.deltaJson,
          );
        this.injectFailure("after-delta-insert");

        const insertKnowledge = this.db.prepare<[string, number, number, string, string, string]>(
          `INSERT INTO knowledge_changes (
             world_id,
             resulting_world_version,
             sequence,
             character_id,
             fact_id,
             change_json
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        );
        for (const change of prepared.knowledgeChanges) {
          insertKnowledge.run(
            prepared.state.id,
            prepared.state.version,
            change.sequence,
            change.characterId,
            change.factId,
            change.json,
          );
        }
        this.injectFailure("after-knowledge-changes");

        this.db
          .prepare<[string, number, number, number, string]>(
            `INSERT INTO chapters (
               world_id,
               chapter,
               state_before_version,
               state_after_version,
               record_json
             ) VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            prepared.state.id,
            prepared.chapter.chapter,
            prepared.chapter.stateBeforeVersion,
            prepared.chapter.stateAfterVersion,
            prepared.chapterJson,
          );
        this.injectFailure("after-chapter-insert");

        this.db
          .prepare<[string, string, number, string]>(
            `INSERT INTO traces (trace_id, world_id, chapter, trace_json)
             VALUES (?, ?, ?, ?)`,
          )
          .run(
            prepared.trace.runId,
            prepared.state.id,
            prepared.chapter.chapter,
            prepared.traceJson,
          );
        this.injectFailure("after-trace-insert");

        this.db
          .prepare<[string, number, string, string, string, number, number]>(
            `INSERT INTO turn_usage (
               world_id,
               chapter,
               trace_id,
               chapter_usage_json,
               trace_usage_json,
               total_estimated_cost_usd,
               total_latency_ms
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            prepared.state.id,
            prepared.chapter.chapter,
            prepared.trace.runId,
            prepared.chapterUsageJson,
            prepared.traceUsageJson,
            prepared.trace.totalEstimatedCostUsd,
            prepared.trace.totalLatencyMs,
          );
        this.injectFailure("after-usage-insert");
      })
      .immediate();
  }

  /**
   * Replaces only the latest chapter's narration evidence. Canon and world state stay immutable.
   * The prior chapter, trace, and usage are archived in the same transaction.
   */
  replaceLatestChapterNarration(input: ReplaceLatestChapterNarrationInput): ChapterRecord {
    const prepared = prepareNarrationReplacement(input);

    this.db
      .transaction(() => {
        const worldRow = this.db
          .prepare<[string], JsonRow>("SELECT state_json AS json FROM worlds WHERE id = ?")
          .get(input.worldId);
        if (!worldRow) {
          throw new StaleWorldVersionError(input.worldId, input.expectedWorldVersion);
        }
        const world = WorldStateSchema.parse(parseJson(worldRow.json));
        if (world.version !== input.expectedWorldVersion) {
          throw new StaleWorldVersionError(input.worldId, input.expectedWorldVersion);
        }
        if (world.chapter < 1 || prepared.chapter.chapter !== world.chapter) {
          throw new InvalidCommitError("Only the latest committed chapter can be rerolled");
        }

        const currentChapterRow = this.db
          .prepare<[string, number], JsonRow>(
            "SELECT record_json AS json FROM chapters WHERE world_id = ? AND chapter = ?",
          )
          .get(input.worldId, world.chapter);
        if (!currentChapterRow) {
          throw new InvalidCommitError("Latest world chapter record is missing");
        }
        const currentChapter = ChapterRecordSchema.parse(parseJson(currentChapterRow.json));
        if (
          currentChapter.traceId !== input.expectedPriorTraceId ||
          currentChapter.proseHash !== input.expectedPriorProseHash
        ) {
          throw new StaleChapterNarrationError(input.worldId, world.chapter);
        }

        const currentTraceRow = this.db
          .prepare<[string], JsonRow>("SELECT trace_json AS json FROM traces WHERE trace_id = ?")
          .get(currentChapter.traceId);
        if (!currentTraceRow) {
          throw new InvalidCommitError("Latest chapter trace is missing");
        }
        const currentTrace = PersistedTraceEnvelopeSchema.parse(parseJson(currentTraceRow.json));
        const currentDelta = this.loadDelta(input.worldId, world.version);
        if (!currentDelta || !isDeepStrictEqual(currentDelta, currentTrace.acceptedDelta)) {
          throw new InvalidCommitError("Latest chapter trace does not match stored world delta");
        }
        const currentUsageRow = this.db
          .prepare<[string, number], StoredUsageRow>(
            `SELECT trace_id,
                    chapter_usage_json,
                    trace_usage_json,
                    total_estimated_cost_usd,
                    total_latency_ms
               FROM turn_usage
              WHERE world_id = ? AND chapter = ?`,
          )
          .get(input.worldId, world.chapter);
        if (!currentUsageRow) {
          throw new InvalidCommitError("Latest chapter usage is missing");
        }

        assertStoredNarrationIntegrity(
          input.worldId,
          world,
          currentChapter,
          currentTrace,
          currentUsageRow,
        );
        assertNarrationReplacementPreservesCanon(
          currentChapter,
          currentTrace,
          prepared.chapter,
          prepared.trace,
        );
        validateReplacementDraft(world, prepared.chapter);
        if (prepared.trace.runId === currentTrace.runId) {
          throw new InvalidCommitError("Replacement trace ID must be new");
        }
        if (!prepared.chapter.requestId) {
          throw new InvalidCommitError("Replacement chapter requires a request ID");
        }
        if (this.loadChapterByRequestId(input.worldId, prepared.chapter.requestId)) {
          throw new InvalidCommitError("Replacement request ID was already used");
        }

        const priorTraceReuse = this.db
          .prepare<[string, string], ChapterNumberRow>(
            `SELECT chapter
               FROM chapter_revisions
              WHERE world_id = ? AND trace_id = ?
              LIMIT 1`,
          )
          .get(input.worldId, prepared.trace.runId);
        if (priorTraceReuse) {
          throw new InvalidCommitError("Replacement trace ID was already archived");
        }

        const revisionRow = this.db
          .prepare<[string, number], RevisionNumberRow>(
            `SELECT MAX(revision) AS revision
               FROM chapter_revisions
              WHERE world_id = ? AND chapter = ?`,
          )
          .get(input.worldId, world.chapter);
        const revision = (revisionRow?.revision ?? 0) + 1;

        this.db
          .prepare<
            [string, number, number, string, string, string, string, string, string, number, number]
          >(
            `INSERT INTO chapter_revisions (
               world_id,
               chapter,
               revision,
               trace_id,
               archived_by_trace_id,
               chapter_json,
               trace_json,
               chapter_usage_json,
               trace_usage_json,
               total_estimated_cost_usd,
               total_latency_ms
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            input.worldId,
            world.chapter,
            revision,
            currentTrace.runId,
            prepared.trace.runId,
            currentChapterRow.json,
            currentTraceRow.json,
            currentUsageRow.chapter_usage_json,
            currentUsageRow.trace_usage_json,
            currentUsageRow.total_estimated_cost_usd,
            currentUsageRow.total_latency_ms,
          );
        this.injectFailure("after-reroll-archive");

        this.db.prepare<[string]>("DELETE FROM traces WHERE trace_id = ?").run(currentTrace.runId);
        const chapterUpdate = this.db
          .prepare<[string, string, number]>(
            `UPDATE chapters
                SET record_json = ?
              WHERE world_id = ? AND chapter = ?`,
          )
          .run(prepared.chapterJson, input.worldId, world.chapter);
        if (chapterUpdate.changes !== 1) {
          throw new InvalidCommitError("Latest chapter disappeared during reroll");
        }
        this.injectFailure("after-reroll-chapter-update");

        this.db
          .prepare<[string, string, number, string]>(
            `INSERT INTO traces (trace_id, world_id, chapter, trace_json)
             VALUES (?, ?, ?, ?)`,
          )
          .run(prepared.trace.runId, input.worldId, world.chapter, prepared.traceJson);
        this.injectFailure("after-reroll-trace-insert");

        this.db
          .prepare<[string, number, string, string, string, number, number]>(
            `INSERT INTO turn_usage (
               world_id,
               chapter,
               trace_id,
               chapter_usage_json,
               trace_usage_json,
               total_estimated_cost_usd,
               total_latency_ms
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            input.worldId,
            world.chapter,
            prepared.trace.runId,
            prepared.chapterUsageJson,
            prepared.traceUsageJson,
            prepared.trace.totalEstimatedCostUsd,
            prepared.trace.totalLatencyMs,
          );
        this.injectFailure("after-reroll-usage-insert");

        const unchangedWorld = this.db
          .prepare<[string], JsonRow>("SELECT state_json AS json FROM worlds WHERE id = ?")
          .get(input.worldId);
        if (!unchangedWorld || unchangedWorld.json !== worldRow.json) {
          throw new InvalidCommitError("Reroll changed canonical world state");
        }
      })
      .immediate();

    return prepared.chapter;
  }

  private injectFailure(point: CommitFailurePoint): void {
    this.failureInjector?.(point);
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS worlds (
        id TEXT PRIMARY KEY,
        world_version INTEGER NOT NULL CHECK (world_version >= 1),
        chapter INTEGER NOT NULL CHECK (chapter BETWEEN 0 AND 350),
        state_json TEXT NOT NULL CHECK (json_valid(state_json))
      );

      CREATE TABLE IF NOT EXISTS story_setups (
        world_id TEXT PRIMARY KEY,
        setup_version INTEGER NOT NULL CHECK (setup_version = 1),
        setup_json TEXT NOT NULL CHECK (json_valid(setup_json)),
        FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS world_deltas (
        world_id TEXT NOT NULL,
        chapter INTEGER NOT NULL CHECK (chapter BETWEEN 1 AND 350),
        expected_world_version INTEGER NOT NULL CHECK (expected_world_version >= 1),
        resulting_world_version INTEGER NOT NULL CHECK (resulting_world_version >= 2),
        delta_json TEXT NOT NULL CHECK (json_valid(delta_json)),
        PRIMARY KEY (world_id, chapter),
        UNIQUE (world_id, expected_world_version),
        UNIQUE (world_id, resulting_world_version),
        FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS knowledge_changes (
        world_id TEXT NOT NULL,
        resulting_world_version INTEGER NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence >= 0),
        character_id TEXT NOT NULL,
        fact_id TEXT NOT NULL,
        change_json TEXT NOT NULL CHECK (json_valid(change_json)),
        PRIMARY KEY (world_id, resulting_world_version, sequence),
        FOREIGN KEY (world_id, resulting_world_version)
          REFERENCES world_deltas(world_id, resulting_world_version)
          ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS chapters (
        world_id TEXT NOT NULL,
        chapter INTEGER NOT NULL CHECK (chapter BETWEEN 1 AND 350),
        state_before_version INTEGER NOT NULL CHECK (state_before_version >= 1),
        state_after_version INTEGER NOT NULL CHECK (state_after_version >= 2),
        record_json TEXT NOT NULL CHECK (json_valid(record_json)),
        PRIMARY KEY (world_id, chapter),
        UNIQUE (world_id, state_after_version),
        FOREIGN KEY (world_id, chapter)
          REFERENCES world_deltas(world_id, chapter)
          ON DELETE RESTRICT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS chapters_world_request_id
        ON chapters(world_id, json_extract(record_json, '$.requestId'))
        WHERE json_extract(record_json, '$.requestId') IS NOT NULL;

      CREATE TABLE IF NOT EXISTS traces (
        trace_id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL,
        chapter INTEGER NOT NULL,
        trace_json TEXT NOT NULL CHECK (json_valid(trace_json)),
        UNIQUE (world_id, chapter),
        FOREIGN KEY (world_id, chapter)
          REFERENCES chapters(world_id, chapter)
          ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS turn_usage (
        world_id TEXT NOT NULL,
        chapter INTEGER NOT NULL,
        trace_id TEXT NOT NULL UNIQUE,
        chapter_usage_json TEXT NOT NULL CHECK (json_valid(chapter_usage_json)),
        trace_usage_json TEXT NOT NULL CHECK (json_valid(trace_usage_json)),
        total_estimated_cost_usd REAL NOT NULL CHECK (total_estimated_cost_usd >= 0),
        total_latency_ms INTEGER NOT NULL CHECK (total_latency_ms >= 0),
        PRIMARY KEY (world_id, chapter),
        FOREIGN KEY (world_id, chapter)
          REFERENCES chapters(world_id, chapter)
          ON DELETE CASCADE,
        FOREIGN KEY (trace_id) REFERENCES traces(trace_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS failed_turn_traces (
        run_id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        attempted_chapter INTEGER NOT NULL CHECK (attempted_chapter BETWEEN 1 AND 350),
        trace_json TEXT NOT NULL CHECK (json_valid(trace_json)),
        FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS failed_turn_traces_world_request
        ON failed_turn_traces(world_id, request_id);

      CREATE TABLE IF NOT EXISTS chapter_revisions (
        world_id TEXT NOT NULL,
        chapter INTEGER NOT NULL CHECK (chapter BETWEEN 1 AND 350),
        revision INTEGER NOT NULL CHECK (revision >= 1),
        trace_id TEXT NOT NULL,
        archived_by_trace_id TEXT NOT NULL,
        chapter_json TEXT NOT NULL CHECK (json_valid(chapter_json)),
        trace_json TEXT NOT NULL CHECK (json_valid(trace_json)),
        chapter_usage_json TEXT NOT NULL CHECK (json_valid(chapter_usage_json)),
        trace_usage_json TEXT NOT NULL CHECK (json_valid(trace_usage_json)),
        total_estimated_cost_usd REAL NOT NULL CHECK (total_estimated_cost_usd >= 0),
        total_latency_ms INTEGER NOT NULL CHECK (total_latency_ms >= 0),
        PRIMARY KEY (world_id, chapter, revision),
        UNIQUE (world_id, trace_id),
        FOREIGN KEY (world_id, chapter)
          REFERENCES chapters(world_id, chapter)
          ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS chapter_revisions_world_request
        ON chapter_revisions(world_id, json_extract(chapter_json, '$.requestId'))
        WHERE json_extract(chapter_json, '$.requestId') IS NOT NULL;
    `);
  }
}

function prepareNarrationReplacement(
  input: ReplaceLatestChapterNarrationInput,
): PreparedNarrationReplacement {
  if (!Number.isSafeInteger(input.expectedWorldVersion) || input.expectedWorldVersion < 1) {
    throw new InvalidCommitError("Expected world version must be a positive safe integer");
  }
  const chapter = ChapterRecordSchema.parse(input.chapter);
  const trace = PersistedTraceEnvelopeSchema.parse(input.trace);
  validateChapterTraceEvidence(chapter, trace);
  if (trace.fixtureId !== input.worldId) {
    throw new InvalidCommitError("Replacement trace world does not match requested world");
  }

  return {
    chapter,
    chapterJson: JSON.stringify(chapter),
    chapterUsageJson: JSON.stringify(chapter.usage),
    trace,
    traceJson: JSON.stringify(trace),
    traceUsageJson: JSON.stringify(trace.totalUsage),
  };
}

function assertStoredNarrationIntegrity(
  worldId: string,
  world: WorldState,
  chapter: ChapterRecord,
  trace: PersistedTraceEnvelope,
  usage: StoredUsageRow,
): void {
  validateChapterTraceEvidence(chapter, trace);
  if (
    chapter.chapter !== world.chapter ||
    chapter.stateAfterVersion !== world.version ||
    trace.fixtureId !== worldId ||
    trace.stateAfterHash !== hashJson(world)
  ) {
    throw new InvalidCommitError("Stored latest chapter does not match canonical world");
  }
  const deltaRow = trace.acceptedDelta;
  if (
    deltaRow.clock.toChapter !== chapter.chapter ||
    deltaRow.expectedWorldVersion !== chapter.stateBeforeVersion
  ) {
    throw new InvalidCommitError("Stored latest chapter does not match its accepted delta");
  }
  const currentProseHash = createHash("sha256").update(chapter.prose).digest("hex");
  if (
    chapter.proseHash !== currentProseHash ||
    chapter.narrativeAudit.proseHash !== currentProseHash
  ) {
    throw new InvalidCommitError("Stored latest chapter prose hash is invalid");
  }
  if (
    usage.trace_id !== trace.runId ||
    !isDeepStrictEqual(parseJson(usage.chapter_usage_json), chapter.usage) ||
    !isDeepStrictEqual(parseJson(usage.trace_usage_json), trace.totalUsage) ||
    usage.total_estimated_cost_usd !== trace.totalEstimatedCostUsd ||
    usage.total_latency_ms !== trace.totalLatencyMs
  ) {
    throw new InvalidCommitError("Stored latest chapter usage is inconsistent");
  }
}

function assertNarrationReplacementPreservesCanon(
  currentChapter: ChapterRecord,
  currentTrace: PersistedTraceEnvelope,
  replacementChapter: ChapterRecord,
  replacementTrace: PersistedTraceEnvelope,
): void {
  if (!isDeepStrictEqual(chapterCanon(currentChapter), chapterCanon(replacementChapter))) {
    throw new InvalidCommitError("Reroll cannot change chapter canon");
  }
  if (!isDeepStrictEqual(traceCanon(currentTrace), traceCanon(replacementTrace))) {
    throw new InvalidCommitError("Reroll cannot change trace canon");
  }
}

function chapterCanon(chapter: ChapterRecord): unknown {
  return {
    chapter: chapter.chapter,
    choices: chapter.choices,
    id: chapter.id,
    playerAction: chapter.playerAction,
    povCharacterId: chapter.povCharacterId,
    safeContextHash: chapter.safeContextHash,
    stateAfterVersion: chapter.stateAfterVersion,
    stateBeforeVersion: chapter.stateBeforeVersion,
    terminal: chapter.terminal,
    title: chapter.title,
  };
}

function traceCanon(trace: PersistedTraceEnvelope): unknown {
  return {
    acceptedDelta: trace.acceptedDelta,
    contractVersion: trace.contractVersion,
    fixtureId: trace.fixtureId,
    fixtureVersion: trace.fixtureVersion,
    intents: trace.intents,
    promptVersion: trace.promptVersion,
    schemaVersion: trace.schemaVersion,
    stateAfterHash: trace.stateAfterHash,
    stateBeforeHash: trace.stateBeforeHash,
  };
}

function validateReplacementDraft(world: WorldState, chapter: ChapterRecord): void {
  const proseHash = createHash("sha256").update(chapter.prose).digest("hex");
  if (chapter.proseHash !== proseHash || chapter.narrativeAudit.proseHash !== proseHash) {
    throw new InvalidCommitError("Replacement prose hash does not match its approved audit");
  }
  const draftValidation = validateChapterDraft(world, {
    choices: chapter.choices,
    contractVersion: world.contractVersion,
    prose: chapter.prose,
    terminal: chapter.terminal,
    title: chapter.title,
  });
  if (!draftValidation.ok) {
    throw new InvalidCommitError(
      `Replacement chapter draft is invalid: ${JSON.stringify(draftValidation.issues)}`,
    );
  }
}

function validateChapterTraceEvidence(chapter: ChapterRecord, trace: PersistedTraceEnvelope): void {
  if (trace.runId !== chapter.traceId) {
    throw new InvalidCommitError("Chapter trace ID does not match trace run ID");
  }
  if (
    chapter.estimatedCostUsd !== trace.totalEstimatedCostUsd ||
    !isDeepStrictEqual(chapter.usage, trace.totalUsage)
  ) {
    throw new InvalidCommitError("Chapter usage or cost does not match trace totals");
  }
  if (trace.attempts.length > 0) {
    const attemptCost = trace.attempts.reduce((sum, attempt) => sum + attempt.costUsd, 0);
    const attemptUsage = sumAttemptUsage(trace);
    if (
      Math.abs(attemptCost - trace.totalEstimatedCostUsd) > 0.000_000_001 ||
      !isDeepStrictEqual(attemptUsage, trace.totalUsage)
    ) {
      throw new InvalidCommitError("Trace totals do not equal recorded runtime attempts");
    }
  }
  const playerIntent = trace.intents.find(({ id }) => id.startsWith("intent-player-"));
  if (
    !playerIntent ||
    playerIntent.actorId !== chapter.playerAction.actorId ||
    playerIntent.stateVersion !== chapter.playerAction.stateVersion ||
    !isDeepStrictEqual(playerIntent.action, chapter.playerAction.action)
  ) {
    throw new InvalidCommitError("Chapter player action does not match trace intent");
  }
  if (trace.gateResult !== "passed") {
    throw new InvalidCommitError("Failed trace cannot commit");
  }
  for (const requiredPhase of ["narration", "audit"] as const) {
    if (!trace.calls.some(({ phase }) => phase === requiredPhase)) {
      throw new InvalidCommitError(`Trace lacks required ${requiredPhase} call`);
    }
  }
}

function sumAttemptUsage(trace: PersistedTraceEnvelope): TraceEnvelope["totalUsage"] {
  return trace.attempts.reduce(
    (sum, attempt) => ({
      cacheWriteTokens: sum.cacheWriteTokens + attempt.usage.cacheWriteTokens,
      cachedInputTokens: sum.cachedInputTokens + attempt.usage.cachedInputTokens,
      inputTokens: sum.inputTokens + attempt.usage.inputTokens,
      outputTokens: sum.outputTokens + attempt.usage.outputTokens,
      reasoningTokens: sum.reasoningTokens + attempt.usage.reasoningTokens,
      totalTokens: sum.totalTokens + attempt.usage.totalTokens,
    }),
    {
      cacheWriteTokens: 0,
      cachedInputTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
    },
  );
}

function prepareCommit(input: CommitTurnInput): PreparedCommit {
  // Parse and serialize before opening write transaction. Model output is untrusted input.
  const state = WorldStateSchema.parse(input.state);
  const delta = WorldDeltaSchema.parse(input.delta);
  const chapter = ChapterRecordSchema.parse(input.chapter);
  const trace = TraceEnvelopeSchema.parse(input.trace);

  if (state.version !== delta.expectedWorldVersion + 1) {
    throw new InvalidCommitError("Post-turn world version must increment exactly once");
  }
  if (
    chapter.stateBeforeVersion !== delta.expectedWorldVersion ||
    chapter.stateAfterVersion !== state.version
  ) {
    throw new InvalidCommitError("Chapter versions do not match world delta versions");
  }
  if (state.chapter !== delta.clock.toChapter || chapter.chapter !== state.chapter) {
    throw new InvalidCommitError("World, delta, and chapter numbers do not match");
  }
  validateChapterTraceEvidence(chapter, trace);
  if (!isDeepStrictEqual(trace.acceptedDelta, delta)) {
    throw new InvalidCommitError("Trace accepted delta does not match committed delta");
  }
  if (state.terminal !== chapter.terminal) {
    throw new InvalidCommitError("Chapter terminal flag does not match staged world");
  }
  const proseHash = createHash("sha256").update(chapter.prose).digest("hex");
  if (chapter.proseHash !== proseHash || chapter.narrativeAudit.proseHash !== proseHash) {
    throw new InvalidCommitError("Chapter prose hash does not match its approved audit");
  }
  const draftValidation = validateChapterDraft(state, {
    choices: chapter.choices,
    contractVersion: state.contractVersion,
    prose: chapter.prose,
    terminal: chapter.terminal,
    title: chapter.title,
  });
  if (!draftValidation.ok) {
    throw new InvalidCommitError(
      `Chapter draft is invalid: ${JSON.stringify(draftValidation.issues)}`,
    );
  }
  return {
    chapter,
    chapterJson: JSON.stringify(chapter),
    chapterUsageJson: JSON.stringify(chapter.usage),
    delta,
    deltaJson: JSON.stringify(delta),
    knowledgeChanges: delta.knowledgeMutations.map((change, sequence) => ({
      characterId: change.characterId,
      factId: change.type === "discover_fact" ? change.fact.id : change.factId,
      json: JSON.stringify(change),
      sequence,
    })),
    state,
    stateJson: JSON.stringify(state),
    trace,
    traceJson: JSON.stringify(trace),
    traceUsageJson: JSON.stringify(trace.totalUsage),
  };
}

function parseJson(json: string): unknown {
  return JSON.parse(json) as unknown;
}

function parseStorySetup(input: unknown): StorySetup | null {
  if (input === undefined) return null;
  const result = StorySetupSchema.safeParse(input);
  if (!result.success) {
    throw new InvalidCommitError(`Invalid story setup: ${JSON.stringify(result.error.issues)}`);
  }
  return result.data;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
