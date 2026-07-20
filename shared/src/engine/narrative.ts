import {
  type ChapterDraft,
  ChapterDraftCandidateSchema,
  ChapterDraftSchema,
  type ChapterFrame,
  type ChapterFrameCandidate,
  ChapterFrameCandidateSchema,
  ChapterFrameModelCandidateSchema,
  ChapterFrameSchema,
  type Choice,
  ChoiceSchema,
  type IntentAction,
  type WorldState,
} from "../contracts";
import { getClockPolicy } from "./clock";
import { buildPovContext } from "./knowledge";
import { resolveTurn } from "./resolver";
import type { ValidationIssue, ValidationResult } from "./validation";

export function decodeChapterFrameModelCandidate(input: unknown): ChapterFrameCandidate {
  const candidate = ChapterFrameModelCandidateSchema.parse(input);
  return ChapterFrameCandidateSchema.parse({
    optionIds: candidate.o,
    title: candidate.t,
  });
}

export function validateSuggestedChoices(
  state: WorldState,
  input: unknown,
): ValidationResult<readonly [Choice, Choice]> {
  const parsed = ChoiceSchema.array().length(2).safeParse(input);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((entry) => ({
        code: "INVALID_SCHEMA",
        message: entry.message,
        path: entry.path.map(String).join("."),
      })),
      ok: false,
    };
  }
  const [first, second] = parsed.data;
  if (!first || !second) {
    return failure("INVALID_SCHEMA", "Exactly two choices are required", "choices");
  }
  if (first.id === second.id) {
    return failure("INVALID_SCHEMA", "Suggested choice IDs must be distinct", "choices");
  }
  if (
    JSON.stringify({ action: first.action, milestoneId: first.milestoneId }) ===
    JSON.stringify({ action: second.action, milestoneId: second.milestoneId })
  ) {
    return failure("CHOICES_NOT_DISTINCT", "Suggested choices must change the attempt", "choices");
  }

  const issues: ValidationIssue[] = [];
  for (const choice of parsed.data) {
    const result = resolveTurn(
      state,
      {
        action: choice.action,
        actorId: state.lockedPovId,
        description: choice.description,
        milestoneId: choice.milestoneId,
        source: "suggested",
        stateVersion: state.version,
      },
      [],
    );
    if (!result.ok) {
      issues.push(...result.issues);
    }
  }

  return issues.length > 0 ? { issues, ok: false } : { data: [first, second] as const, ok: true };
}

export interface ChapterChoiceOption {
  readonly action: IntentAction;
  readonly description: string;
  readonly id: string;
  readonly milestoneId: string | null;
}

