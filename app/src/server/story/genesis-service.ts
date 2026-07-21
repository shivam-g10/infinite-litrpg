import { createHash } from "node:crypto";

import {
  StoryGenesisAuditV1Schema,
  StoryGenesisCandidateV1Schema,
  StoryGenesisRecordV1Schema,
  StoryGenesisCompileError,
  compileStoryGenesis,
  deriveGuidanceRequirements,
  normalizeStoryGenesisCandidate,
  type StoryGenesisRecordV1,
  type StorySetup,
} from "@infinite-litrpg/shared";
import type OpenAI from "openai";

import {
  ChapterCostBudget,
  OpenAIRuntimeError,
  runStructuredResponse,
  type RuntimeCallResult,
} from "../openai";

export class StoryGenesisError extends Error {
  readonly code: "GENESIS_FAILED" | "GENESIS_GUIDANCE_UNSATISFIED";

  constructor(code: StoryGenesisError["code"], message: string) {
    super(message);
    this.name = "StoryGenesisError";
    this.code = code;
  }
}

export interface GenerateStoryGenesisOptions {
  readonly onProgress?: (progress: StoryGenesisProgress) => void;
  readonly serviceTier?: "standard" | "flex";
  readonly timeoutMs?: number;
}

export interface StoryGenesisProgress {
  readonly cycle: number;
  readonly level: "info" | "retry" | "success";
  readonly message: string;
  readonly phase: "world" | "world-checking";
}

export async function generateStoryGenesis(
  client: OpenAI,
  setup: StorySetup,
  options: GenerateStoryGenesisOptions = {},
): Promise<StoryGenesisRecordV1> {
  const calls: StoryGenesisRecordV1["calls"][number][] = [];
  const guidanceRequirements = deriveGuidanceRequirements(setup.guidance);
  let feedback: readonly string[] = [];
  for (let cycle = 1; cycle <= 3; cycle += 1) {
    progress(options, cycle, "world", "info", `Terra is generating world candidate ${cycle} of 3.`);
    let candidateCall: RuntimeCallResult<ReturnType<typeof StoryGenesisCandidateV1Schema.parse>>;
    try {
      candidateCall = await runStructuredResponse(client, {
        input: JSON.stringify({ cycle, guidanceRequirements, priorAuditIssues: feedback, setup }),
        instructions: candidateInstructions(),
        model: "gpt-5.6-terra",
        policy: policy(options),
        reasoningEffort: "medium",
        schema: StoryGenesisCandidateV1Schema,
        schemaName: "story_genesis_candidate_v1",
        validate: (candidate) => void compileStoryGenesis(setup, candidate),
      });
    } catch (error) {
      if (error instanceof OpenAIRuntimeError && !error.retryable) throw error;
      feedback = [genesisFailureDetail(error)];
      progress(
        options,
        cycle,
        "world",
        "retry",
        `Candidate ${cycle} failed validation: ${feedback[0]}`,
      );
      if (cycle < 3) continue;
      throw new StoryGenesisError(genesisFailureCode(error), feedback.join("; "));
    }
    calls.push(callEvidence("candidate", "gpt-5.6-terra", candidateCall));
    const candidate = normalizeStoryGenesisCandidate(candidateCall.data);
    const compiled = compileStoryGenesis(setup, candidate);
    progress(
      options,
      cycle,
      "world",
      "success",
      `Candidate received: ${candidate.locations.length} locations, ${candidate.factions.length} factions, ${candidate.protagonist.inventory.length} starting items.`,
    );

    progress(
      options,
      cycle,
      "world-checking",
      "info",
      "Terra is auditing world coherence and guidance coverage.",
    );
    const auditCall = await runStructuredResponse(client, {
      input: JSON.stringify({ candidate, guidanceRequirements, setup }),
      instructions: auditInstructions(),
      model: "gpt-5.6-terra",
      policy: policy(options),
      reasoningEffort: "low",
      schema: StoryGenesisAuditV1Schema,
      schemaName: "story_genesis_audit_v1",
    });
    calls.push(callEvidence("audit", "gpt-5.6-terra", auditCall));
    const audit = auditCall.data;
    if (!audit.approved || audit.unmetGuidance.length > 0) {
      feedback = [...audit.issues, ...audit.unmetGuidance];
      progress(
        options,
        cycle,
        "world-checking",
        "retry",
        `Audit rejected candidate ${cycle}: ${feedback.join("; ") || "no reason returned"}`,
      );
      if (cycle < 3) continue;
      const code =
        audit.unmetGuidance.length > 0 ? "GENESIS_GUIDANCE_UNSATISFIED" : "GENESIS_FAILED";
      throw new StoryGenesisError(code, feedback.join("; ") || "Genesis audit rejected the world");
    }

    progress(
      options,
      cycle,
      "world-checking",
      "success",
      "World candidate passed deterministic validation and Terra audit.",
    );

    return StoryGenesisRecordV1Schema.parse({
      audit,
      calls,
      candidate,
      initialWorld: compiled.world,
      openingAction: compiled.openingAction,
      openingActionDescription: compiled.openingActionDescription,
      setup,
      setupHash: hashJson(setup),
      version: "1.0.0",
      worldHash: hashJson(compiled.world),
    });
  }
  throw new StoryGenesisError("GENESIS_FAILED", "Genesis exhausted all candidate cycles");
}

