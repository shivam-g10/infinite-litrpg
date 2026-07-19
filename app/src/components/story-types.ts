export interface StoryChoice {
  readonly id: string;
  readonly description: string;
}

export interface ResourcePool {
  readonly current: number;
  readonly maximum: number;
}

export interface SkillView {
  readonly id: string;
  readonly name: string;
  readonly rank: number;
}

export interface InventoryView {
  readonly id: string;
  readonly name: string;
  readonly quantity: number;
  readonly equipped: boolean;
}

export interface RelationshipView {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly score: number;
}

export interface PovView {
  readonly id: string;
  readonly name: string;
  readonly publicRole: string;
  readonly characterClass: string;
  readonly level: number;
  readonly experience: number;
  readonly experienceToNextLevel: number;
  readonly health: ResourcePool;
  readonly mana: ResourcePool;
  readonly location: string;
  readonly status: string;
  readonly stats: Readonly<Record<string, number>>;
  readonly skills: readonly SkillView[];
  readonly inventory: readonly InventoryView[];
  readonly goals: readonly string[];
  readonly beliefs: readonly string[];
  readonly conditions: readonly string[];
  readonly relationships: readonly RelationshipView[];
}

export interface CalendarView {
  readonly day: number;
  readonly label: string;
}

export interface WorldView {
  readonly id: string;
  readonly version: number;
  readonly chapter: number;
  readonly act: number;
  readonly terminal: boolean;
  readonly terminalReason: string | null;
  readonly threat: string;
  readonly calendar: CalendarView;
}

export interface ChapterView {
  readonly title: string;
  readonly prose: string;
  readonly choices: readonly StoryChoice[];
}

export interface VisibleEventView {
  readonly id: string;
  readonly summary: string;
  readonly location: string;
}

export interface UsageView {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly cachedInputTokens: number;
  readonly totalTokens: number;
}

export interface IntentView {
  readonly id: string;
  readonly actorId: string;
  readonly actorName: string;
  readonly goal: string;
  readonly expectedEffect: string;
  readonly phase: string;
  readonly accepted: boolean;
}

export interface RejectedIntentView {
  readonly id: string;
  readonly code: string;
  readonly reason: string;
}

export interface GodModeView {
  readonly intents: readonly IntentView[];
  readonly rejected: readonly RejectedIntentView[];
  readonly delta: unknown;
  readonly calls: readonly unknown[];
  readonly audit: unknown;
  readonly stateBeforeHash: string;
  readonly stateAfterHash: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly gateResult: string;
}

export interface StoryView {
  readonly world: WorldView;
  readonly pov: PovView;
  readonly chapter: ChapterView | null;
  readonly visibleEvents: readonly VisibleEventView[];
  readonly progress: number;
  readonly usage: UsageView;
  readonly estimatedCostUsd: number;
  readonly latencyMs: number;
  readonly adapterMode: string;
  readonly godMode: GodModeView;
}