export function buildChapterChoiceOptions(state: WorldState): readonly ChapterChoiceOption[] {
  if (state.lockedPovId === null || state.terminal) return [];
  const actor = state.characters.find(({ id }) => id === state.lockedPovId);
  if (!actor) return [];
  const location = state.locations.find(({ id }) => id === actor.locationId);
  const factionName = state.factions.find(({ id }) => id === actor.factionId)?.name;
  const policy = getClockPolicy(state.chapter);
  const milestone = policy.choicesRequireMilestone
    ? state.arcClock.milestones.find(({ act }) => act === policy.currentAct)
    : undefined;
  const candidates: Omit<Choice, "id">[] = [];
  const add = (action: IntentAction, description: string, milestoneId: string | null) => {
    candidates.push({ action, description: boundedDescription(description), milestoneId });
  };

  if (milestone) {
    const milestoneId = milestone.id;
    if (milestone.compatibleActionTypes.includes("investigate")) {
      add(
        { subjectId: milestoneId, type: "investigate" },
        "Investigate the urgent danger that cannot be left unresolved.",
        milestoneId,
      );
    }
    if (milestone.compatibleActionTypes.includes("interact")) {
      add(
        {
          approach: "Confront the act milestone directly.",
          targetId: milestoneId,
          type: "interact",
        },
        "Confront the urgent choice that cannot be left unresolved.",
        milestoneId,
      );
    }
    if (milestone.compatibleActionTypes.includes("defend")) {
      add(
        { targetId: milestoneId, type: "defend" },
        "Defend what matters against the unresolved danger.",
        milestoneId,
      );
    }
    if (milestone.compatibleActionTypes.includes("use_skill")) {
      for (const skill of actor.skills.filter((candidate) => skillIsUsable(actor, candidate))) {
        add(
          { skillId: skill.id, targetId: milestoneId, type: "use_skill" },
          `Use ${skill.name} against the act milestone.`,
          milestoneId,
        );
      }
    }
    if (milestone.compatibleActionTypes.includes("use_item")) {
      for (const item of actor.inventory.filter(({ quantity }) => quantity > 0)) {
        add(
          { itemId: item.itemId, quantity: 1, targetId: milestoneId, type: "use_item" },
          `Use ${item.name} against the act milestone.`,
          milestoneId,
        );
      }
    }
  } else {
    for (const destinationId of location?.adjacentLocationIds ?? []) {
      const destination = state.locations.find(({ id }) => id === destinationId);
      add(
        { destinationId, type: "move" },
        `Travel toward ${destination?.name ?? destinationId}.`,
        null,
      );
    }
    add(
      { subjectId: actor.locationId, type: "investigate" },
      `Investigate the immediate signs around ${location?.name ?? actor.locationId}.`,
      null,
    );
    for (const target of state.characters.filter(
      ({ id, locationId }) => id !== actor.id && locationId === actor.locationId,
    )) {
      add(
        { approach: "Ask for a direct account.", targetId: target.id, type: "interact" },
        `Ask ${target.name} what they know now.`,
        null,
      );
    }
    add(
      { targetId: actor.locationId, type: "defend" },
      `Defend ${location?.name ?? actor.locationId} and watch for danger.`,
      null,
    );
    add(
      { factionId: actor.factionId, locationId: actor.locationId, type: "rally" },
      `Rally ${factionName ?? actor.factionId} at ${location?.name ?? actor.locationId}.`,
      null,
    );
    for (const skill of actor.skills.filter((candidate) => skillIsUsable(actor, candidate))) {
      add(
        { skillId: skill.id, targetId: null, type: "use_skill" },
        `Use ${skill.name} to read the immediate situation.`,
        null,
      );
    }
    for (const item of actor.inventory.filter(({ quantity }) => quantity > 0)) {
      add(
        { itemId: item.itemId, quantity: 1, targetId: null, type: "use_item" },
        `Use ${item.name} for the next attempt.`,
        null,
      );
    }
    add({ type: "wait" }, "Wait, observe, and preserve the initiative.", null);
  }

  const seen = new Set<string>();
  const valid: ChapterChoiceOption[] = [];
  for (const candidate of candidates) {
    const signature = JSON.stringify({
      action: candidate.action,
      milestoneId: candidate.milestoneId,
    });
    if (seen.has(signature)) continue;
    const resolved = resolveTurn(
      state,
      {
        ...candidate,
        actorId: actor.id,
        source: "suggested",
        stateVersion: state.version,
      },
      [],
    );
    if (!resolved.ok) continue;
    seen.add(signature);
    valid.push({ ...candidate, id: `option-${valid.length + 1}` });
  }
  return valid;
}

