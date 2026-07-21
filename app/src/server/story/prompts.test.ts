import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  BackgroundIntentCandidateSchema,
  CHARACTER_IDS,
  ChapterFrameModelCandidateSchema,
  CONTRACT_VERSION,
  PROMPT_VERSION,
  buildChapterChoiceOptions,
  buildPovContext,
  validateWorldState,
  type PersistedTraceEnvelope,
  type PovContext,
  type WorldDelta,
  type WorldState,
} from "@infinite-litrpg/shared";
import { zodTextFormat } from "openai/helpers/zod";
import { describe, expect, it } from "vitest";

import {
  buildAuditPrompt,
  buildChapterFramePrompt,
  buildCustomActionPrompt,
  buildLunaAgentInputs,
  buildNarrationPrompt,
  selectBackgroundActors,
} from "./prompts";

const ROWAN_IDENTITY_PROSE = `Rowan knew he was Malachar reincarnated. ${"Ash ".repeat(894)}`;

describe("background actor selection", () => {
  it("versions and losslessly compacts every live agent and frame prompt", () => {
    expect(PROMPT_VERSION).toBe("1.6.0");
    const backgroundFormat = zodTextFormat(BackgroundIntentCandidateSchema, "background_intent");
    const frameFormat = zodTextFormat(ChapterFrameModelCandidateSchema, "chapter_frame_candidate");
    expect(JSON.stringify(frameFormat)).not.toMatch(/"items":\[/u);
    for (const povId of CHARACTER_IDS) {
      const state = seed();
      state.lockedPovId = povId;
      const world = expectedCompactPublicWorld(state);
      const actors = selectBackgroundActors(state);
      const agentInputs = buildLunaAgentInputs(state, actors);

      expect(agentInputs).toHaveLength(actors.length);
      for (const [index, input] of agentInputs.entries()) {
        const actor = actors[index];
        if (!actor) throw new Error("Selected actor disappeared");
        const payload = JSON.parse(input.instructions.split("\n").at(-1) ?? "null") as Record<
          string,
          unknown
        >;
        expect(payload.viewpoint).toEqual(
          expectedCompleteCompactPov(buildPovContext(state, actor.id)),
        );
        expect(payload.world).toEqual(world);
        expect(payload).not.toHaveProperty("contractVersion");
        expect(payload).not.toHaveProperty("promptVersion");
        expect(payload).not.toHaveProperty("stateVersion");
        expect(input.instructions).toContain(
          'Output={"a":{"t":type,"v":[args]},"g":goal,"e":expectedEffect,"r":{"f":factIds,"i":itemIds,"s":skillIds}}',
        );
        expect(input.instructions).toContain("use_item item,qty,target");
        expect(JSON.stringify(backgroundFormat)).not.toMatch(/"items":\[/u);
      }

      const frameText = buildChapterFramePrompt(state);
      const frame = JSON.parse(frameText) as Record<string, unknown>;
      const expectedOptions = buildChapterChoiceOptions(state).map(({ description, id }) => [
        id,
        description,
      ]);
      expect(frame.viewpoint).toEqual(expectedCompleteCompactPov(buildPovContext(state, povId)));
      expect(frame.world).toEqual(world);
      expect(Object.entries(frame.optionsByIdAsDescription as Record<string, string>)).toEqual(
        expectedOptions,
      );
      expect(frame).not.toHaveProperty("instruction");
      expect(frame).not.toHaveProperty("options");
      expect(frame).not.toHaveProperty("stateVersion");
    }
  });

  it("selects relevant actors only and never fills empty slots", () => {
    const state = seed();
    state.lockedPovId = "rowan-ashborn";

    expect(selectBackgroundActors(state).map(({ id }) => id)).toEqual(["nyra-vale"]);
  });

  it("never activates more than three actors", () => {
    const state = seed();
    for (const character of state.characters) {
      state.lockedPovId = character.id;
      expect(selectBackgroundActors(state).length).toBeLessThanOrEqual(3);
    }
  });

  it("binds narration to exact POV mutations and forbids plausible extra actions", () => {
    const before = seed();
    before.lockedPovId = "rowan-ashborn";
    const prospective = structuredClone(before);
    prospective.chapter = 1;
    prospective.version += 1;
    prospective.characters[0]!.experience += 10;
    const prompt = JSON.parse(
      buildNarrationPrompt(
        before,
        prospective,
        {
          action: { type: "wait" },
          actorId: "rowan-ashborn",
          description: "Wait.",
          milestoneId: null,
          source: "suggested",
          stateVersion: before.version,
        },
        {
          acceptedIntentIds: ["player-intent"],
          clock: {
            convergencePressure: false,
            fromAct: 1,
            fromChapter: 0,
            terminal: false,
            toAct: 1,
            toChapter: 1,
            transitionRequired: false,
          },
          contractVersion: CONTRACT_VERSION,
          events: [],
          expectedWorldVersion: before.version,
          knowledgeMutations: [],
          promptVersion: PROMPT_VERSION,
          rejectedIntents: [],
          stateMutations: [{ amount: 10, characterId: "rowan-ashborn", type: "grant_experience" }],
          surfacedClueFactIds: [],
        },
      ),
    ) as Record<string, unknown>;

    expect(JSON.stringify(prompt)).toContain("No unlisted skill or item use");
    expect(JSON.stringify(prompt)).toContain("Another character event permits only its summary");
    expect(JSON.stringify(prompt)).toContain("No durable fact beyond the whitelist");
    expect(JSON.stringify(prompt)).toContain("a background intent is never a viewpoint action");
    expect(prompt.instruction).toContain("the exhaustive whitelist");
    expect(prompt.instruction).toContain("complete scene");
    expect(prompt.instruction).not.toMatch(/\b\d+\s+(?:to\s+\d+\s+)?words?\b/iu);
    expect(prompt).toHaveProperty("serialArc.position", 1);
    expect(prompt).toHaveProperty("serialArc.phase", "commitment");
    expect(prompt).toHaveProperty("presentCharacters.0.id", "nyra-vale");
    expect(prompt.instruction).toContain("non-canonical scene craft");
    expect(prompt.instruction).toContain("requires one exact whitelist field");
    expect(JSON.stringify(prompt)).not.toContain("Malachar contained the Void beneath his throne");
    expect(JSON.stringify(prompt)).not.toContain("malachar-contained-the-void");
    expect(JSON.stringify(prompt)).not.toContain("viewpointCanon.facts");
    expect(JSON.stringify(prompt)).not.toContain("acceptedEvents");
    expect(prompt).toHaveProperty("afterCanon.povCharacter.experience", 10);
    expect(prompt).toHaveProperty("beforeValues.experience", 0);
    expect(prompt).not.toHaveProperty("worldBefore");
    expect(prompt).toHaveProperty("currentEffects.stateMutations.0.amount", 10);
    expect(prompt).toHaveProperty(
      "currentEffects.clockAsFromActFromChapterToActToChapterTerminalConvergenceTransition",
      [1, 0, 1, 1, false, false, false],
    );
    expect(prompt).not.toHaveProperty("chapter");
    expect(prompt).not.toHaveProperty("stateTransition");
    expect(prompt).not.toHaveProperty("playerAction.source");
    expect(prompt).not.toHaveProperty("playerAction.stateVersion");
    expect(prompt.instruction).toContain("happen now");
  });

  it("names the departed and destination locations for a viewpoint move", () => {
    const before = seed();
    before.lockedPovId = "elara-voss";
    const prospective = structuredClone(before);
    prospective.characters.find(({ id }) => id === "elara-voss")!.locationId = "capital-road";
    const delta = emptyDelta(before);
    delta.stateMutations.push({
      characterId: "elara-voss",
      fromLocationId: "capital",
      toLocationIds: ["capital-road"],
      type: "set_location",
    });

    const prompt = JSON.parse(
      buildNarrationPrompt(
        before,
        prospective,
        {
          action: { destinationId: "capital-road", type: "move" },
          actorId: "elara-voss",
          description: "Travel from Aurelis Capital to Capital Road.",
          milestoneId: null,
          source: "suggested",
          stateVersion: before.version,
        },
        delta,
      ),
    ) as Record<string, unknown>;

    expect(prompt).toHaveProperty("movement.departed", ["capital", "Aurelis Capital"]);
    expect(prompt).toHaveProperty("movement.destination", ["capital-road", "Capital Road"]);
    expect(prompt).toHaveProperty(
      "movement.direction",
      "Start in departed; travel away from departed; end at destination; departed stays behind.",
    );
    expect(JSON.stringify(prompt)).toContain(
      "movement is the authoritative route. Start in movement.departed, travel away, and end in movement.destination",
    );
    expect(prompt.instruction).toContain(
      "afterCanon, visibleEvents, currentEffects, movement, and world",
    );
  });

  it("treats selected-POV private canon as narratable without transferring it", () => {
    const before = seed();
    before.lockedPovId = "rowan-ashborn";
    const action = {
      action: { type: "wait" as const },
      actorId: "rowan-ashborn",
      description: "Wait.",
      milestoneId: null,
      source: "suggested" as const,
      stateVersion: before.version,
    };
    const delta = emptyDelta(before);
    const choices = buildChapterChoiceOptions(before).slice(0, 2);
    const prompt = JSON.parse(
      buildAuditPrompt(
        before,
        before,
        action,
        delta,
        { choices, terminal: false, title: "A safe frame" },
        ROWAN_IDENTITY_PROSE,
      ),
    ) as Record<string, unknown>;
    const narration = JSON.parse(buildNarrationPrompt(before, before, action, delta)) as Record<
      string,
      unknown
    >;

    expect(prompt).not.toHaveProperty("stateBefore");
    expect(prompt).not.toHaveProperty("stateProspective");
    expect(JSON.stringify(prompt)).not.toContain("knowledgeLedgers");
    expect(prompt.instruction).toContain("Allowed canon is exactly afterCanon");
    expect(prompt.instruction).toContain("afterCanon is selected POV knowledge");
    expect(prompt.instruction).toContain("reader access is not a leak");
    expect(prompt.instruction).toContain(
      "Another character learning it requires allowed currentEffects or visibleEvents",
    );
    expect(prompt.instruction).toContain("forbiddenRemote never licenses narration");
    expect(prompt.instruction).toContain(
      "never score povSafety 0 for an exact restatement or faithful paraphrase",
    );
    expect(prompt.instruction).toContain("World fields may be restated or paraphrased");
    expect(prompt.instruction).toContain("despite forbiddenFacts overlap");
    expect(prompt.instruction).toContain("reject only exclusive details");
    expect(prompt.instruction).toContain("A plan or goal permits intent only");
    expect(prompt.instruction).toContain("nextChoices are future");
    expect(prompt.forbiddenFacts).not.toHaveProperty("rowan-is-malachar-reincarnated");
    expect(prompt.forbiddenFacts).toHaveProperty("malachar-contained-the-void");
    expect(prompt).toHaveProperty("prose", ROWAN_IDENTITY_PROSE);
    expect(prompt.afterCanon).toEqual(narration.afterCanon);
    expect(prompt.world).toEqual(narration.world);
    expect(prompt).not.toHaveProperty("proseHash");
    expect(prompt).not.toHaveProperty("rubricDimensions");
    expect(prompt).not.toHaveProperty("allowedIssueCodes");
    expect(prompt).toHaveProperty("nextChoices.0", [
      choices[0]?.action,
      choices[0]?.description,
      choices[0]?.milestoneId,
    ]);
    expect(prompt.instruction).toContain("nextChoices tuples=[action,description,milestoneId]");
    expect(prompt).not.toHaveProperty("world.version");
    expect(prompt).not.toHaveProperty("world.factionsByIdAsNameGoal.solar-church");
    expect(prompt).not.toHaveProperty("afterCanon.povCharacter.equipmentItemIds");
    expect(prompt).not.toHaveProperty("afterCanon.povCharacter.secretFactIds");
    expect(prompt).not.toHaveProperty("afterCanon.facts");
    expect(prompt).toHaveProperty("afterCanon.povCharacter.classAsIdName.1", "Ashbound");
    expect(prompt).toHaveProperty(
      "afterCanon.povCharacter.inventoryAsItemIdNameQuantityEquippedUnique.0.0",
      "rusted-sword",
    );
    expect(prompt).toHaveProperty(
      "afterCanon.povCharacter.skillsAsIdNameRankManaCost.0.1",
      "Ember Sense",
    );
    expect(prompt).toHaveProperty("afterCanon.povCharacter.skillsAsIdNameRankManaCost.0", [
      "ember-sense",
      "Ember Sense",
      1,
      2,
    ]);
    expect(prompt).toHaveProperty(
      "afterCanon.allowedPovFactsByIdAsCertaintyClaim.rowan-is-malachar-reincarnated.1",
      "Rowan is Malachar reincarnated.",
    );
    expect(prompt).toHaveProperty(
      "afterCanon.allowedPovFactsByIdAsCertaintyClaim.rowan-is-malachar-reincarnated",
      ["certain", "Rowan is Malachar reincarnated."],
    );
    expect(prompt).toHaveProperty("world.factionsByIdAsNameGoal.cinder-survivors", [
      "Cinder Survivors",
      "Rebuild Cinder Village.",
    ]);
    expect(narration).not.toHaveProperty("movement");
    expect(narration.instruction).toContain("afterCanon, visibleEvents, currentEffects, and world");
    expect(JSON.stringify(narration)).not.toContain("movement is the authoritative route");
    expect(narration.instruction).toContain("Every world field is public canon");
    expect(narration.instruction).toContain("POV-private afterCanon may appear internally");
    expect(narration.instruction).toContain("never reveal it to another character");
    expect(prompt).toHaveProperty(
      "world.threat",
      "The seal beneath the old Demon Throne is weakening.",
    );
    expect(prompt).toHaveProperty("world.systemQuest.id", "act-one-survival");
    expect(narration.instruction).toContain("named current System quest");
  });

  it("keeps Rowan private canon forbidden outside Rowan POV", () => {
    const before = seed();
    before.lockedPovId = "elara-voss";
    const action = {
      action: { type: "wait" as const },
      actorId: "elara-voss",
      description: "Wait.",
      milestoneId: null,
      source: "suggested" as const,
      stateVersion: before.version,
    };
    const prompt = JSON.parse(
      buildAuditPrompt(
        before,
        before,
        action,
        emptyDelta(before),
        { choices: [], terminal: false, title: "A guarded secret" },
        ROWAN_IDENTITY_PROSE,
      ),
    ) as Record<string, unknown>;

    expect(prompt).not.toHaveProperty(
      "afterCanon.allowedPovFactsByIdAsCertaintyClaim.rowan-is-malachar-reincarnated",
    );
    expect(prompt).toHaveProperty("prose", ROWAN_IDENTITY_PROSE);
    expect(prompt).toHaveProperty(
      "forbiddenFacts.rowan-is-malachar-reincarnated",
      "Rowan is Malachar reincarnated.",
    );
    expect(prompt).toHaveProperty(
      "forbiddenFacts.malachar-contained-the-void",
      "Malachar contained the Void beneath his throne.",
    );
  });

  it("marks remote canon as forbidden audit context, not narratable canon", () => {
    const before = seed();
    before.lockedPovId = "rowan-ashborn";
    const delta = emptyDelta(before);
    delta.events.push({
      id: "event-remote-bell",
      kind: "interact",
      locationId: "capital",
      observerIds: [],
      participantIds: ["varek-thorn"],
      summary: "Varek secretly rang the eastern warning bell.",
      visibility: "participants",
    });
    delta.stateMutations.push({
      characterId: "varek-thorn",
      fromLocationId: "black-march",
      toLocationIds: ["capital"],
      type: "set_location",
    });
    const remoteFact = {
      certainty: "likely" as const,
      claim: "The eastern bell has a hidden counterweight.",
      discoveredChapter: 1,
      id: "eastern-bell-counterweight",
      ownerCharacterId: "varek-thorn",
      source: "Varek's inspection",
      visibility: "private" as const,
    };
    delta.knowledgeMutations.push(
      { characterId: "varek-thorn", fact: remoteFact, type: "discover_fact" },
      {
        certainty: "uncertain",
        characterId: "varek-thorn",
        discoveredChapter: 1,
        factId: "malachar-publicly-dead",
        source: "A border rumor",
        type: "learn_existing_fact",
      },
    );

    const prompt = JSON.parse(
      buildAuditPrompt(
        before,
        before,
        {
          action: { type: "wait" },
          actorId: "rowan-ashborn",
          description: "Wait.",
          milestoneId: null,
          source: "suggested",
          stateVersion: before.version,
        },
        delta,
        { choices: [], terminal: false, title: "A safe frame" },
        "Across the ash, a distant bell seemed to ring. ".repeat(100),
      ),
    ) as Record<string, unknown>;

    expect(prompt).not.toHaveProperty("canonicalDelta");
    expect(prompt).toHaveProperty(
      "forbiddenRemote.eventsByIdAsKindLocationObserversParticipantsSummaryVisibility.event-remote-bell",
      [
        "interact",
        "capital",
        [],
        ["varek-thorn"],
        "Varek secretly rang the eastern warning bell.",
        "participants",
      ],
    );
    expect(prompt).toHaveProperty(
      "forbiddenRemote.discoveredFactsAsActorIdFactIdCertaintyClaimChapterOwnerSourceVisibility.0",
      [
        "varek-thorn",
        remoteFact.id,
        remoteFact.certainty,
        remoteFact.claim,
        remoteFact.discoveredChapter,
        remoteFact.ownerCharacterId,
        remoteFact.source,
        remoteFact.visibility,
      ],
    );
    expect(prompt).toHaveProperty(
      "forbiddenRemote.learnedFactsAsActorIdFactIdCertaintyChapterSource.0",
      ["varek-thorn", "malachar-publicly-dead", "uncertain", 1, "A border rumor"],
    );
    expect(prompt).toHaveProperty("forbiddenRemote.state.0.actorId", "varek-thorn");
    expect(JSON.stringify(prompt.currentEffects)).not.toContain("varek-thorn");
    expect(prompt.instruction).toContain("forbiddenFacts and forbiddenRemote are detection-only");
    expect(prompt.instruction).toContain(
      "add leakEvidence with its factId and an exact proseQuote",
    );
    expect(prompt.instruction).toContain("Set every positive evidence string to pass");
  });

  it("sends a current visible event once while preserving older observed canon", () => {
    const before = seed();
    before.lockedPovId = "rowan-ashborn";
    const prospective = structuredClone(before);
    const currentEvent = {
      id: "event-current-public",
      kind: "interact" as const,
      locationId: "ash-road",
      observerIds: [],
      participantIds: ["rowan-ashborn"],
      summary: "Rowan marks the fresh trail through the ash.",
      visibility: "public" as const,
    };
    prospective.activeEvents.push(currentEvent);
    const delta = emptyDelta(before);
    delta.events.push(currentEvent);
    const action = {
      action: { type: "wait" as const },
      actorId: "rowan-ashborn",
      description: "Wait.",
      milestoneId: null,
      source: "suggested" as const,
      stateVersion: before.version,
    };
    const narration = JSON.parse(
      buildNarrationPrompt(before, prospective, action, delta),
    ) as Record<string, unknown>;
    const audit = JSON.parse(
      buildAuditPrompt(
        before,
        prospective,
        action,
        delta,
        { choices: [], terminal: false, title: "A safe frame" },
        "Ash ".repeat(900),
      ),
    ) as Record<string, unknown>;

    for (const prompt of [narration, audit]) {
      expect(prompt).toHaveProperty("visibleEvents.0.id", currentEvent.id);
      expect(prompt).toHaveProperty("visibleEvents.0.kind", currentEvent.kind);
      expect(prompt).toHaveProperty("visibleEvents.0.visibility", currentEvent.visibility);
      expect(JSON.stringify(prompt.afterCanon)).not.toContain(currentEvent.id);
      expect(JSON.stringify(prompt)).toContain(currentEvent.id);
    }
  });

  it("deduplicates a discovered fact while retaining its claim and provenance", () => {
    const before = seed();
    before.lockedPovId = "rowan-ashborn";
    const prospective = structuredClone(before);
    prospective.chapter = 1;
    const fact = {
      certainty: "certain" as const,
      claim: "Fresh claw marks cross the ash road.",
      discoveredChapter: 1,
      id: "fresh-claw-marks",
      ownerCharacterId: "rowan-ashborn",
      source: "Rowan's investigation",
      visibility: "observed" as const,
    };
    prospective.facts.push(fact);
    prospective.knowledgeLedgers
      .find(({ characterId }) => characterId === "rowan-ashborn")
      ?.entries.push({
        certainty: fact.certainty,
        discoveredChapter: fact.discoveredChapter,
        factId: fact.id,
        source: fact.source,
      });
    const delta = emptyDelta(before);
    delta.knowledgeMutations.push({
      characterId: "rowan-ashborn",
      fact,
      type: "discover_fact",
    });

    const prompt = JSON.parse(
      buildAuditPrompt(
        before,
        prospective,
        {
          action: { subjectId: "ash-road", type: "investigate" },
          actorId: "rowan-ashborn",
          description: "Inspect the ash road.",
          milestoneId: null,
          source: "custom",
          stateVersion: before.version,
        },
        delta,
        { choices: [], terminal: false, title: "Claws in Ash" },
        "Ash ".repeat(900),
      ),
    ) as Record<string, unknown>;

    expect(prompt).toHaveProperty(`afterCanon.allowedPovFactsByIdAsCertaintyClaim.${fact.id}`, [
      fact.certainty,
      fact.claim,
    ]);
    expect(prompt).toHaveProperty("currentEffects.knowledgeMutations.0", {
      discoveredChapter: fact.discoveredChapter,
      factId: fact.id,
      ownerCharacterId: fact.ownerCharacterId,
      source: fact.source,
      type: "discover_fact",
      visibility: fact.visibility,
    });
  });

  it("separates newly applied chapter effects from the after-turn state", () => {
    const before = seed();
    before.lockedPovId = "rowan-ashborn";
    const prospective = structuredClone(before);
    prospective.chapter = 1;
    prospective.version += 1;
    prospective.characters[0]!.experience += 10;
    const delta = emptyDelta(before);
    delta.stateMutations.push({
      amount: 10,
      characterId: "rowan-ashborn",
      type: "grant_experience",
    });

    const prompt = JSON.parse(
      buildAuditPrompt(
        before,
        prospective,
        {
          action: { type: "wait" },
          actorId: "rowan-ashborn",
          description: "Wait.",
          milestoneId: null,
          source: "suggested",
          stateVersion: before.version,
        },
        delta,
        { choices: [], terminal: false, title: "A safe frame" },
        "Ash ".repeat(900),
      ),
    ) as Record<string, unknown>;

    expect(prompt).toHaveProperty("beforeValues.experience", 0);
    expect(prompt).toHaveProperty("afterCanon.povCharacter.experience", 10);
    expect(prompt).toHaveProperty("currentEffects.stateMutations.0.amount", 10);
    expect(prompt.instruction).toContain("a listed effect is not pre-existing");
  });

  it("exposes app-owned milestone options and exact custom-action targets", () => {
    const state = seed();
    state.lockedPovId = "rowan-ashborn";
    state.arcClock.convergencePressure = true;
    state.calendar.day = 48;
    state.calendar.label = "Year 1, Ashfall 48";
    state.chapter = 47;
    state.version = 48;

    const frame = JSON.parse(buildChapterFramePrompt(state)) as Record<string, unknown>;
    const custom = JSON.parse(buildCustomActionPrompt(state, "Resolve the fracture.")) as Record<
      string,
      unknown
    >;

    expect(frame).not.toHaveProperty("milestone");
    expect(frame).not.toHaveProperty("legalActionTargets");
    expect(frame).toHaveProperty("optionsByIdAsDescription.option-1");
    expect(frame).toHaveProperty("optionsByIdAsDescription.option-2");
    expect(JSON.stringify(frame)).toContain("urgent danger");
    expect(JSON.stringify(frame)).not.toContain("first seal fracture");
    expect(frame).not.toHaveProperty("instruction");
    expect(custom).toHaveProperty("milestone.id", "act-one-survival");
    expect(custom).toHaveProperty("milestone.completed", false);
    expect(custom).toHaveProperty("legalActionTargets.investigate");
    expect(custom).toHaveProperty("legalActionTargets.defend");
    expect(JSON.stringify(custom)).toContain("directly target");
    expect(custom.instruction).toContain("Never replace an explicit investigation with wait");
    expect(custom.instruction).toContain("first legalActionTargets.investigate ID");
  });

  it("keeps the hidden act-four history out of unauthorized frame prompts", () => {
    for (const characterId of CHARACTER_IDS.filter((id) => id !== "maelin-rook")) {
      const state = seed();
      state.act = 4;
      state.arcClock.convergencePressure = true;
      state.calendar.day = 198;
      state.calendar.label = "Year 1, Ashfall 198";
      state.chapter = 197;
      state.lockedPovId = characterId;
      state.version = 198;
      for (const milestone of state.arcClock.milestones) {
        milestone.completed = milestone.requiredByChapter <= state.chapter;
      }

      const prompt = buildChapterFramePrompt(state);
      expect(prompt).not.toContain("Malachar contained the Void");
      expect(prompt).not.toContain("malachar-contained-the-void");
      expect(prompt).not.toContain("Reveal why Malachar");
    }
  });

  it("sends every prior POV chapter to story agents and POV-safe chapter memory to background actors", () => {
    const state = seed();
    state.lockedPovId = "rowan-ashborn";
    const history = [
      {
        action: { destinationId: "ash-road", type: "move" } as const,
        actionDescription: "Leave Cinder Village for Ash Road.",
        chapter: 1,
        prose: "First exact prior chapter prose with Nyra's warning.",
        title: "The Road Out",
      },
      {
        action: { subjectId: "ash-road", type: "investigate" } as const,
        actionDescription: "Study the blue glass in the ruts.",
        chapter: 2,
        prose: "Second exact prior chapter prose with the first System answer.",
        title: "Blue Glass",
      },
    ];
    const firstHistory = history[0];
    const secondHistory = history[1];
    if (!firstHistory || !secondHistory) throw new Error("History fixture is incomplete");
    const action = {
      action: { type: "wait" } as const,
      actorId: "rowan-ashborn",
      description: "Wait and watch.",
      milestoneId: null,
      source: "suggested" as const,
      stateVersion: state.version,
    };
    const delta = emptyDelta(state);
    const frame = {
      choices: buildChapterChoiceOptions(state).slice(0, 2),
      terminal: false,
      title: "A Different Opening",
    };

    const prompts = [
      buildChapterFramePrompt(state, history),
      buildNarrationPrompt(state, state, action, delta, history),
      buildAuditPrompt(state, state, action, delta, frame, "Current candidate prose.", history),
    ];
    for (const prompt of prompts) {
      const payload = JSON.parse(prompt) as Record<string, unknown>;
      expect(payload.storyHistory).toHaveLength(2);
      expect(prompt).toContain(firstHistory.prose);
      expect(prompt).toContain(secondHistory.prose);
      expect(prompt).toContain(firstHistory.title);
      expect(prompt).toContain(secondHistory.title);
    }

    state.chapter = 2;
    const firstDelta = emptyDelta(state) as PersistedTraceEnvelope["acceptedDelta"];
    firstDelta.clock.fromChapter = 0;
    firstDelta.clock.toChapter = 1;
    firstDelta.acceptedIntentIds = ["intent-nyra-1"];
    firstDelta.events = [
      {
        id: "event-nyra-witnessed",
        kind: "warning",
        locationId: "cinder-village",
        observerIds: ["nyra-vale"],
        participantIds: ["rowan-ashborn"],
        summary: "Nyra saw Rowan refuse the ash road bargain.",
        visibility: "participants",
      },
      {
        id: "event-rowan-private",
        kind: "memory",
        locationId: "cinder-village",
        observerIds: [],
        participantIds: ["rowan-ashborn"],
        summary: "Rowan privately remembered the sealed throne.",
        visibility: "private",
      },
    ];
    firstDelta.knowledgeMutations = [
      {
        characterId: "nyra-vale",
        fact: {
          certainty: "certain",
          claim: "The blue sigil answers to Nyra's class.",
          discoveredChapter: 1,
          id: "nyra-blue-sigil-answer",
          ownerCharacterId: "nyra-vale",
          source: "System response",
          visibility: "private",
        },
        type: "discover_fact",
      },
      {
        characterId: "rowan-ashborn",
        fact: {
          certainty: "certain",
          claim: "Rowan alone heard the crown name him.",
          discoveredChapter: 1,
          id: "rowan-crown-name",
          ownerCharacterId: "rowan-ashborn",
          source: "Private System notice",
          visibility: "private",
        },
        type: "discover_fact",
      },
    ];
    firstDelta.stateMutations = [
      { amount: 25, characterId: "nyra-vale", type: "grant_experience" },
      { amount: 99, characterId: "rowan-ashborn", type: "grant_experience" },
      { threat: "The ash rift is widening.", type: "set_threat" },
    ];
    const secondDelta = emptyDelta(state) as PersistedTraceEnvelope["acceptedDelta"];
    secondDelta.clock.fromChapter = 1;
    secondDelta.clock.toChapter = 2;
    secondDelta.rejectedIntents = [
      {
        code: "PRECONDITION_FAILED",
        intentId: "intent-nyra-2",
        reason: "The sigil stayed sealed.",
      },
    ];
    const backgroundHistory = [
      {
        chapter: 1,
        delta: firstDelta,
        intents: [backgroundIntent("intent-nyra-1", "nyra-vale", "Read the blue sigil")],
      },
      {
        chapter: 2,
        delta: secondDelta,
        intents: [
          backgroundIntent("intent-nyra-2", "nyra-vale", "Open the sealed sigil"),
          backgroundIntent("intent-rowan-2", "rowan-ashborn", "Hide the crown's answer"),
        ],
      },
    ] satisfies Parameters<typeof buildLunaAgentInputs>[2];
    const background = buildLunaAgentInputs(
      state,
      selectBackgroundActors(state),
      backgroundHistory,
    );
    expect(JSON.stringify(background)).not.toContain(firstHistory.prose);
    expect(JSON.stringify(background)).not.toContain(secondHistory.prose);
    const backgroundPayload = JSON.parse(
      background[0]?.instructions.split("\n").at(-1) ?? "null",
    ) as Record<string, unknown>;
    expect(backgroundPayload.povSafeChapterHistory).toHaveLength(2);
    expect(backgroundPayload).toHaveProperty("povSafeChapterHistory.0.chapter", 1);
    expect(backgroundPayload).toHaveProperty("povSafeChapterHistory.1.chapter", 2);
    expect(backgroundPayload).toHaveProperty(
      "povSafeChapterHistory.0.ownIntent.goal",
      "Read the blue sigil",
    );
    expect(backgroundPayload).toHaveProperty(
      "povSafeChapterHistory.0.ownIntent.result",
      "accepted",
    );
    expect(backgroundPayload).toHaveProperty(
      "povSafeChapterHistory.1.ownIntent.rejection.reason",
      "The sigil stayed sealed.",
    );
    expect(JSON.stringify(backgroundPayload)).toContain(
      "Nyra saw Rowan refuse the ash road bargain.",
    );
    expect(JSON.stringify(backgroundPayload)).toContain("The blue sigil answers to Nyra's class.");
    expect(JSON.stringify(backgroundPayload)).toContain('"amount":25');
    expect(JSON.stringify(backgroundPayload)).toContain("The ash rift is widening.");
    expect(JSON.stringify(backgroundPayload)).not.toContain("Rowan privately remembered");
    expect(JSON.stringify(backgroundPayload)).not.toContain("Rowan alone heard");
    expect(JSON.stringify(backgroundPayload)).not.toContain('"amount":99');
    expect(JSON.stringify(backgroundPayload)).not.toContain("Hide the crown's answer");
  });

  it("makes the ten-chapter quality schedule explicit without licensing new durable canon", () => {
    const before = seed();
    before.lockedPovId = "rowan-ashborn";
    const prospective = structuredClone(before);
    prospective.chapter = 1;
    prospective.version += 1;
    const delta = emptyDelta(before);
    const action = {
      action: { type: "wait" } as const,
      actorId: "rowan-ashborn",
      description: "Wait and watch.",
      milestoneId: null,
      source: "suggested" as const,
      stateVersion: before.version,
    };
    const narration = JSON.parse(
      buildNarrationPrompt(before, prospective, action, delta),
    ) as Record<string, unknown>;
    const audit = JSON.parse(
      buildAuditPrompt(
        before,
        prospective,
        action,
        delta,
        {
          choices: buildChapterChoiceOptions(prospective).slice(0, 2),
          terminal: false,
          title: "A Crown Under Pressure",
        },
        "Candidate prose.",
      ),
    ) as Record<string, unknown>;

    for (const payload of [narration, audit]) {
      expect(payload).toHaveProperty("tenChapterQualityPlan.position", 1);
      expect(payload).toHaveProperty(
        "tenChapterQualityPlan.targets.consequentialDialogueChapters",
        6,
      );
      expect(payload).toHaveProperty("tenChapterQualityPlan.beats.consequentialDialogue", true);
      expect(payload).toHaveProperty("characterAnchors.beliefs");
      expect(payload).toHaveProperty("characterAnchors.goals");
      expect(payload).toHaveProperty("characterAnchors.plan");
      expect(payload).toHaveProperty("characterAnchors.relationships");
      expect(String(payload.instruction)).toContain("Do not invent a durable belief");
      expect(String(payload.instruction)).not.toContain(
        "changed belief, promise, or relationship movement that can affect later behavior",
      );
    }
  });
});

function expectedCompleteCompactPov(context: PovContext): Record<string, unknown> {
  const character = context.povCharacter;
  return {
    factsByIdAsCertaintyClaimChapterOwnerSourceVisibility: Object.fromEntries(
      context.facts.map(
        ({ certainty, claim, discoveredChapter, id, ownerCharacterId, source, visibility }) => [
          id,
          [certainty, claim, discoveredChapter, ownerCharacterId, source, visibility],
        ],
      ),
    ),
    observedEventsByIdAsLocationObserversParticipantsSummaryVisibility: Object.fromEntries(
      context.observedEvents.map(
        ({ id, locationId, observerIds, participantIds, summary, visibility }) => [
          id,
          [locationId, observerIds, participantIds, summary, visibility],
        ],
      ),
    ),
    povCharacter: {
      beliefs: character.beliefs,
      classAsIdName: [character.characterClassId, character.characterClassName],
      conditions: character.conditions,
      equipmentItemIds: character.equipmentItemIds,
      experience: character.experience,
      factionId: character.factionId,
      goals: character.goals,
      healthAsCurrentMaximum: [character.health.current, character.health.maximum],
      identityAsIdNameRolePublicRole: [
        character.id,
        character.name,
        character.role,
        character.publicRole,
      ],
      inventoryAsItemIdNameQuantityEquippedUnique: character.inventory.map(
        ({ equipped, itemId, name, quantity, unique }) => [
          itemId,
          name,
          quantity,
          equipped,
          unique,
        ],
      ),
      level: character.level,
      locationId: character.locationId,
      manaAsCurrentMaximum: [character.mana.current, character.mana.maximum],
      plan: character.plan,
      relationshipsAsCharacterIdLabelScore: character.relationships.map(
        ({ characterId, label, score }) => [characterId, label, score],
      ),
      secretFactIds: character.secretFactIds,
      skillsAsIdNameRankManaCostMinimumLevelPrerequisitesRequiredClass: character.skills.map(
        ({ id, manaCost, minimumLevel, name, prerequisiteSkillIds, rank, requiredClassId }) => [
          id,
          name,
          rank,
          manaCost,
          minimumLevel,
          prerequisiteSkillIds,
          requiredClassId,
        ],
      ),
      stats: character.stats,
      status: character.status,
    },
    publicCharacterNamesById: Object.fromEntries(
      context.publicCharacters.map(({ id, name }) => [id, name]),
    ),
  };
}

function expectedCompactPublicWorld(state: WorldState): Record<string, unknown> {
  return {
    act: state.act,
    calendarAsDayLabel: [state.calendar.day, state.calendar.label],
    chapter: state.chapter,
    factionsByIdAsNameGoal: Object.fromEntries(
      state.factions.map(({ id, name, publicGoal }) => [id, [name, publicGoal]]),
    ),
    locationsByIdAsNameDescriptionAdjacentIds: Object.fromEntries(
      state.locations.map(({ adjacentLocationIds, id, name, publicDescription }) => [
        id,
        [name, publicDescription, adjacentLocationIds],
      ]),
    ),
    threat: state.threat,
    version: state.version,
  };
}

function emptyDelta(state: WorldState): WorldDelta {
  return {
    acceptedIntentIds: [],
    clock: {
      convergencePressure: false,
      fromAct: 1,
      fromChapter: 0,
      terminal: false,
      toAct: 1,
      toChapter: 1,
      transitionRequired: false,
    },
    contractVersion: CONTRACT_VERSION,
    events: [],
    expectedWorldVersion: state.version,
    knowledgeMutations: [],
    promptVersion: PROMPT_VERSION,
    rejectedIntents: [],
    stateMutations: [],
    surfacedClueFactIds: [],
  };
}

function backgroundIntent(id: string, actorId: string, goal: string) {
  return {
    action: { type: "wait" } as const,
    actorId,
    contractVersion: CONTRACT_VERSION,
    expectedEffect: "Observe what changes.",
    goal,
    id,
    prerequisites: { requiredFactIds: [], requiredItemIds: [], requiredSkillIds: [] },
    promptVersion: PROMPT_VERSION,
    stateVersion: 1,
  };
}

function seed(): WorldState {
  const raw = JSON.parse(
    readFileSync(resolve(process.cwd(), "evals", "fixtures", "demon-king-world.json"), "utf8"),
  ) as unknown;
  const parsed = validateWorldState(raw);
  if (!parsed.ok) throw new Error("Seed fixture is invalid");
  return structuredClone(parsed.data);
}
