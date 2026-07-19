import { describe, expect, it } from "vitest";

import { CHARACTER_IDS, PUBLIC_CHARACTERS } from "./characters";

describe("public character seed", () => {
  it("contains exactly the six locked product characters", () => {
    expect(PUBLIC_CHARACTERS.map(({ id }) => id)).toEqual(CHARACTER_IDS);
    expect(new Set(CHARACTER_IDS).size).toBe(6);
  });

  it("contains public data without private fact identifiers", () => {
    const serialized = JSON.stringify(PUBLIC_CHARACTERS);

    expect(serialized).not.toContain("rowan-is-malachar-reincarnated");
    expect(serialized).not.toContain("lucan-will-stage-border-coup");
  });
});