export function canonicalizeChapterFrameCandidate(
  state: WorldState,
  candidate: ChapterFrameCandidate,
): ValidationResult<ChapterFrame> {
  if (state.lockedPovId === null) {
    return failure("POV_NOT_LOCKED", "Chapter frame requires a locked viewpoint", "lockedPovId");
  }
  if (state.terminal) {
    return validateChapterFrameSafety(state, {
      choices: [],
      terminal: true,
      title: candidate.title,
    });
  }
  const options = buildChapterChoiceOptions(state);
  if (options.length < 2) {
    return failure(
      "INVALID_SCHEMA",
      "Canonical chapter frame needs two legal choice options",
      "choices",
    );
  }
  const byId = new Map(options.map((option) => [option.id, option]));
  const selected: ChapterChoiceOption[] = [];
  for (const optionId of candidate.optionIds) {
    const option = byId.get(optionId);
    if (option && !selected.some(({ id }) => id === option.id)) selected.push(option);
  }
  for (const option of options) {
    if (selected.length >= 2) break;
    if (!selected.some(({ id }) => id === option.id)) selected.push(option);
  }
  const choices = selected.slice(0, 2).map(({ action, description, milestoneId }, index) => ({
    action,
    description,
    id: index === 0 ? ("choice-1" as const) : ("choice-2" as const),
    milestoneId,
  }));
  return validateChapterFrameSafety(state, {
    choices,
    terminal: false,
    title: candidate.title,
  });
}

function skillIsUsable(
  actor: WorldState["characters"][number],
  skill: WorldState["characters"][number]["skills"][number],
): boolean {
  return (
    actor.level >= skill.minimumLevel &&
    actor.mana.current >= skill.manaCost &&
    actor.characterClassId === skill.requiredClassId &&
    skill.prerequisiteSkillIds.every((id) => actor.skills.some((known) => known.id === id))
  );
}

function boundedDescription(value: string): string {
  return value.length <= 240 ? value : `${value.slice(0, 237)}...`;
}

export function validateChapterDraft(
  prospectiveState: WorldState,
  input: unknown,
): ValidationResult<ChapterDraft> {
  const candidate = ChapterDraftCandidateSchema.safeParse(input);
  if (!candidate.success) {
    return {
      issues: candidate.error.issues.map((entry) => ({
        code: "INVALID_SCHEMA",
        message: entry.message,
        path: entry.path.map(String).join("."),
      })),
      ok: false,
    };
  }
  const issues: ValidationIssue[] = [];
  const parsed = ChapterDraftSchema.safeParse(candidate.data);
  if (!parsed.success) {
    issues.push(
      ...parsed.error.issues.map((entry) => ({
        code: "INVALID_SCHEMA" as const,
        message: entry.message,
        path: entry.path.map(String).join("."),
      })),
    );
  }
  if (prospectiveState.lockedPovId === null) {
    issues.push({
      code: "POV_NOT_LOCKED",
      message: "Narration requires a locked viewpoint",
      path: "lockedPovId",
    });
    return { issues, ok: false };
  }
  if (candidate.data.terminal !== prospectiveState.terminal) {
    issues.push({
      code: "STORY_TERMINAL",
      message: "Draft terminal flag disagrees with prospective canon",
      path: "terminal",
    });
  }
  if (!prospectiveState.terminal) {
    const choices = validateSuggestedChoices(prospectiveState, candidate.data.choices);
    if (!choices.ok) {
      issues.push(...choices.issues);
    }
  }

  const leakedFacts = hiddenFactsInText(
    prospectiveState,
    prospectiveState.lockedPovId,
    [
      candidate.data.title,
      candidate.data.prose,
      ...candidate.data.choices.map(({ description }) => description),
    ].join("\n"),
  );
  if (leakedFacts.length > 0) {
    issues.push(
      ...leakedFacts.map((fact) => ({
        code: "POV_LEAK" as const,
        message: `Draft exposes forbidden fact ${fact.id}`,
        path: "prose",
      })),
    );
  }

  return issues.length > 0 ? { issues, ok: false } : { data: candidate.data, ok: true };
}

