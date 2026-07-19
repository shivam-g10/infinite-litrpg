import type { ActiveEvent, Fact, WorldState } from "../contracts";

export interface PovContext {
  readonly factIds: readonly string[];
  readonly facts: readonly Fact[];
  readonly observedEvents: readonly ActiveEvent[];
  readonly povCharacter: WorldState["characters"][number];
  readonly publicCharacters: readonly {
    readonly id: string;
    readonly name: string;
  }[];
}

export function buildPovContext(state: WorldState, povCharacterId: string): PovContext {
  const povCharacter = state.characters.find(({ id }) => id === povCharacterId);
  if (!povCharacter) {
    throw new Error(`Missing POV character ${povCharacterId}`);
  }

  const ledger = state.knowledgeLedgers.find(({ characterId }) => characterId === povCharacterId);
  if (!ledger) {
    throw new Error(`Missing POV ledger ${povCharacterId}`);
  }

  const allowedFactIds = new Set(ledger.entries.map(({ factId }) => factId));
  for (const fact of state.facts) {
    if (fact.visibility === "public") {
      allowedFactIds.add(fact.id);
    }
  }

  const facts = state.facts.filter(({ id }) => allowedFactIds.has(id));
  const observedEvents = state.activeEvents.filter(
    (event) =>
      event.visibility === "public" ||
      event.participantIds.includes(povCharacterId) ||
      event.observerIds.includes(povCharacterId),
  );

  return {
    factIds: facts.map(({ id }) => id),
    facts,
    observedEvents,
    povCharacter,
    publicCharacters: state.characters.map(({ id, name }) => ({
      id,
      name,
    })),
  };
}

export function contextContainsFact(context: PovContext, factId: string): boolean {
  return context.factIds.includes(factId);
}
