export const CHARACTER_IDS = [
  "rowan-ashborn",
  "elara-voss",
  "maelin-rook",
  "varek-thorn",
  "lucan-aurelis",
  "nyra-vale",
] as const;

export type CharacterId = (typeof CHARACTER_IDS)[number];

export interface PublicCharacterProfile {
  readonly id: CharacterId;
  readonly name: string;
  readonly publicRole: string;
  readonly characterClass: string;
  readonly level: number;
  readonly location: string;
  readonly safeStartingGoals: readonly [string, string];
}

export const PUBLIC_CHARACTERS: readonly PublicCharacterProfile[] = [
  {
    id: "rowan-ashborn",
    name: "Rowan Ashborn",
    publicRole: "Malachar reincarnated as a level-one human",
    characterClass: "Ashbound",
    level: 1,
    location: "Cinder Village",
    safeStartingGoals: ["Survive the ash-raider attack", "Hide his unusual magic"],
  },
  {
    id: "elara-voss",
    name: "Elara Voss",
    publicRole: "Chosen Hero who doubts the prophecy",
    characterClass: "Sunblade",
    level: 18,
    location: "Capital",
    safeStartingGoals: ["Test the prophecy's missing lines", "Protect the recovering capital"],
  },
  {
    id: "maelin-rook",
    name: "Maelin Rook",
    publicRole: "Saint guarding the Church's buried proof",
    characterClass: "Oracle",
    level: 16,
    location: "High Basilica",
    safeStartingGoals: ["Preserve forbidden evidence", "Keep pilgrims alive"],
  },
  {
    id: "varek-thorn",
    name: "Varek Thorn",
    publicRole: "Former Demon General between oath and people",
    characterClass: "Dread Marshal",
    level: 27,
    location: "Black March",
    safeStartingGoals: ["Rally the March survivors", "Choose whom his strength serves"],
  },
  {
    id: "lucan-aurelis",
    name: "Lucan Aurelis",
    publicRole: "Crown Prince whose throne profits from war",
    characterClass: "Banner Lord",
    level: 14,
    location: "Capital",
    safeStartingGoals: ["Secure the succession", "Expose the war economy"],
  },
  {
    id: "nyra-vale",
    name: "Nyra Vale",
    publicRole: "Guild rival carrying an unrecorded class",
    characterClass: "Unassigned",
    level: 12,
    location: "Cinder Village",
    safeStartingGoals: ["Identify the class sigil", "Outpace the guild's hunters"],
  },
] as const;