export function validateNarrativeStateClaims(
  beforeState: WorldState,
  prospectiveState: WorldState,
  prose: string,
): readonly ValidationIssue[] {
  const povId = prospectiveState.lockedPovId;
  if (povId === null || beforeState.lockedPovId !== povId) return [];
  const beforePov = beforeState.characters.find(({ id }) => id === povId);
  const afterPov = prospectiveState.characters.find(({ id }) => id === povId);
  if (!beforePov || !afterPov) return [];

  const issues: ValidationIssue[] = [];
  for (const resource of ["health", "mana"] as const) {
    const allowed = new Set([
      `${beforePov[resource].current}/${beforePov[resource].maximum}`,
      `${afterPov[resource].current}/${afterPov[resource].maximum}`,
    ]);
    for (const [current, maximum] of resourceSnapshotsInText(prose, resource)) {
      if (allowed.has(`${current}/${maximum}`)) continue;
      issues.push({
        code: "INVALID_SCHEMA",
        message: `Narration gives ${resource} as ${current}/${maximum}, but canon permits ${[...allowed].join(" or ")}`,
        path: "prose",
      });
      break;
    }
  }

  const locationNames = prospectiveState.locations.map(({ name }) => name);
  for (const location of prospectiveState.locations) {
    if (location.id === afterPov.locationId) continue;
    if (
      claimsArrivalAtLocation(
        prose,
        location.name,
        locationNames.filter((name) => name !== location.name),
      )
    ) {
      issues.push({
        code: "INVALID_SCHEMA",
        message: `Narration claims arrival at ${location.name}, but committed POV location is ${afterPov.locationId}`,
        path: "prose",
      });
    } else if (
      beforePov.locationId !== afterPov.locationId &&
      location.id === beforePov.locationId &&
      treatsDepartedLocationAsAhead(prose, location.name)
    ) {
      issues.push({
        code: "INVALID_SCHEMA",
        message: `Narration treats departed location ${location.name} as the destination ahead`,
        path: "prose",
      });
    }
  }

  for (const fact of prospectiveState.facts.filter(
    ({ ownerCharacterId }) => ownerCharacterId === povId,
  )) {
    const misattributedTo = misattributedPovFact(prose, fact.claim, beforePov, prospectiveState);
    if (misattributedTo === null) continue;
    issues.push({
      code: "INVALID_SCHEMA",
      message: `Narration attributes ${beforePov.name}'s canon to ${misattributedTo}`,
      path: "prose",
    });
  }

  return issues;
}

export function validateChapterFrameSafety(
  prospectiveState: WorldState,
  input: unknown,
): ValidationResult<ChapterFrame> {
  const parsed = ChapterFrameSchema.safeParse(input);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((entry) => ({
        code: "INVALID_SCHEMA",
        message: entry.message,
        path: entry.path.map(String).join("."),
      })),
      ok: false,
    };
  }
  if (prospectiveState.lockedPovId === null) {
    return failure("POV_NOT_LOCKED", "Chapter frame requires a locked viewpoint", "lockedPovId");
  }
  if (parsed.data.terminal !== prospectiveState.terminal) {
    return failure("STORY_TERMINAL", "Frame terminal flag disagrees with canon", "terminal");
  }
  if (!prospectiveState.terminal) {
    const choices = validateSuggestedChoices(prospectiveState, parsed.data.choices);
    if (!choices.ok) return choices;
  }
  const leakedFacts = hiddenFactsInText(
    prospectiveState,
    prospectiveState.lockedPovId,
    [parsed.data.title, ...parsed.data.choices.map(({ description }) => description)].join("\n"),
  );
  if (leakedFacts.length > 0) {
    return {
      issues: leakedFacts.map((fact) => ({
        code: "POV_LEAK",
        message: `Frame exposes forbidden fact ${fact.id}`,
        path: "frame",
      })),
      ok: false,
    };
  }
  return { data: parsed.data, ok: true };
}