function progress(
  options: GenerateStoryGenesisOptions,
  cycle: number,
  phase: StoryGenesisProgress["phase"],
  level: StoryGenesisProgress["level"],
  message: string,
): void {
  options.onProgress?.({ cycle, level, message, phase });
}

function genesisFailureDetail(error: unknown): string {
  const visited = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth += 1) {
    if (visited.has(current)) break;
    visited.add(current);
    if (current instanceof StoryGenesisCompileError) return current.message;
    if (typeof current === "object" && "issues" in current && Array.isArray(current.issues)) {
      return JSON.stringify(current.issues);
    }
    if (typeof current === "object" && "cause" in current) {
      current = current.cause;
      continue;
    }
    break;
  }
  if (error instanceof OpenAIRuntimeError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : "Candidate validation failed";
}

function genesisFailureCode(error: unknown): StoryGenesisError["code"] {
  const visited = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth += 1) {
    if (visited.has(current)) break;
    visited.add(current);
    if (
      current instanceof StoryGenesisCompileError &&
      current.code === "GENESIS_GUIDANCE_UNSATISFIED"
    ) {
      return current.code;
    }
    if (typeof current === "object" && "cause" in current) {
      current = current.cause;
      continue;
    }
    break;
  }
  return "GENESIS_FAILED";
}

function policy(options: GenerateStoryGenesisOptions) {
  return {
    budget: new ChapterCostBudget(null),
    maxRetries: 0,
    serviceTier: options.serviceTier ?? "standard",
    timeoutMs: options.timeoutMs ?? 300_000,
  } as const;
}

function callEvidence(
  phase: "candidate" | "audit",
  model: "gpt-5.6-sol" | "gpt-5.6-terra",
  call: RuntimeCallResult<unknown>,
): StoryGenesisRecordV1["calls"][number] {
  return {
    estimatedCostUsd: call.estimatedCostUsd,
    latencyMs: call.latencyMs,
    model,
    phase,
    responseId: call.responseId,
    usage: call.usage,
  };
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function candidateInstructions(): string {
  return [
    "Generate complete canonical genesis for a reincarnation LitRPG.",
    "Return only the strict schema. Never reuse Ash Road, Cinder Village, Ashen System, rusted sword, or nine coins.",
    "Choose the opening from palace, wilderness, dungeon, settlement, battlefield, ship, temple, or another concrete place. A road is allowed but not preferred.",
    "Create exactly five supporting characters: one general, one hero, one prince, one rival, and one saint. Never omit or repeat a role. Create exactly two starting protagonist skills.",
    "Create five to nine connected locations with symmetric adjacency and three to six factions.",
    "All keys are local references, not trusted database IDs.",
    "Keep every text field under 180 characters and end it as a complete sentence. Never truncate a sentence to fill the schema limit.",
    "A newborn has empty inventory. Other inventory must fit the body, location, incident, and opening action.",
    "Every discoverable fact subjectKeys entry must be unique and must exactly match protagonist, general, hero, prince, rival, saint, or a location or faction key created in this same response.",
    "Facts must be discoverable through their listed subjects and action types.",
    "The opening action must be executable from opening.locationKey. Investigate may target that location, a supporting character at that location, or a public faction. Interact, defend, and targeted skills may target only a supporting character at that location. Rally must use the opening location and the protagonist's first listed faction.",
    "Each milestone needs at least investigate or interact plus another directly targetable action.",
    "If any skill has a nonzero manaCost, System rules must define the mana pool, how mana is spent, how it recovers, and meaningful limits. Otherwise use manaCost zero.",
    "Every ending constraint must be explicitly supported by at least one System rule and one milestone.",
    "The input contains generic guidanceRequirements with stable IDs. Every requirement must become explicit canon, not implication.",
    "Return exactly one guidanceCoverage entry per guidance requirement. Copy its requirementId exactly and list every exact dot-separated canon path that proves it. Tone and style guidance is excluded from this list.",
    "The input may contain priorAuditIssues. Treat every listed issue as a mandatory correction. Before returning, self-check every role, key reference, adjacency, subject, item, action, milestone, and guidance path against the schema.",
  ].join("\n");
}

function auditInstructions(): string {
  return [
    "Audit this proposed story genesis. Return only the strict verdict schema.",
    "The deterministic compiler already normalized and validated graph symmetry, references, inventory, schema limits, and opening-action legality. Do not reject those mechanical constraints again.",
    "Approve unless there is a launch-blocking contradiction in the opening, an impossible core System rule, repeated fixed Ash-world structure, or concrete user guidance that is explicitly absent.",
    "Do not demand exhaustive future-arc mechanics. Do not reject details that later chapters can develop. Do not infer relationships from names or titles; use the structured relationship labels, goals, and plans.",
    "Treat a concrete guidance fact as satisfied when it appears explicitly in protagonist beliefs, discoverable facts, structured relationships, skills, threat, or public role.",
    "Style guidance need not become canon. Concrete safe facts, relationships, counts, abilities, and institutions must become canon.",
    "approved may be true only when issues and unmetGuidance are empty.",
  ].join("\n");
}
