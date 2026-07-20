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

function failure<T>(
  code: ValidationIssue["code"],
  message: string,
  path: string,
): ValidationResult<T> {
  return { issues: [{ code, message, path }], ok: false };
}