function hiddenFactsInText(
  state: WorldState,
  povCharacterId: string,
  text: string,
): WorldState["facts"] {
  const context = buildPovContext(state, povCharacterId);
  const allowedFactIds = new Set(context.factIds);
  const normalized = text.toLocaleLowerCase("en-US");
  return state.facts.filter(
    (fact) =>
      !allowedFactIds.has(fact.id) &&
      (normalized.includes(fact.id.toLocaleLowerCase("en-US")) ||
        normalized.includes(fact.claim.toLocaleLowerCase("en-US"))),
  );
}

const NUMBER_VALUES = new Map<string, number>([
  ["zero", 0],
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19],
  ["twenty", 20],
  ["thirty", 30],
  ["forty", 40],
  ["fifty", 50],
  ["sixty", 60],
  ["seventy", 70],
  ["eighty", 80],
  ["ninety", 90],
]);
const NUMBER_TOKEN = `(?:\\d{1,4}|${[...NUMBER_VALUES.keys()].join("|")}|hundred|thousand|and)`;
const NUMBER_PHRASE = `${NUMBER_TOKEN}(?:[-\\s]+${NUMBER_TOKEN}){0,5}`;

function resourceSnapshotsInText(
  prose: string,
  resource: "health" | "mana",
): readonly (readonly [number, number])[] {
  const results: Array<readonly [number, number]> = [];
  const patterns = [
    new RegExp(
      `\\b${resource}\\b[^.!?\\n]{0,64}?\\b(${NUMBER_PHRASE})\\s*(?:out\\s+of|of|/)\\s*(${NUMBER_PHRASE})\\b`,
      "giu",
    ),
    new RegExp(
      `\\b(${NUMBER_PHRASE})\\s*(?:out\\s+of|of|/)\\s*(${NUMBER_PHRASE})\\s+${resource}\\b`,
      "giu",
    ),
  ];
  for (const pattern of patterns) {
    for (const match of prose.matchAll(pattern)) {
      const current = parseNarrativeInteger(match[1]);
      const maximum = parseNarrativeInteger(match[2]);
      if (current !== null && maximum !== null) results.push([current, maximum]);
    }
  }
  return results;
}

function parseNarrativeInteger(value: string | undefined): number | null {
  if (value === undefined) return null;
  const normalized = value.toLocaleLowerCase("en-US").trim();
  if (/^\d{1,4}$/u.test(normalized)) return Number(normalized);
  const tokens = normalized.replaceAll("-", " ").split(/\s+/u);
  let total = 0;
  let current = 0;
  let sawNumber = false;
  for (const token of tokens) {
    if (token === "and") continue;
    if (token === "hundred") {
      current = Math.max(1, current) * 100;
      sawNumber = true;
      continue;
    }
    if (token === "thousand") {
      total += Math.max(1, current) * 1_000;
      current = 0;
      sawNumber = true;
      continue;
    }
    const valueForToken = NUMBER_VALUES.get(token);
    if (valueForToken === undefined) return null;
    current += valueForToken;
    sawNumber = true;
  }
  return sawNumber ? total + current : null;
}

function claimsArrivalAtLocation(
  prose: string,
  locationName: string,
  otherLocationNames: readonly string[],
): boolean {
  const location = escapeRegExp(locationName);
  const directArrival = new RegExp(
    `\\b(?:arriv(?:ed|ing)(?:\\s+(?:at|in))?|enter(?:ed|ing)|reached)\\b(?<between>[^.!?\\n]{0,80}?)\\b${location}\\b`,
    "giu",
  );
  const directionalArrival = new RegExp(
    `\\b(?:cross(?:ed|es|ing)|step(?:ped|s|ping)|walk(?:ed|s|ing)|mov(?:ed|es|ing)|pass(?:ed|es|ing)|travel(?:ed|led|s|ing)|rode|riding)\\b[^.!?\\n]{0,64}?\\b(?:into|inside|within|onto)\\b(?<between>[^.!?\\n]{0,64}?)\\b${location}\\b`,
    "giu",
  );
  return [directArrival, directionalArrival].some((pattern) =>
    [...prose.matchAll(pattern)].some((match) =>
      arrivalSegmentTargetsLocation(match.groups?.between ?? "", otherLocationNames),
    ),
  );
}

