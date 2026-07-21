import { z } from "zod";

export const STORY_GENRES = [
  "adventure",
  "action",
  "drama",
  "romance",
  "mystery",
  "dark-fantasy",
] as const;

export const STORY_PERSONALITIES = [
  "pragmatic",
  "protective",
  "ambitious",
  "curious",
  "ruthless",
  "warm",
] as const;

export const STORY_BACKGROUNDS = ["orphan", "hidden-heir", "outcast", "former-ruler"] as const;
export const STORY_STARTING_LIVES = ["birth", "child", "teen", "adult"] as const;
export const STORY_POWER_PATHS = ["weak-to-strong", "overpowered"] as const;
export const STORY_GENDERS = ["male", "female"] as const;
export const STORY_REBIRTH_CAUSES = [
  "sacrifice",
  "betrayal",
  "accident",
  "execution",
  "ritual-failure",
] as const;
export const STORY_MEMORIES = ["full", "fragments", "sealed"] as const;
export const STORY_SYSTEM_FOCUSES = [
  "levels-and-class",
  "skill-fusion",
  "titles-and-oaths",
  "territory",
] as const;

const CharacterNameSchema = z
  .string()
  .min(2)
  .max(60)
  .regex(
    /^[\p{L}][\p{L}' -]*$/u,
    "Character names may contain letters, spaces, apostrophes, and hyphens",
  )
  .refine((value) => value === value.trim(), "Character names must be trimmed");

const LEGACY_STORY_CAST = {
  pastLife: "Malachar",
  protagonist: "Rowan Ashborn",
  supporting: {
    general: "Varek Thorn",
    hero: "Elara Voss",
    prince: "Lucan Aurelis",
    rival: "Nyra Vale",
    saint: "Maelin Rook",
  },
} as const;

const LEGACY_STORY_WORLD = {
  calendarName: "Ashfall",
  crownName: "Ashen Crown",
  legionName: "Ashen Legion",
  primarySkillName: "Ember Sense",
  protagonistClassName: "Ashbound",
  raiderName: "Ash-raiders",
  roadName: "Ash Road",
  secondarySkillName: "Sovereign's Echo",
  settlementName: "Cinder Village",
  systemName: "Ashen System",
} as const;

export const StoryCastSchema = z
  .object({
    pastLife: CharacterNameSchema,
    protagonist: CharacterNameSchema,
    supporting: z
      .object({
        general: CharacterNameSchema,
        hero: CharacterNameSchema,
        prince: CharacterNameSchema,
        rival: CharacterNameSchema,
        saint: CharacterNameSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((cast, context) => {
    const names = [cast.protagonist, cast.pastLife, ...Object.values(cast.supporting)].map((name) =>
      name.toLocaleLowerCase("en"),
    );
    if (new Set(names).size !== names.length) {
      context.addIssue({ code: "custom", message: "Character names must be unique" });
    }
  });

export type StoryCast = z.infer<typeof StoryCastSchema>;
export const DEFAULT_STORY_CAST: StoryCast = StoryCastSchema.parse(LEGACY_STORY_CAST);

export const StoryWorldSchema = z
  .object({
    calendarName: CharacterNameSchema,
    crownName: CharacterNameSchema,
    legionName: CharacterNameSchema,
    primarySkillName: CharacterNameSchema,
    protagonistClassName: CharacterNameSchema,
    raiderName: CharacterNameSchema,
    roadName: CharacterNameSchema,
    secondarySkillName: CharacterNameSchema,
    settlementName: CharacterNameSchema,
    systemName: CharacterNameSchema,
  })
  .strict();

export type StoryWorld = z.infer<typeof StoryWorldSchema>;
export const DEFAULT_STORY_WORLD: StoryWorld = StoryWorldSchema.parse(LEGACY_STORY_WORLD);

const uniqueSelection = <T extends z.ZodTypeAny>(item: T, minimum: number, maximum: number) =>
  z
    .array(item)
    .min(minimum)
    .max(maximum)
    .refine((values) => new Set(values).size === values.length, "Selections must be unique");

export const StorySetupSchema = z
  .object({
    backgrounds: uniqueSelection(z.enum(STORY_BACKGROUNDS), 1, 2),
    cast: StoryCastSchema.default(DEFAULT_STORY_CAST),
    foundation: z.literal("reincarnation-system"),
    genres: uniqueSelection(z.enum(STORY_GENRES), 1, 3),
    guidance: z
      .string()
      .max(500)
      .refine((value) => value === value.trim(), "Guidance must be trimmed"),
    memory: z.enum(STORY_MEMORIES),
    personalityTraits: uniqueSelection(z.enum(STORY_PERSONALITIES), 1, 3),
    powerPath: z.enum(STORY_POWER_PATHS),
    protagonistGender: z.enum(STORY_GENDERS),
    rebirthCause: z.enum(STORY_REBIRTH_CAUSES),
    startingLife: z.enum(STORY_STARTING_LIVES),
    systemFocus: z.enum(STORY_SYSTEM_FOCUSES),
    world: StoryWorldSchema.default(DEFAULT_STORY_WORLD),
  })
  .strict();

export type StorySetup = z.infer<typeof StorySetupSchema>;

export const DEFAULT_STORY_SETUP: StorySetup = StorySetupSchema.parse({
  backgrounds: ["outcast", "former-ruler"],
  cast: DEFAULT_STORY_CAST,
  foundation: "reincarnation-system",
  genres: ["adventure", "action", "drama"],
  guidance: "",
  memory: "fragments",
  personalityTraits: ["pragmatic", "protective"],
  powerPath: "weak-to-strong",
  protagonistGender: "male",
  rebirthCause: "betrayal",
  startingLife: "adult",
  systemFocus: "titles-and-oaths",
  world: DEFAULT_STORY_WORLD,
});
