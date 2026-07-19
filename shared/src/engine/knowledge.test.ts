import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { WorldState } from "../contracts";
import { buildPovContext } from "./knowledge";
import { validateWorldState } from "./validation";

describe("POV-safe context", () => {
  it("does not expose remote dynamic character state", () => {
    const state = seedState();
    const context = buildPovContext(state, "rowan-ashborn");
    const serializedOthers = JSON.stringify(context.publicCharacters);

    expect(serializedOthers).not.toContain("high-basilica");
    expect(serializedOthers).not.toContain("black-march");
    expect(serializedOthers).not.toContain('"level"');
    expect(serializedOthers).not.toContain("buried proof");
    expect(serializedOthers).not.toContain("profits from war");
    expect(serializedOthers).not.toContain("unrecorded class");
    expect(context.povCharacter.locationId).toBe("cinder-village");
  });
});

function seedState(): WorldState {
  const raw = JSON.parse(
    readFileSync(resolve("evals/fixtures/demon-king-world.json"), "utf8"),
  ) as unknown;
  const result = validateWorldState(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.data;
}