function arrivalSegmentTargetsLocation(
  segment: string,
  otherLocationNames: readonly string[],
): boolean {
  if (/\b(?:ahead|before|beyond|outside|toward|towards)\b/iu.test(segment)) return false;
  return otherLocationNames.every(
    (name) => !new RegExp(`\\b${escapeRegExp(name)}\\b`, "iu").test(segment),
  );
}

function treatsDepartedLocationAsAhead(prose: string, locationName: string): boolean {
  const location = escapeRegExp(locationName);
  return [
    new RegExp(`\\bahead\\s+(?:waited|stood|lay)\\s+(?:the\\s+)?${location}\\b`, "iu"),
    new RegExp(`\\b${location}\\b[^.!?\\n]{0,24}?\\b(?:waited|stood|lay)\\s+ahead\\b`, "iu"),
    new RegExp(`\\b${location}\\b\\s+drew\\s+nearer\\b`, "iu"),
  ].some((pattern) => pattern.test(prose));
}

function misattributedPovFact(
  prose: string,
  claim: string,
  pov: WorldState["characters"][number],
  state: WorldState,
): string | null {
  const claimTokens = narrativeTokens(claim);
  const povNameTokens = narrativeTokens(pov.name);
  const povFirstName = povNameTokens[0];
  const subjectLength = startsWithTokens(claimTokens, povNameTokens)
    ? povNameTokens.length
    : povFirstName !== undefined && claimTokens[0] === povFirstName
      ? 1
      : 0;
  if (subjectLength === 0) return null;
  const predicate = claimTokens.slice(subjectLength);
  if (predicate.length < 3) return null;
  const signature = predicate.slice(-Math.min(4, predicate.length));

  for (const sentence of prose.split(/[.!?\n]+/u)) {
    const tokens = narrativeTokens(sentence);
    const signatureIndex = indexOfTokens(tokens, signature);
    if (signatureIndex < 0) continue;
    let nearest: {
      readonly character: WorldState["characters"][number];
      readonly index: number;
    } | null = null;
    for (const character of state.characters) {
      const fullName = narrativeTokens(character.name);
      const aliases = [fullName, fullName.slice(0, 1)].filter((alias) => alias.length > 0);
      for (const alias of aliases) {
        const index = lastIndexOfTokens(tokens, alias, signatureIndex);
        if (index >= 0 && (nearest === null || index > nearest.index)) {
          nearest = { character, index };
        }
      }
    }
    if (nearest !== null && nearest.character.id !== pov.id) return nearest.character.name;
  }
  return null;
}

function narrativeTokens(value: string): string[] {
  return (value.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? []).map((token) => {
    if (["planned", "planning", "plans"].includes(token)) return "plan";
    if (["believed", "believes", "believing"].includes(token)) return "believe";
    return token;
  });
}

function startsWithTokens(value: readonly string[], prefix: readonly string[]): boolean {
  return prefix.every((token, index) => value[index] === token);
}

function indexOfTokens(value: readonly string[], wanted: readonly string[]): number {
  for (let index = 0; index <= value.length - wanted.length; index += 1) {
    if (wanted.every((token, offset) => value[index + offset] === token)) return index;
  }
  return -1;
}

function lastIndexOfTokens(
  value: readonly string[],
  wanted: readonly string[],
  beforeIndex: number,
): number {
  for (let index = beforeIndex - wanted.length; index >= 0; index -= 1) {
    if (wanted.every((token, offset) => value[index + offset] === token)) return index;
  }
  return -1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function failure<T>(
  code: ValidationIssue["code"],
  message: string,
  path: string,
): ValidationResult<T> {
  return { issues: [{ code, message, path }], ok: false };
}
