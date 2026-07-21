import { z } from "zod";

export const CONTRACT_VERSION = "1.1.0" as const;
export const FIXTURE_VERSION = "1.1.0" as const;
export const PROMPT_VERSION = "1.6.0" as const;
export const RUNTIME_SCHEMA_VERSION = "1.1.0-runtime-candidates-5" as const;
export const PERSISTED_PROMPT_VERSIONS = [
  "1.4.9",
  "1.4.10",
  "1.4.11",
  "1.4.12",
  "1.5.0",
  PROMPT_VERSION,
] as const;
export const PersistedPromptVersionSchema = z.enum(PERSISTED_PROMPT_VERSIONS);

export const IdSchema = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
export const CharacterIdSchema = IdSchema;
export const FactIdSchema = IdSchema;
export const LocationIdSchema = IdSchema;
export const FactionIdSchema = IdSchema;
export const ItemIdSchema = IdSchema;
export const SkillIdSchema = IdSchema;
export const IntentIdSchema = IdSchema;
export const EventIdSchema = IdSchema;

export const ChapterNumberSchema = z.number().int().min(0).max(350);
export const ActNumberSchema = z.number().int().min(1).max(7);
export const WorldVersionSchema = z.number().int().min(1);
export const NonEmptyTextSchema = z.string().trim().min(1).max(4_000);
export const ShortTextSchema = z.string().trim().min(1).max(240);
export const HashSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export type ActNumber = z.infer<typeof ActNumberSchema>;
export type PersistedPromptVersion = z.infer<typeof PersistedPromptVersionSchema>;
