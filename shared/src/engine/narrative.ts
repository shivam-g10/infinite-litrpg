import {
  type ChapterDraft,
  ChapterDraftSchema,
  type ChapterFrame,
  ChapterFrameSchema,
  type Choice,
  ChoiceSchema,
  type WorldState,
} from "../contracts";
import { buildPovContext } from "./knowledge";
import { resolveTurn } from "./resolver";
import type { ValidationIssue, ValidationResult } from "./validation";

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

export function validateChapterDraft(
  prospectiveState: WorldState,
  input: unknown,
): ValidationResult<ChapterDraft> {
  const parsed = ChapterDraftSchema.safeParse(input);
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
    return failure("POV_NOT_LOCKED", "Narration requires a locked viewpoint", "lockedPovId");
  }
  if (parsed.data.terminal !== prospectiveState.terminal) {
    return failure(
      "STORY_TERMINAL",
      "Draft terminal flag disagrees with prospective canon",
      "terminal",
    );
  }
  if (!prospectiveState.terminal) {
    const choices = validateSuggestedChoices(prospectiveState, parsed.data.choices);
    if (!choices.ok) {
      return choices;
    }
  }

  const leakedFacts = hiddenFactsInText(
    prospectiveState,
    prospectiveState.lockedPovId,
    [
      parsed.data.title,
      parsed.data.prose,
      ...parsed.data.choices.map(({ description }) => description),
    ].join("\n"),
  );
  if (leakedFacts.length > 0) {
    return {
      issues: leakedFacts.map((fact) => ({
        code: "POV_LEAK",
        message: `Draft exposes forbidden fact ${fact.id}`,
        path: "prose",
      })),
      ok: false,
    };
  }

  return { data: parsed.data, ok: true };
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