const EMPTY_USAGE: UsageView = {
  cachedInputTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordAt(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  return isRecord(value) ? value : {};
}

function stringAt(record: Record<string, unknown>, ...keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return "";
}

function numberAt(record: Record<string, unknown>, ...keys: readonly string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function booleanAt(record: Record<string, unknown>, ...keys: readonly string[]): boolean {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
  }
  return false;
}

function stringsAt(record: Record<string, unknown>, key: string): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function recordsAt(
  record: Record<string, unknown>,
  key: string,
): readonly Record<string, unknown>[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

function namedValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  return isRecord(value) ? stringAt(value, "name", "label", "id") || fallback : fallback;
}

function normalizePool(value: unknown): ResourcePool {
  if (!isRecord(value)) return { current: 0, maximum: 0 };
  return {
    current: numberAt(value, "current", "value"),
    maximum: numberAt(value, "maximum", "max"),
  };
}

function normalizePov(source: Record<string, unknown>): PovView {
  const statsRecord = recordAt(source, "stats");
  const stats: Record<string, number> = {};
  for (const [key, value] of Object.entries(statsRecord)) {
    if (typeof value === "number" && Number.isFinite(value)) stats[key] = value;
  }

  return {
    beliefs: stringsAt(source, "beliefs"),
    characterClass:
      stringAt(source, "characterClass", "characterClassName", "className") ||
      namedValue(source.class, "Unknown"),
    conditions: stringsAt(source, "conditions"),
    experience: numberAt(source, "experience", "xp"),
    experienceToNextLevel: numberAt(
      source,
      "experienceToNextLevel",
      "nextLevelExperience",
      "xpToNextLevel",
    ),
    goals: stringsAt(source, "goals"),
    health: normalizePool(source.health),
    id: stringAt(source, "id", "characterId"),
    inventory: recordsAt(source, "inventory").map((item) => ({
      equipped: booleanAt(item, "equipped"),
      id: stringAt(item, "id", "itemId"),
      name: stringAt(item, "name") || stringAt(item, "itemId"),
      quantity: numberAt(item, "quantity"),
    })),
    level: numberAt(source, "level"),
    location: stringAt(source, "location", "locationName") || namedValue(source.location),
    mana: normalizePool(source.mana),
    name: stringAt(source, "name"),
    publicRole: stringAt(source, "publicRole", "role"),
    relationships: recordsAt(source, "relationships").map((relationship) => ({
      id: stringAt(relationship, "id", "characterId"),
      label: stringAt(relationship, "label"),
      name: stringAt(relationship, "name") || stringAt(relationship, "characterId"),
      score: numberAt(relationship, "score"),
    })),
    skills: recordsAt(source, "skills").map((skill) => ({
      id: stringAt(skill, "id"),
      name: stringAt(skill, "name") || stringAt(skill, "id"),
      rank: numberAt(skill, "rank"),
    })),
    stats,
    status: stringAt(source, "status") || "alive",
  };
}

function normalizeIntents(source: Record<string, unknown>): readonly IntentView[] {
  const acceptedIds = new Set(
    recordsAt(source, "acceptedIntentIds").map((intent) => stringAt(intent, "id")),
  );
  const explicitAcceptedIds = source.acceptedIntentIds;
  if (Array.isArray(explicitAcceptedIds)) {
    for (const id of explicitAcceptedIds) {
      if (typeof id === "string") acceptedIds.add(id);
    }
  }

  return recordsAt(source, "intents").map((intent) => {
    const id = stringAt(intent, "id");
    const status = stringAt(intent, "status");
    return {
      accepted: booleanAt(intent, "accepted") || status === "accepted" || acceptedIds.has(id),
      actorId: stringAt(intent, "actorId"),
      actorName: stringAt(intent, "actorName") || stringAt(intent, "actorId"),
      expectedEffect: stringAt(intent, "expectedEffect", "description"),
      goal: stringAt(intent, "goal"),
      id,
      phase: stringAt(intent, "phase") || "Resolution",
    };
  });
}

function normalizeGodMode(source: Record<string, unknown>): GodModeView {
  const delta = source.delta ?? source.acceptedDelta ?? null;
  const deltaRecord = isRecord(delta) ? delta : {};
  const intentsSource = recordsAt(source, "intents").length > 0 ? source : deltaRecord;
  const rejectedSource = recordsAt(source, "rejected").length > 0 ? source : deltaRecord;

  return {
    audit: source.audit ?? source.narrativeAudit ?? null,
    calls: recordsAt(source, "calls"),
    delta,
    gateResult: stringAt(source, "gateResult"),
    intents: normalizeIntents(intentsSource),
    promptVersion: stringAt(source, "promptVersion"),
    rejected: recordsAt(rejectedSource, "rejected").map((item) => ({
      code: stringAt(item, "code"),
      id: stringAt(item, "id", "intentId"),
      reason: stringAt(item, "reason"),
    })),
    schemaVersion: stringAt(source, "schemaVersion"),
    stateAfterHash: stringAt(source, "stateAfterHash"),
    stateBeforeHash: stringAt(source, "stateBeforeHash"),
  };
}

function unwrapStory(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return Object.prototype.hasOwnProperty.call(value, "story") ? value.story : value;
}

export function normalizeStoryPayload(payload: unknown): StoryView | null {
  const unwrapped = unwrapStory(payload);
  if (unwrapped === null) return null;
  if (!isRecord(unwrapped)) throw new Error("Story response was not an object.");

  const worldSource = recordAt(unwrapped, "world");
  const world = Object.keys(worldSource).length > 0 ? worldSource : unwrapped;
  const povSource = recordAt(unwrapped, "pov");
  const chapterSource = recordAt(unwrapped, "chapter");
  const chapterCandidate =
    Object.keys(chapterSource).length > 0 ? chapterSource : recordAt(unwrapped, "latestChapter");
  const calendarSource = recordAt(world, "calendar");
  const usageSource = recordAt(unwrapped, "usage");
  const godModeSource = recordAt(unwrapped, "godMode");

  const worldId = stringAt(world, "id", "worldId");
  const pov = normalizePov(povSource);
  if (!worldId || !pov.id || !pov.name) {
    throw new Error("Story response is missing world or viewpoint data.");
  }

  const chapterTitle = stringAt(chapterCandidate, "title");
  const chapterProse = stringAt(chapterCandidate, "prose");
  const chapter =
    chapterTitle || chapterProse || recordsAt(chapterCandidate, "choices").length > 0
      ? {
          choices: recordsAt(chapterCandidate, "choices").map((choice) => ({
            description: stringAt(choice, "description", "label"),
            id: stringAt(choice, "id"),
          })),
          prose: chapterProse,
          title: chapterTitle,
        }
      : null;

  const chapterNumber = numberAt(world, "chapter", "chapterNumber");
  const totalTokens = numberAt(usageSource, "totalTokens");

  return {
    adapterMode: stringAt(unwrapped, "adapterMode") || "sequential",
    chapter,
    estimatedCostUsd: numberAt(unwrapped, "estimatedCostUsd", "costUsd"),
    godMode: normalizeGodMode(godModeSource),
    latencyMs: numberAt(unwrapped, "latencyMs"),
    pov,
    progress: numberAt(unwrapped, "progress") || Math.min(1, Math.max(0, chapterNumber / 350)),
    usage: {
      ...EMPTY_USAGE,
      cachedInputTokens: numberAt(usageSource, "cachedInputTokens"),
      inputTokens: numberAt(usageSource, "inputTokens"),
      outputTokens: numberAt(usageSource, "outputTokens"),
      reasoningTokens: numberAt(usageSource, "reasoningTokens"),
      totalTokens:
        totalTokens || numberAt(usageSource, "inputTokens") + numberAt(usageSource, "outputTokens"),
    },
    visibleEvents: recordsAt(unwrapped, "visibleEvents").map((event) => ({
      id: stringAt(event, "id"),
      location: stringAt(event, "location", "locationName", "locationId"),
      summary: stringAt(event, "summary", "description"),
    })),
    world: {
      act: numberAt(world, "act"),
      calendar: {
        day: numberAt(calendarSource, "day"),
        label: stringAt(calendarSource, "label"),
      },
      chapter: chapterNumber,
      id: worldId,
      terminal: booleanAt(world, "terminal"),
      terminalReason: stringAt(world, "terminalReason") || null,
      threat: stringAt(world, "threat"),
      version: numberAt(world, "version", "worldVersion"),
    },
  };
}

export function errorMessageFromPayload(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;
  return stringAt(payload, "error", "message") || fallback;
}
