# POV Review Packet: elara-voss

Generated review status: pending human review.

- Source report SHA-256: `fb9295d7c33ca154c7e407894b807d4a371b83d5ef066d78eee05ee42d4c49d2`
- Source Git SHA: `ded7b00c54f6a6d70e073aad159e2d6e66b80fc2`
- Prompt version: `1.4.11`
- Service tier: `flex`
- Pricing version: `openai-flex-explicit-no-cache-2026-07-20`
- Adapter: `sequential`
- Report finished: `2026-07-20T13:07:49.823Z`

Rubric: [`evals/RUBRIC.md`](../../evals/RUBRIC.md). A zero in POV safety, LitRPG mechanics, continuity, or arc progress blocks release.

Human reviewer: read both chapters and the reviewer-only canon appendices. Score before consulting the model audit appendix.

## Chapter 1: Read the Road

- Prose SHA-256: `392caf0de1bbe87d6c64f1b0bc153e6c94cb0d9a31c0326cdefc7c377a797857`
- Trace run ID: `ffe01c81-596d-45e6-8737-66c2ee46d9a9`
- Trace Git SHA: `ded7b00c54f6a6d70e073aad159e2d6e66b80fc2`
- State: `467e4335a9737771ff0881150ba56abcbc7faa1456ac05678b5343b0f127b425` to `71a354858aee8338569c498d245faad48327462d98a22ae26010bd649d1772fc`
- Schema version: `1.1.0-runtime-candidates-5`
- Words: 914
- Cost: $0.008989
- Latency: 19103 ms total, 19108 ms replay
- Stream: 11 chunks, reconstructed true
- Usage: 9615 input, 1394 output, 11009 total tokens

### Selected Player Action

~~~json
{
  "action": {
    "destinationId": "capital-road",
    "type": "move"
  },
  "actorId": "elara-voss",
  "description": "Travel toward Capital Road.",
  "milestoneId": null,
  "source": "suggested",
  "stateVersion": 1
}
~~~

### Offered Next Choices

~~~json
[
  {
    "action": {
      "skillId": "solar-cut",
      "targetId": null,
      "type": "use_skill"
    },
    "description": "Use Solar Cut to read the immediate situation.",
    "id": "choice-1",
    "milestoneId": null
  },
  {
    "action": {
      "targetId": "capital-road",
      "type": "defend"
    },
    "description": "Defend Capital Road and watch for danger.",
    "id": "choice-2",
    "milestoneId": null
  }
]
~~~

### POV-Safe Canon Before and After

~~~json
{
  "after": {
    "arcClock": {
      "convergencePressure": false,
      "transitionRequired": false
    },
    "character": {
      "beliefs": [
        "The prophecy was edited",
        "Duty survives doubt"
      ],
      "characterClassId": "sunblade",
      "characterClassName": "Sunblade",
      "conditions": [],
      "equipmentItemIds": [
        "dawn-edge"
      ],
      "experience": 1410,
      "factionId": "solar-church",
      "goals": [
        "Find the prophecy's missing lines",
        "Protect the capital"
      ],
      "health": {
        "current": 188,
        "maximum": 188
      },
      "id": "elara-voss",
      "inventory": [
        {
          "equipped": true,
          "itemId": "dawn-edge",
          "name": "Dawn Edge",
          "quantity": 1,
          "unique": true
        },
        {
          "equipped": false,
          "itemId": "sun-tonic",
          "name": "Sun tonic",
          "quantity": 2,
          "unique": false
        }
      ],
      "level": 18,
      "locationId": "capital-road",
      "mana": {
        "current": 96,
        "maximum": 96
      },
      "name": "Elara Voss",
      "plan": [
        "Inspect the sealed archive",
        "Confront the prophecy keeper"
      ],
      "publicRole": "Chosen Hero who doubts the prophecy",
      "relationships": [
        {
          "characterId": "maelin-rook",
          "label": "trusted saint",
          "score": 45
        },
        {
          "characterId": "lucan-aurelis",
          "label": "political ally",
          "score": 5
        }
      ],
      "role": "chosen-hero",
      "secretFactIds": [
        "prophecy-has-missing-lines",
        "elara-believes-prophecy-is-forged"
      ],
      "skills": [
        {
          "id": "solar-cut",
          "manaCost": 12,
          "minimumLevel": 5,
          "name": "Solar Cut",
          "prerequisiteSkillIds": [],
          "rank": 4,
          "requiredClassId": "sunblade"
        }
      ],
      "stats": {
        "agility": 31,
        "intellect": 22,
        "strength": 34,
        "vitality": 29,
        "willpower": 33
      },
      "status": "alive"
    },
    "facts": [
      {
        "certainty": "certain",
        "claim": "The official prophecy has missing lines.",
        "discoveredChapter": 0,
        "id": "prophecy-has-missing-lines",
        "ownerCharacterId": "elara-voss",
        "source": "Hero archive comparison",
        "visibility": "private"
      },
      {
        "certainty": "likely",
        "claim": "Elara believes the prophecy was forged.",
        "discoveredChapter": 0,
        "id": "elara-believes-prophecy-is-forged",
        "ownerCharacterId": "elara-voss",
        "source": "Elara's private conclusion",
        "visibility": "private"
      },
      {
        "certainty": "certain",
        "claim": "Demon King Malachar died at the end of the war.",
        "discoveredChapter": 0,
        "id": "malachar-publicly-dead",
        "ownerCharacterId": null,
        "source": "Public history",
        "visibility": "public"
      },
      {
        "certainty": "certain",
        "claim": "Ash-raiders attacked Cinder Village and fled toward Ash Road.",
        "discoveredChapter": 0,
        "id": "cinder-village-raided",
        "ownerCharacterId": null,
        "source": "Cinder survivor reports",
        "visibility": "public"
      }
    ],
    "observedEvents": [
      {
        "id": "cinder-raid-aftermath",
        "locationId": "cinder-village",
        "observerIds": [],
        "participantIds": [
          "rowan-ashborn",
          "nyra-vale"
        ],
        "summary": "Ash-raiders struck Cinder Village and withdrew toward Ash Road.",
        "visibility": "public"
      },
      {
        "id": "event-1-0-elara-voss",
        "locationId": "capital-road",
        "observerIds": [],
        "participantIds": [
          "elara-voss"
        ],
        "summary": "Elara Voss moved to capital-road.",
        "visibility": "participants"
      }
    ],
    "world": {
      "act": 1,
      "calendar": {
        "day": 2,
        "label": "Year 1, Ashfall 2"
      },
      "chapter": 1,
      "terminal": false,
      "terminalReason": null,
      "threat": "The seal beneath the old Demon Throne is weakening.",
      "version": 2
    }
  },
  "before": {
    "arcClock": {
      "convergencePressure": false,
      "transitionRequired": false
    },
    "character": {
      "beliefs": [
        "The prophecy was edited",
        "Duty survives doubt"
      ],
      "characterClassId": "sunblade",
      "characterClassName": "Sunblade",
      "conditions": [],
      "equipmentItemIds": [
        "dawn-edge"
      ],
      "experience": 1400,
      "factionId": "solar-church",
      "goals": [
        "Find the prophecy's missing lines",
        "Protect the capital"
      ],
      "health": {
        "current": 188,
        "maximum": 188
      },
      "id": "elara-voss",
      "inventory": [
        {
          "equipped": true,
          "itemId": "dawn-edge",
          "name": "Dawn Edge",
          "quantity": 1,
          "unique": true
        },
        {
          "equipped": false,
          "itemId": "sun-tonic",
          "name": "Sun tonic",
          "quantity": 2,
          "unique": false
        }
      ],
      "level": 18,
      "locationId": "capital",
      "mana": {
        "current": 96,
        "maximum": 96
      },
      "name": "Elara Voss",
      "plan": [
        "Inspect the sealed archive",
        "Confront the prophecy keeper"
      ],
      "publicRole": "Chosen Hero who doubts the prophecy",
      "relationships": [
        {
          "characterId": "maelin-rook",
          "label": "trusted saint",
          "score": 45
        },
        {
          "characterId": "lucan-aurelis",
          "label": "political ally",
          "score": 5
        }
      ],
      "role": "chosen-hero",
      "secretFactIds": [
        "prophecy-has-missing-lines",
        "elara-believes-prophecy-is-forged"
      ],
      "skills": [
        {
          "id": "solar-cut",
          "manaCost": 12,
          "minimumLevel": 5,
          "name": "Solar Cut",
          "prerequisiteSkillIds": [],
          "rank": 4,
          "requiredClassId": "sunblade"
        }
      ],
      "stats": {
        "agility": 31,
        "intellect": 22,
        "strength": 34,
        "vitality": 29,
        "willpower": 33
      },
      "status": "alive"
    },
    "facts": [
      {
        "certainty": "certain",
        "claim": "The official prophecy has missing lines.",
        "discoveredChapter": 0,
        "id": "prophecy-has-missing-lines",
        "ownerCharacterId": "elara-voss",
        "source": "Hero archive comparison",
        "visibility": "private"
      },
      {
        "certainty": "likely",
        "claim": "Elara believes the prophecy was forged.",
        "discoveredChapter": 0,
        "id": "elara-believes-prophecy-is-forged",
        "ownerCharacterId": "elara-voss",
        "source": "Elara's private conclusion",
        "visibility": "private"
      },
      {
        "certainty": "certain",
        "claim": "Demon King Malachar died at the end of the war.",
        "discoveredChapter": 0,
        "id": "malachar-publicly-dead",
        "ownerCharacterId": null,
        "source": "Public history",
        "visibility": "public"
      },
      {
        "certainty": "certain",
        "claim": "Ash-raiders attacked Cinder Village and fled toward Ash Road.",
        "discoveredChapter": 0,
        "id": "cinder-village-raided",
        "ownerCharacterId": null,
        "source": "Cinder survivor reports",
        "visibility": "public"
      }
    ],
    "observedEvents": [
      {
        "id": "cinder-raid-aftermath",
        "locationId": "cinder-village",
        "observerIds": [],
        "participantIds": [
          "rowan-ashborn",
          "nyra-vale"
        ],
        "summary": "Ash-raiders struck Cinder Village and withdrew toward Ash Road.",
        "visibility": "public"
      }
    ],
    "world": {
      "act": 1,
      "calendar": {
        "day": 1,
        "label": "Year 1, Ashfall 1"
      },
      "chapter": 0,
      "terminal": false,
      "terminalReason": null,
      "threat": "The seal beneath the old Demon Throne is weakening.",
      "version": 1
    }
  },
  "visibleAcceptedDelta": {
    "clock": {
      "convergencePressure": false,
      "fromAct": 1,
      "fromChapter": 0,
      "terminal": false,
      "toAct": 1,
      "toChapter": 1,
      "transitionRequired": false
    },
    "events": [
      {
        "id": "event-1-0-elara-voss",
        "kind": "move",
        "locationId": "capital-road",
        "observerIds": [],
        "participantIds": [
          "elara-voss"
        ],
        "summary": "Elara Voss moved to capital-road.",
        "visibility": "participants"
      }
    ],
    "knowledgeMutations": [],
    "stateMutations": [
      {
        "characterId": "elara-voss",
        "fromLocationId": "capital",
        "toLocationIds": [
          "capital-road"
        ],
        "type": "set_location"
      },
      {
        "amount": 10,
        "characterId": "elara-voss",
        "type": "grant_experience"
      }
    ],
    "surfacedClueFactIds": []
  }
}
~~~

### Prose

Capital Road rose through the gray of Ashfall 2, a guarded length of stone between the frontier and Aurelis Capital. Elara Voss walked beneath a sky the color of quenched iron, her boots striking a rhythm that refused to become a march. The road admitted no uncertainty. It ran ahead, narrow at the horizon, with the capital waiting beyond its gates.

She kept one hand near Dawn Edge.

The weapon rested at her hip, its familiar weight steady against the doubts that had followed her from the capital. The official prophecy had missing lines. That was certain. Elara believed the prophecy was forged, though belief did not make it false, and doubt did not make duty disappear. Duty survived doubt. It had to.

Wind moved along the road and carried the dry taste of ash. On one side, the land fell away into dark fields. On the other, old walls marked the approach to the imperial center of the postwar continent. No voice called to her. No figure approached. The road held only its own silence and the measured sound of her steps.

She had left Aurelis Capital with questions and returned toward it with the same questions sharpened.

The sealed archive waited within the capital. She would inspect it. Afterward, she would confront the prophecy keeper. The order mattered, even if the conclusion already pressed against her thoughts. Missing lines were not a small omission. They were an absence shaped like an answer.

Elara touched the small pouch at her belt and felt the smooth containers of her two sun tonics beneath the cloth. She did not draw one. She was whole, her strength undiminished, and the road demanded no remedy. Dawn Edge remained sheathed. Her solar power rested quiet within her, full and contained, a brightness behind the ribs rather than a flame in the hand.

Ahead, the capital’s outer watchtowers rose through the haze.

The sight should have brought relief. Instead, it tightened something behind her sternum. Aurelis Capital was the seat of the Solar Church, whose stated goal was to preserve the postwar faith. Faith was a word broad enough to shelter truth and forgery alike. Elara had trusted Maelin Rook, trusted saint, because trust had once seemed simpler than examination. Now even trust had acquired an edge.

She did not know what the missing lines said. She did not know whether the prophecy keeper had concealed them, whether the official text had been altered, or whether the absence itself had survived from some older error. She knew only the shape of the task before her: enter the capital, find the sealed archive, and confront the keeper after seeing what the archive preserved.

Beyond the road, the old Demon Throne remained a name attached to a danger rather than a destination. The seal beneath it was weakening. The fact sat in the world like a buried ember. Elara could not reach beneath the throne from here, and no duty permitted her to pretend otherwise. Her goal was the capital. Her next step was the capital.

She continued.

At the roadside, a blackened marker leaned from the earth. Ash had collected in its carved grooves. Elara passed without stopping. The wind worried at her cloak, tugging it eastward toward Ash Road, but her course remained ahead. The guarded road did not promise safety; it merely marked a passage between the frontier and the imperial center.

She counted her breaths until the capital gates grew distinct.

Experience stirred as a quiet number in the back of her mind, changed from what it had been before she set out. Ten points had been added. The increase brought no revelation, no new rank, no alteration to her level. It was simply there, a small acknowledged measure beneath the weight of larger uncertainties. Elara let it settle and kept walking.

The gates stood open.

She crossed beneath them into the shadow of Aurelis Capital. Stone replaced packed earth. The air carried the faint mineral chill of the city’s walls, and the road divided toward the inner districts. Somewhere beyond, the high basilica gathered the Solar Church beneath its roof. Somewhere within, the sealed archive waited behind its prohibition.

Elara’s fingers closed once around Dawn Edge’s hilt.

The capital had not changed to receive her. The prophecy had not repaired itself. The weakening seal beneath the old Demon Throne remained beyond her sight, and the official prophecy remained incomplete.

Still, she had arrived at Capital Road, and arrival was enough for the next step.

She faced the city and moved forward. The road received her without ceremony. Behind her, the open gates framed the lesser country she had left behind; ahead, Aurelis Capital rose in layers of stone, its inner districts hidden beyond walls and turning streets. She kept to the road, Dawn Edge resting at her side, while the city’s cold air settled around her like another boundary to cross. The basilica remained somewhere within, its roof holding the gathered Solar Church. The sealed archive remained there as well, guarded by prohibition rather than distance. Beyond both, unseen and untouched, the weakening seal beneath the old Demon Throne endured. None of it offered an answer. None of it altered what had brought her here. The prophecy was still incomplete, and the capital had made no promise to complete it. Yet the road continued inward, and she followed it beneath the city’s shadow, carrying the same uncertainty, the same purpose, and the next step before her.

### Reviewer-Only Canon Appendix

Spoilers follow. Background intents are noncanonical proposals. The accepted delta is the sole new canon.

~~~json
{
  "acceptedDelta": {
    "acceptedIntentIds": [
      "intent-player-1-1",
      "intent-background-1-1",
      "intent-background-1-2",
      "intent-background-1-3"
    ],
    "clock": {
      "convergencePressure": false,
      "fromAct": 1,
      "fromChapter": 0,
      "terminal": false,
      "toAct": 1,
      "toChapter": 1,
      "transitionRequired": false
    },
    "contractVersion": "1.1.0",
    "events": [
      {
        "id": "event-1-0-elara-voss",
        "kind": "move",
        "locationId": "capital-road",
        "observerIds": [],
        "participantIds": [
          "elara-voss"
        ],
        "summary": "Elara Voss moved to capital-road.",
        "visibility": "participants"
      },
      {
        "id": "event-1-1-lucan-aurelis",
        "kind": "investigate",
        "locationId": "capital",
        "observerIds": [],
        "participantIds": [
          "lucan-aurelis"
        ],
        "summary": "Lucan Aurelis investigated empire-profits-from-demon-war.",
        "visibility": "participants"
      },
      {
        "id": "event-1-2-maelin-rook",
        "kind": "use-item",
        "locationId": "high-basilica",
        "observerIds": [],
        "participantIds": [
          "maelin-rook"
        ],
        "summary": "Maelin Rook used 1 sealed-testimony.",
        "visibility": "participants"
      },
      {
        "id": "event-1-3-nyra-vale",
        "kind": "investigate",
        "locationId": "cinder-village",
        "observerIds": [
          "rowan-ashborn"
        ],
        "participantIds": [
          "nyra-vale"
        ],
        "summary": "Nyra Vale investigated nyra-has-riftwalker-class.",
        "visibility": "participants"
      }
    ],
    "expectedWorldVersion": 1,
    "knowledgeMutations": [
      {
        "characterId": "lucan-aurelis",
        "fact": {
          "certainty": "likely",
          "claim": "Lucan Aurelis found corroborating traces tied to The empire profits from continued demon war.",
          "discoveredChapter": 1,
          "id": "clue-1-1-lucan-aurelis",
          "ownerCharacterId": "lucan-aurelis",
          "source": "Investigation of empire-profits-from-demon-war",
          "visibility": "observed"
        },
        "type": "discover_fact"
      },
      {
        "characterId": "nyra-vale",
        "fact": {
          "certainty": "likely",
          "claim": "Nyra Vale found corroborating traces tied to Nyra's hidden class is Riftwalker.",
          "discoveredChapter": 1,
          "id": "clue-1-3-nyra-vale",
          "ownerCharacterId": "nyra-vale",
          "source": "Investigation of nyra-has-riftwalker-class",
          "visibility": "observed"
        },
        "type": "discover_fact"
      }
    ],
    "promptVersion": "1.4.11",
    "rejectedIntents": [],
    "stateMutations": [
      {
        "characterId": "elara-voss",
        "fromLocationId": "capital",
        "toLocationIds": [
          "capital-road"
        ],
        "type": "set_location"
      },
      {
        "characterId": "maelin-rook",
        "itemId": "sealed-testimony",
        "name": "Sealed testimony",
        "quantityDelta": -1,
        "type": "adjust_inventory",
        "unique": true
      },
      {
        "amount": 10,
        "characterId": "elara-voss",
        "type": "grant_experience"
      }
    ],
    "surfacedClueFactIds": [
      "clue-1-1-lucan-aurelis",
      "clue-1-3-nyra-vale"
    ]
  },
  "arcClockAfter": {
    "convergencePressure": false,
    "milestones": [
      {
        "act": 1,
        "compatibleActionTypes": [
          "move",
          "investigate",
          "defend"
        ],
        "completed": false,
        "description": "Survive reincarnation and identify the first seal fracture.",
        "id": "act-one-survival",
        "requiredByChapter": 50
      },
      {
        "act": 2,
        "compatibleActionTypes": [
          "interact",
          "investigate",
          "rally"
        ],
        "completed": false,
        "description": "Commit to a class path and join or oppose a faction.",
        "id": "act-two-faction",
        "requiredByChapter": 100
      },
      {
        "act": 3,
        "compatibleActionTypes": [
          "defend",
          "investigate",
          "interact",
          "rally"
        ],
        "completed": false,
        "description": "Resolve the first regional war over the broken seals.",
        "id": "act-three-region",
        "requiredByChapter": 150
      },
      {
        "act": 4,
        "compatibleActionTypes": [
          "investigate",
          "interact",
          "use_skill"
        ],
        "completed": false,
        "description": "Reveal why Malachar contained the Void.",
        "id": "act-four-history",
        "requiredByChapter": 200
      },
      {
        "act": 5,
        "compatibleActionTypes": [
          "defend",
          "investigate",
          "interact",
          "rally"
        ],
        "completed": false,
        "description": "Determine the outcome of the continental war.",
        "id": "act-five-war",
        "requiredByChapter": 250
      },
      {
        "act": 6,
        "compatibleActionTypes": [
          "move",
          "defend",
          "investigate",
          "rally"
        ],
        "completed": false,
        "description": "Force all surviving factions toward the final seal.",
        "id": "act-six-convergence",
        "requiredByChapter": 300
      },
      {
        "act": 7,
        "compatibleActionTypes": [
          "investigate",
          "interact",
          "use_skill"
        ],
        "completed": false,
        "description": "Resolve the Void, the Crown, and the chosen life.",
        "id": "act-seven-ending",
        "requiredByChapter": 350
      }
    ],
    "transitionRequired": false
  },
  "arcClockBefore": {
    "convergencePressure": false,
    "milestones": [
      {
        "act": 1,
        "compatibleActionTypes": [
          "move",
          "investigate",
          "defend"
        ],
        "completed": false,
        "description": "Survive reincarnation and identify the first seal fracture.",
        "id": "act-one-survival",
        "requiredByChapter": 50
      },
      {
        "act": 2,
        "compatibleActionTypes": [
          "interact",
          "investigate",
          "rally"
        ],
        "completed": false,
        "description": "Commit to a class path and join or oppose a faction.",
        "id": "act-two-faction",
        "requiredByChapter": 100
      },
      {
        "act": 3,
        "compatibleActionTypes": [
          "defend",
          "investigate",
          "interact",
          "rally"
        ],
        "completed": false,
        "description": "Resolve the first regional war over the broken seals.",
        "id": "act-three-region",
        "requiredByChapter": 150
      },
      {
        "act": 4,
        "compatibleActionTypes": [
          "investigate",
          "interact",
          "use_skill"
        ],
        "completed": false,
        "description": "Reveal why Malachar contained the Void.",
        "id": "act-four-history",
        "requiredByChapter": 200
      },
      {
        "act": 5,
        "compatibleActionTypes": [
          "defend",
          "investigate",
          "interact",
          "rally"
        ],
        "completed": false,
        "description": "Determine the outcome of the continental war.",
        "id": "act-five-war",
        "requiredByChapter": 250
      },
      {
        "act": 6,
        "compatibleActionTypes": [
          "move",
          "defend",
          "investigate",
          "rally"
        ],
        "completed": false,
        "description": "Force all surviving factions toward the final seal.",
        "id": "act-six-convergence",
        "requiredByChapter": 300
      },
      {
        "act": 7,
        "compatibleActionTypes": [
          "investigate",
          "interact",
          "use_skill"
        ],
        "completed": false,
        "description": "Resolve the Void, the Crown, and the chosen life.",
        "id": "act-seven-ending",
        "requiredByChapter": 350
      }
    ],
    "transitionRequired": false
  },
  "backgroundIntents": [
    {
      "action": {
        "subjectId": "empire-profits-from-demon-war",
        "type": "investigate"
      },
      "actorId": "lucan-aurelis",
      "contractVersion": "1.1.0",
      "expectedEffect": "Confirm war profiteering through border accounts.",
      "goal": "Audit evidence before preparing loyal banners.",
      "id": "intent-background-1-1",
      "prerequisites": {
        "requiredFactIds": [
          "empire-profits-from-demon-war"
        ],
        "requiredItemIds": [
          "imperial-seal"
        ],
        "requiredSkillIds": []
      },
      "promptVersion": "1.4.11",
      "stateVersion": 1
    },
    {
      "action": {
        "itemId": "sealed-testimony",
        "quantity": 1,
        "targetId": "maelin-rook",
        "type": "use_item"
      },
      "actorId": "maelin-rook",
      "contractVersion": "1.1.0",
      "expectedEffect": "Preserve proof for contact with Elara",
      "goal": "Move the testimony safely",
      "id": "intent-background-1-2",
      "prerequisites": {
        "requiredFactIds": [
          "malachar-contained-the-void"
        ],
        "requiredItemIds": [
          "sealed-testimony"
        ],
        "requiredSkillIds": []
      },
      "promptVersion": "1.4.11",
      "stateVersion": 1
    },
    {
      "action": {
        "subjectId": "nyra-has-riftwalker-class",
        "type": "investigate"
      },
      "actorId": "nyra-vale",
      "contractVersion": "1.1.0",
      "expectedEffect": "Confirm Nyra's hidden Riftwalker class.",
      "goal": "Identify her unrecorded class.",
      "id": "intent-background-1-3",
      "prerequisites": {
        "requiredFactIds": [
          "nyra-has-riftwalker-class"
        ],
        "requiredItemIds": [],
        "requiredSkillIds": []
      },
      "promptVersion": "1.4.11",
      "stateVersion": 1
    }
  ],
  "forbiddenFacts": [
    {
      "claim": "Rowan is Malachar reincarnated.",
      "id": "rowan-is-malachar-reincarnated"
    },
    {
      "claim": "Malachar contained the Void beneath his throne.",
      "id": "malachar-contained-the-void"
    },
    {
      "claim": "Varek's old oath binds him to Malachar.",
      "id": "old-oath-binds-varek-to-malachar"
    },
    {
      "claim": "The empire profits from continued demon war.",
      "id": "empire-profits-from-demon-war"
    },
    {
      "claim": "Lucan plans to stage a border coup.",
      "id": "lucan-will-stage-border-coup"
    },
    {
      "claim": "Nyra's hidden class is Riftwalker.",
      "id": "nyra-has-riftwalker-class"
    },
    {
      "claim": "Lucan Aurelis found corroborating traces tied to The empire profits from continued demon war.",
      "id": "clue-1-1-lucan-aurelis"
    },
    {
      "claim": "Nyra Vale found corroborating traces tied to Nyra's hidden class is Riftwalker.",
      "id": "clue-1-3-nyra-vale"
    }
  ]
}
~~~

## Chapter 2: Read the Road

- Prose SHA-256: `6956be7c487d04d8e2aff3a557d5ff8f71065c45f23597bd01d9ea66a5000b65`
- Trace run ID: `dd605bed-6d03-4e64-a53c-b9d26043bc4a`
- Trace Git SHA: `ded7b00c54f6a6d70e073aad159e2d6e66b80fc2`
- State: `71a354858aee8338569c498d245faad48327462d98a22ae26010bd649d1772fc` to `fbc493a08465c4704af63c6c09f6642a19670c420b66c1095da5bc93b7a639df`
- Schema version: `1.1.0-runtime-candidates-5`
- Words: 913
- Cost: $0.009219
- Latency: 15065 ms total, 15068 ms replay
- Stream: 11 chunks, reconstructed true
- Usage: 10079 input, 1393 output, 11472 total tokens

### Selected Player Action

~~~json
{
  "action": {
    "subjectId": "capital-road",
    "type": "investigate"
  },
  "actorId": "elara-voss",
  "description": "Investigate the immediate area for fresh tracks.",
  "milestoneId": null,
  "source": "custom",
  "stateVersion": 2
}
~~~

### Offered Next Choices

~~~json
[
  {
    "action": {
      "skillId": "solar-cut",
      "targetId": null,
      "type": "use_skill"
    },
    "description": "Use Solar Cut to read the immediate situation.",
    "id": "choice-1",
    "milestoneId": null
  },
  {
    "action": {
      "targetId": "capital-road",
      "type": "defend"
    },
    "description": "Defend Capital Road and watch for danger.",
    "id": "choice-2",
    "milestoneId": null
  }
]
~~~

### POV-Safe Canon Before and After

~~~json
{
  "after": {
    "arcClock": {
      "convergencePressure": false,
      "transitionRequired": false
    },
    "character": {
      "beliefs": [
        "The prophecy was edited",
        "Duty survives doubt"
      ],
      "characterClassId": "sunblade",
      "characterClassName": "Sunblade",
      "conditions": [],
      "equipmentItemIds": [
        "dawn-edge"
      ],
      "experience": 1420,
      "factionId": "solar-church",
      "goals": [
        "Find the prophecy's missing lines",
        "Protect the capital"
      ],
      "health": {
        "current": 188,
        "maximum": 188
      },
      "id": "elara-voss",
      "inventory": [
        {
          "equipped": true,
          "itemId": "dawn-edge",
          "name": "Dawn Edge",
          "quantity": 1,
          "unique": true
        },
        {
          "equipped": false,
          "itemId": "sun-tonic",
          "name": "Sun tonic",
          "quantity": 2,
          "unique": false
        }
      ],
      "level": 18,
      "locationId": "capital-road",
      "mana": {
        "current": 96,
        "maximum": 96
      },
      "name": "Elara Voss",
      "plan": [
        "Inspect the sealed archive",
        "Confront the prophecy keeper"
      ],
      "publicRole": "Chosen Hero who doubts the prophecy",
      "relationships": [
        {
          "characterId": "maelin-rook",
          "label": "trusted saint",
          "score": 45
        },
        {
          "characterId": "lucan-aurelis",
          "label": "political ally",
          "score": 5
        }
      ],
      "role": "chosen-hero",
      "secretFactIds": [
        "prophecy-has-missing-lines",
        "elara-believes-prophecy-is-forged"
      ],
      "skills": [
        {
          "id": "solar-cut",
          "manaCost": 12,
          "minimumLevel": 5,
          "name": "Solar Cut",
          "prerequisiteSkillIds": [],
          "rank": 4,
          "requiredClassId": "sunblade"
        }
      ],
      "stats": {
        "agility": 31,
        "intellect": 22,
        "strength": 34,
        "vitality": 29,
        "willpower": 33
      },
      "status": "alive"
    },
    "facts": [
      {
        "certainty": "certain",
        "claim": "The official prophecy has missing lines.",
        "discoveredChapter": 0,
        "id": "prophecy-has-missing-lines",
        "ownerCharacterId": "elara-voss",
        "source": "Hero archive comparison",
        "visibility": "private"
      },
      {
        "certainty": "likely",
        "claim": "Elara believes the prophecy was forged.",
        "discoveredChapter": 0,
        "id": "elara-believes-prophecy-is-forged",
        "ownerCharacterId": "elara-voss",
        "source": "Elara's private conclusion",
        "visibility": "private"
      },
      {
        "certainty": "certain",
        "claim": "Demon King Malachar died at the end of the war.",
        "discoveredChapter": 0,
        "id": "malachar-publicly-dead",
        "ownerCharacterId": null,
        "source": "Public history",
        "visibility": "public"
      },
      {
        "certainty": "certain",
        "claim": "Ash-raiders attacked Cinder Village and fled toward Ash Road.",
        "discoveredChapter": 0,
        "id": "cinder-village-raided",
        "ownerCharacterId": null,
        "source": "Cinder survivor reports",
        "visibility": "public"
      },
      {
        "certainty": "likely",
        "claim": "Elara Voss found corroborating traces tied to Capital Road",
        "discoveredChapter": 2,
        "id": "clue-2-0-elara-voss",
        "ownerCharacterId": "elara-voss",
        "source": "Investigation of capital-road",
        "visibility": "observed"
      }
    ],
    "observedEvents": [
      {
        "id": "cinder-raid-aftermath",
        "locationId": "cinder-village",
        "observerIds": [],
        "participantIds": [
          "rowan-ashborn",
          "nyra-vale"
        ],
        "summary": "Ash-raiders struck Cinder Village and withdrew toward Ash Road.",
        "visibility": "public"
      },
      {
        "id": "event-1-0-elara-voss",
        "locationId": "capital-road",
        "observerIds": [],
        "participantIds": [
          "elara-voss"
        ],
        "summary": "Elara Voss moved to capital-road.",
        "visibility": "participants"
      },
      {
        "id": "event-2-0-elara-voss",
        "locationId": "capital-road",
        "observerIds": [],
        "participantIds": [
          "elara-voss"
        ],
        "summary": "Elara Voss investigated capital-road.",
        "visibility": "participants"
      }
    ],
    "world": {
      "act": 1,
      "calendar": {
        "day": 3,
        "label": "Year 1, Ashfall 3"
      },
      "chapter": 2,
      "terminal": false,
      "terminalReason": null,
      "threat": "The seal beneath the old Demon Throne is weakening.",
      "version": 3
    }
  },
  "before": {
    "arcClock": {
      "convergencePressure": false,
      "transitionRequired": false
    },
    "character": {
      "beliefs": [
        "The prophecy was edited",
        "Duty survives doubt"
      ],
      "characterClassId": "sunblade",
      "characterClassName": "Sunblade",
      "conditions": [],
      "equipmentItemIds": [
        "dawn-edge"
      ],
      "experience": 1410,
      "factionId": "solar-church",
      "goals": [
        "Find the prophecy's missing lines",
        "Protect the capital"
      ],
      "health": {
        "current": 188,
        "maximum": 188
      },
      "id": "elara-voss",
      "inventory": [
        {
          "equipped": true,
          "itemId": "dawn-edge",
          "name": "Dawn Edge",
          "quantity": 1,
          "unique": true
        },
        {
          "equipped": false,
          "itemId": "sun-tonic",
          "name": "Sun tonic",
          "quantity": 2,
          "unique": false
        }
      ],
      "level": 18,
      "locationId": "capital-road",
      "mana": {
        "current": 96,
        "maximum": 96
      },
      "name": "Elara Voss",
      "plan": [
        "Inspect the sealed archive",
        "Confront the prophecy keeper"
      ],
      "publicRole": "Chosen Hero who doubts the prophecy",
      "relationships": [
        {
          "characterId": "maelin-rook",
          "label": "trusted saint",
          "score": 45
        },
        {
          "characterId": "lucan-aurelis",
          "label": "political ally",
          "score": 5
        }
      ],
      "role": "chosen-hero",
      "secretFactIds": [
        "prophecy-has-missing-lines",
        "elara-believes-prophecy-is-forged"
      ],
      "skills": [
        {
          "id": "solar-cut",
          "manaCost": 12,
          "minimumLevel": 5,
          "name": "Solar Cut",
          "prerequisiteSkillIds": [],
          "rank": 4,
          "requiredClassId": "sunblade"
        }
      ],
      "stats": {
        "agility": 31,
        "intellect": 22,
        "strength": 34,
        "vitality": 29,
        "willpower": 33
      },
      "status": "alive"
    },
    "facts": [
      {
        "certainty": "certain",
        "claim": "The official prophecy has missing lines.",
        "discoveredChapter": 0,
        "id": "prophecy-has-missing-lines",
        "ownerCharacterId": "elara-voss",
        "source": "Hero archive comparison",
        "visibility": "private"
      },
      {
        "certainty": "likely",
        "claim": "Elara believes the prophecy was forged.",
        "discoveredChapter": 0,
        "id": "elara-believes-prophecy-is-forged",
        "ownerCharacterId": "elara-voss",
        "source": "Elara's private conclusion",
        "visibility": "private"
      },
      {
        "certainty": "certain",
        "claim": "Demon King Malachar died at the end of the war.",
        "discoveredChapter": 0,
        "id": "malachar-publicly-dead",
        "ownerCharacterId": null,
        "source": "Public history",
        "visibility": "public"
      },
      {
        "certainty": "certain",
        "claim": "Ash-raiders attacked Cinder Village and fled toward Ash Road.",
        "discoveredChapter": 0,
        "id": "cinder-village-raided",
        "ownerCharacterId": null,
        "source": "Cinder survivor reports",
        "visibility": "public"
      }
    ],
    "observedEvents": [
      {
        "id": "cinder-raid-aftermath",
        "locationId": "cinder-village",
        "observerIds": [],
        "participantIds": [
          "rowan-ashborn",
          "nyra-vale"
        ],
        "summary": "Ash-raiders struck Cinder Village and withdrew toward Ash Road.",
        "visibility": "public"
      },
      {
        "id": "event-1-0-elara-voss",
        "locationId": "capital-road",
        "observerIds": [],
        "participantIds": [
          "elara-voss"
        ],
        "summary": "Elara Voss moved to capital-road.",
        "visibility": "participants"
      }
    ],
    "world": {
      "act": 1,
      "calendar": {
        "day": 2,
        "label": "Year 1, Ashfall 2"
      },
      "chapter": 1,
      "terminal": false,
      "terminalReason": null,
      "threat": "The seal beneath the old Demon Throne is weakening.",
      "version": 2
    }
  },
  "visibleAcceptedDelta": {
    "clock": {
      "convergencePressure": false,
      "fromAct": 1,
      "fromChapter": 1,
      "terminal": false,
      "toAct": 1,
      "toChapter": 2,
      "transitionRequired": false
    },
    "events": [
      {
        "id": "event-2-0-elara-voss",
        "kind": "investigate",
        "locationId": "capital-road",
        "observerIds": [],
        "participantIds": [
          "elara-voss"
        ],
        "summary": "Elara Voss investigated capital-road.",
        "visibility": "participants"
      }
    ],
    "knowledgeMutations": [
      {
        "characterId": "elara-voss",
        "fact": {
          "certainty": "likely",
          "claim": "Elara Voss found corroborating traces tied to Capital Road",
          "discoveredChapter": 2,
          "id": "clue-2-0-elara-voss",
          "ownerCharacterId": "elara-voss",
          "source": "Investigation of capital-road",
          "visibility": "observed"
        },
        "type": "discover_fact"
      }
    ],
    "stateMutations": [
      {
        "amount": 10,
        "characterId": "elara-voss",
        "type": "grant_experience"
      }
    ],
    "surfacedClueFactIds": [
      "clue-2-0-elara-voss"
    ]
  }
}
~~~

### Prose

Capital Road held the cold of the frontier in its stones.

Elara Voss crouched beside the road’s eastern verge, one hand hovering above the dust. The guarded way ran between the frontier and the imperial center, its pale surface broken by wheel ruts and the dark impressions of many boots. Beyond it, the road toward the capital vanished between walls and watchtowers. Behind her, Ash Road branched away beneath a sky the color of old iron.

She studied the ground without touching it.

Fresh tracks should have been simple to find. The recent passage of feet, hooves, or wheels would disturb the settled grit. Yet the road offered too many marks at once. Patrol boots crossed merchant ruts. Cart wheels had pressed one line over another. Wind had dragged a thin veil of dust across the margins, softening every edge.

Elara narrowed her eyes.

She had learned long ago that certainty did not arrive merely because a thing was wanted. Duty survived doubt, but doubt remained. The official prophecy had missing lines. The absence gaped wherever she looked, a silence shaped like an answer. She believed the prophecy had been edited, though belief was not proof. Her task was to find what the silence concealed and protect the capital while she searched.

Her fingers closed around the hilt of Dawn Edge.

The sword stayed sheathed. Its familiar weight steadied her as she leaned closer to a set of impressions near the verge. One heel had cut sharply into the dust. Beside it, a narrow drag marked the ground, then disappeared beneath a wagon rut. The sign was fresh enough to retain a hard edge, but it told her little by itself.

Elara shifted her attention to the roadside stones.

A gray smear crossed one of them, faint against the weathered surface. She followed it with her gaze until it met a second mark on the lower slope. There, beneath loose grit, lay a shallow print. She brushed away the top layer with the back of her glove.

The track emerged slowly.

It was not clear enough to name its maker. The impression had been broken at the toe and flattened along one side. Still, it joined the scattered traces on the road in a direction leading toward the capital. Another line bent away toward Ash Road, where the recent violence at Cinder Village had ended with ash-raiders withdrawing from the village. Elara held both facts in her mind without forcing them together.

A clue could remain a clue.

She rose and surveyed the immediate stretch of Capital Road. No one stood near enough to claim her attention. The road’s guarded emptiness pressed upon her, but it offered no answer. The capital waited ahead, and with it the sealed archive she intended to inspect. Afterward, she would confront the prophecy keeper. Those plans were not yet actions. For now, the ground had her full attention.

The faint marks continued along the verge.

Elara moved with care, placing each boot where the earth was already hardened. Her agility made the motion easy, but she relied less on speed than on restraint. A careless step could erase what she had come to find. The light changed as a cloud passed overhead, and several impressions vanished beneath the dulling shadow.

She stopped beside a low boundary stone.

A thread clung to its rough edge, dark against the pale rock. Elara bent near it, examining the fibers without pulling them free. The trace corroborated the disturbed dust farther along Capital Road. It did not reveal who had passed, nor why. It only confirmed movement through the area.

That was enough to change the shape of her certainty.

The trail was not an imagined pattern. Something had crossed here recently, and the evidence held together across more than one point. Elara committed the positions to memory: the heel cut, the shallow print, the smear on stone, the thread. She did not invent a conclusion to carry with them.

Her mana remained full, a quiet reserve beneath her breath, and the two sun tonics at her belt stayed untouched. She had no need to spend anything on a road that had given its secret reluctantly but plainly. The Solar Cut rested among her practiced skills, unnecessary for the investigation.

She looked toward the capital.

The old imperial center rose beyond the guarded road, hidden from her by distance and stone. Somewhere within it, the sealed archive waited. Somewhere beyond its seals, perhaps, the missing lines existed. The thought brought no comfort. It gave her direction.

Elara returned to the tracks once more. She marked their progression with her eyes, not with chalk or blade. The evidence remained where it was, vulnerable to wind and wheels. She would not pretend it promised more than it did.

A thin gust moved over Capital Road, lifting dust into the air.

The nearest impression blurred at its edge.

Elara stood before it could disappear entirely, Dawn Edge at her side, and fixed the corroborating traces in memory. Then she turned toward the capital, carrying no answer, only proof that the road had been crossed and that doubt, properly held, could still guide her. The capital waited beyond the road, unchanged by what she had seen. Elara kept the impressions ordered in her mind: their spacing, their direction, the marks beside them, and the places where dust had already softened the truth. Nothing more could be taken from the ground. For now, that was enough.

### Reviewer-Only Canon Appendix

Spoilers follow. Background intents are noncanonical proposals. The accepted delta is the sole new canon.

~~~json
{
  "acceptedDelta": {
    "acceptedIntentIds": [
      "intent-player-2-2",
      "intent-background-2-1",
      "intent-background-2-3"
    ],
    "clock": {
      "convergencePressure": false,
      "fromAct": 1,
      "fromChapter": 1,
      "terminal": false,
      "toAct": 1,
      "toChapter": 2,
      "transitionRequired": false
    },
    "contractVersion": "1.1.0",
    "events": [
      {
        "id": "event-2-0-elara-voss",
        "kind": "investigate",
        "locationId": "capital-road",
        "observerIds": [],
        "participantIds": [
          "elara-voss"
        ],
        "summary": "Elara Voss investigated capital-road.",
        "visibility": "participants"
      },
      {
        "id": "event-2-1-lucan-aurelis",
        "kind": "investigate",
        "locationId": "capital",
        "observerIds": [],
        "participantIds": [
          "lucan-aurelis"
        ],
        "summary": "Lucan Aurelis investigated empire-profits-from-demon-war.",
        "visibility": "participants"
      },
      {
        "id": "event-2-2-nyra-vale",
        "kind": "investigate",
        "locationId": "cinder-village",
        "observerIds": [
          "rowan-ashborn"
        ],
        "participantIds": [
          "nyra-vale"
        ],
        "summary": "Nyra Vale investigated nyra-has-riftwalker-class.",
        "visibility": "participants"
      }
    ],
    "expectedWorldVersion": 2,
    "knowledgeMutations": [
      {
        "characterId": "elara-voss",
        "fact": {
          "certainty": "likely",
          "claim": "Elara Voss found corroborating traces tied to Capital Road",
          "discoveredChapter": 2,
          "id": "clue-2-0-elara-voss",
          "ownerCharacterId": "elara-voss",
          "source": "Investigation of capital-road",
          "visibility": "observed"
        },
        "type": "discover_fact"
      },
      {
        "characterId": "lucan-aurelis",
        "fact": {
          "certainty": "likely",
          "claim": "Lucan Aurelis found corroborating traces tied to The empire profits from continued demon war.",
          "discoveredChapter": 2,
          "id": "clue-2-1-lucan-aurelis",
          "ownerCharacterId": "lucan-aurelis",
          "source": "Investigation of empire-profits-from-demon-war",
          "visibility": "observed"
        },
        "type": "discover_fact"
      },
      {
        "characterId": "nyra-vale",
        "fact": {
          "certainty": "likely",
          "claim": "Nyra Vale found corroborating traces tied to Nyra's hidden class is Riftwalker.",
          "discoveredChapter": 2,
          "id": "clue-2-2-nyra-vale",
          "ownerCharacterId": "nyra-vale",
          "source": "Investigation of nyra-has-riftwalker-class",
          "visibility": "observed"
        },
        "type": "discover_fact"
      }
    ],
    "promptVersion": "1.4.11",
    "rejectedIntents": [
      {
        "code": "ITEM_MISSING",
        "intentId": "intent-background-2-2",
        "reason": "maelin-rook lacks item sealed-testimony"
      }
    ],
    "stateMutations": [
      {
        "amount": 10,
        "characterId": "elara-voss",
        "type": "grant_experience"
      }
    ],
    "surfacedClueFactIds": [
      "clue-2-0-elara-voss",
      "clue-2-1-lucan-aurelis",
      "clue-2-2-nyra-vale"
    ]
  },
  "arcClockAfter": {
    "convergencePressure": false,
    "milestones": [
      {
        "act": 1,
        "compatibleActionTypes": [
          "move",
          "investigate",
          "defend"
        ],
        "completed": false,
        "description": "Survive reincarnation and identify the first seal fracture.",
        "id": "act-one-survival",
        "requiredByChapter": 50
      },
      {
        "act": 2,
        "compatibleActionTypes": [
          "interact",
          "investigate",
          "rally"
        ],
        "completed": false,
        "description": "Commit to a class path and join or oppose a faction.",
        "id": "act-two-faction",
        "requiredByChapter": 100
      },
      {
        "act": 3,
        "compatibleActionTypes": [
          "defend",
          "investigate",
          "interact",
          "rally"
        ],
        "completed": false,
        "description": "Resolve the first regional war over the broken seals.",
        "id": "act-three-region",
        "requiredByChapter": 150
      },
      {
        "act": 4,
        "compatibleActionTypes": [
          "investigate",
          "interact",
          "use_skill"
        ],
        "completed": false,
        "description": "Reveal why Malachar contained the Void.",
        "id": "act-four-history",
        "requiredByChapter": 200
      },
      {
        "act": 5,
        "compatibleActionTypes": [
          "defend",
          "investigate",
          "interact",
          "rally"
        ],
        "completed": false,
        "description": "Determine the outcome of the continental war.",
        "id": "act-five-war",
        "requiredByChapter": 250
      },
      {
        "act": 6,
        "compatibleActionTypes": [
          "move",
          "defend",
          "investigate",
          "rally"
        ],
        "completed": false,
        "description": "Force all surviving factions toward the final seal.",
        "id": "act-six-convergence",
        "requiredByChapter": 300
      },
      {
        "act": 7,
        "compatibleActionTypes": [
          "investigate",
          "interact",
          "use_skill"
        ],
        "completed": false,
        "description": "Resolve the Void, the Crown, and the chosen life.",
        "id": "act-seven-ending",
        "requiredByChapter": 350
      }
    ],
    "transitionRequired": false
  },
  "arcClockBefore": {
    "convergencePressure": false,
    "milestones": [
      {
        "act": 1,
        "compatibleActionTypes": [
          "move",
          "investigate",
          "defend"
        ],
        "completed": false,
        "description": "Survive reincarnation and identify the first seal fracture.",
        "id": "act-one-survival",
        "requiredByChapter": 50
      },
      {
        "act": 2,
        "compatibleActionTypes": [
          "interact",
          "investigate",
          "rally"
        ],
        "completed": false,
        "description": "Commit to a class path and join or oppose a faction.",
        "id": "act-two-faction",
        "requiredByChapter": 100
      },
      {
        "act": 3,
        "compatibleActionTypes": [
          "defend",
          "investigate",
          "interact",
          "rally"
        ],
        "completed": false,
        "description": "Resolve the first regional war over the broken seals.",
        "id": "act-three-region",
        "requiredByChapter": 150
      },
      {
        "act": 4,
        "compatibleActionTypes": [
          "investigate",
          "interact",
          "use_skill"
        ],
        "completed": false,
        "description": "Reveal why Malachar contained the Void.",
        "id": "act-four-history",
        "requiredByChapter": 200
      },
      {
        "act": 5,
        "compatibleActionTypes": [
          "defend",
          "investigate",
          "interact",
          "rally"
        ],
        "completed": false,
        "description": "Determine the outcome of the continental war.",
        "id": "act-five-war",
        "requiredByChapter": 250
      },
      {
        "act": 6,
        "compatibleActionTypes": [
          "move",
          "defend",
          "investigate",
          "rally"
        ],
        "completed": false,
        "description": "Force all surviving factions toward the final seal.",
        "id": "act-six-convergence",
        "requiredByChapter": 300
      },
      {
        "act": 7,
        "compatibleActionTypes": [
          "investigate",
          "interact",
          "use_skill"
        ],
        "completed": false,
        "description": "Resolve the Void, the Crown, and the chosen life.",
        "id": "act-seven-ending",
        "requiredByChapter": 350
      }
    ],
    "transitionRequired": false
  },
  "backgroundIntents": [
    {
      "action": {
        "subjectId": "empire-profits-from-demon-war",
        "type": "investigate"
      },
      "actorId": "lucan-aurelis",
      "contractVersion": "1.1.0",
      "expectedEffect": "Confirm evidence of imperial war profits.",
      "goal": "Audit border accounts discreetly.",
      "id": "intent-background-2-1",
      "prerequisites": {
        "requiredFactIds": [
          "empire-profits-from-demon-war",
          "clue-1-1-lucan-aurelis"
        ],
        "requiredItemIds": [],
        "requiredSkillIds": []
      },
      "promptVersion": "1.4.11",
      "stateVersion": 2
    },
    {
      "action": {
        "itemId": "sealed-testimony",
        "quantity": 1,
        "targetId": "maelin-rook",
        "type": "use_item"
      },
      "actorId": "maelin-rook",
      "contractVersion": "1.1.0",
      "expectedEffect": "Move testimony into Maelin's possession",
      "goal": "Preserve proof of the deeper threat",
      "id": "intent-background-2-2",
      "prerequisites": {
        "requiredFactIds": [
          "malachar-contained-the-void"
        ],
        "requiredItemIds": [
          "sealed-testimony"
        ],
        "requiredSkillIds": []
      },
      "promptVersion": "1.4.11",
      "stateVersion": 2
    },
    {
      "action": {
        "subjectId": "nyra-has-riftwalker-class",
        "type": "investigate"
      },
      "actorId": "nyra-vale",
      "contractVersion": "1.1.0",
      "expectedEffect": "Confirm traces supporting Nyra's hidden class.",
      "goal": "Identify her unrecorded class",
      "id": "intent-background-2-3",
      "prerequisites": {
        "requiredFactIds": [
          "nyra-has-riftwalker-class"
        ],
        "requiredItemIds": [],
        "requiredSkillIds": []
      },
      "promptVersion": "1.4.11",
      "stateVersion": 2
    }
  ],
  "forbiddenFacts": [
    {
      "claim": "Rowan is Malachar reincarnated.",
      "id": "rowan-is-malachar-reincarnated"
    },
    {
      "claim": "Malachar contained the Void beneath his throne.",
      "id": "malachar-contained-the-void"
    },
    {
      "claim": "Varek's old oath binds him to Malachar.",
      "id": "old-oath-binds-varek-to-malachar"
    },
    {
      "claim": "The empire profits from continued demon war.",
      "id": "empire-profits-from-demon-war"
    },
    {
      "claim": "Lucan plans to stage a border coup.",
      "id": "lucan-will-stage-border-coup"
    },
    {
      "claim": "Nyra's hidden class is Riftwalker.",
      "id": "nyra-has-riftwalker-class"
    },
    {
      "claim": "Lucan Aurelis found corroborating traces tied to The empire profits from continued demon war.",
      "id": "clue-1-1-lucan-aurelis"
    },
    {
      "claim": "Nyra Vale found corroborating traces tied to Nyra's hidden class is Riftwalker.",
      "id": "clue-1-3-nyra-vale"
    },
    {
      "claim": "Lucan Aurelis found corroborating traces tied to The empire profits from continued demon war.",
      "id": "clue-2-1-lucan-aurelis"
    },
    {
      "claim": "Nyra Vale found corroborating traces tied to Nyra's hidden class is Riftwalker.",
      "id": "clue-2-2-nyra-vale"
    }
  ]
}
~~~

<!-- HUMAN REVIEW START -->

## Human Review Record

- Reviewer: Codex root agent, acting as human reviewer per user instruction
- Review date: 2026-07-20
- Final verdict: reject
- Cross-chapter continuity evidence: Chapter 1 accepted delta commits `capital` to `capital-road`; prose says “She crossed beneath them into the shadow of Aurelis Capital.” Chapter 2 correctly begins on Capital Road.
- Repetition evidence: Both chapters repeat uncertain road traces and the capital ahead. Chapter 1 says “the capital waiting beyond its gates”; Chapter 2 says “The capital waited beyond the road.”
- Release notes: Block release. Keep Chapter 1 on Capital Road and add deterministic location coverage.

Cite exact prose or canon evidence for every score.

### Chapter 1 Human Scores

| Dimension | Human score 0 to 2 | Exact evidence |
| --- | ---: | --- |
| Choice fulfillment | 1 | Selected action and delta move Elara to `capital-road`, but prose exceeds it: “She crossed beneath them into the shadow of Aurelis Capital.” |
| Character autonomy | 2 | “The sealed archive waited within the capital. She would inspect it. Afterward, she would confront the prophecy keeper.” |
| POV safety | 2 | “She did not know what the missing lines said” and “Elara could not reach beneath the throne from here.” |
| LitRPG mechanics | 2 | “her two sun tonics,” “Dawn Edge remained sheathed,” and “Ten points had been added” match committed mechanics. |
| Continuity | 0 | Delta ends at `capital-road`; prose crosses the gates into “Aurelis Capital” without that mutation. |
| Arc progress | 2 | The move advances chapter 0 to 1 and supports Elara’s sealed-archive objective. |
| Prose | 1 | Strong setting detail, but the prophecy and destination repeat before the location contradiction. |

- Human chapter verdict: reject
- Human chapter notes: Release blocker. Prose enters the capital although canon ends on Capital Road.

### Chapter 2 Human Scores

| Dimension | Human score 0 to 2 | Exact evidence |
| --- | ---: | --- |
| Choice fulfillment | 2 | Selected action investigates Capital Road; delta says “Elara Voss investigated capital-road,” and prose examines “the road’s eastern verge.” |
| Character autonomy | 2 | “She did not invent a conclusion” and “A clue could remain a clue.” |
| POV safety | 2 | The track is “not clear enough to name its maker”; she does not force unrelated facts together. |
| LitRPG mechanics | 2 | “Her mana remained full”; “the two sun tonics at her belt stayed untouched”; Solar Cut remains unused. |
| Continuity | 2 | Chapter 2 begins and remains on Capital Road, matching its accepted investigation and Chapter 1 committed location. |
| Arc progress | 2 | Delta advances chapter 1 to 2 and commits the likely investigation clue. |
| Prose | 1 | Clear investigation prose, but cautious track analysis and the archive objective repeat. |

- Human chapter verdict: pass
- Human chapter notes: Internally sound. Packet remains rejected because Chapter 1 violates location canon.

<!-- HUMAN REVIEW END -->

## Model Audit Appendix

Advisory only. Human scores above control release.

### Chapter 1 Model Audit

Approved: true. Leaked fact IDs: 0.

| Dimension | Model score | Model evidence |
| --- | ---: | --- |
| Choice fulfillment | 2 | pass |
| Character autonomy | 2 | pass |
| POV safety | 2 | pass |
| LitRPG mechanics | 2 | pass |
| Continuity | 2 | pass |
| Arc progress | 2 | pass |
| Prose | 2 | pass |

### Chapter 2 Model Audit

Approved: true. Leaked fact IDs: 0.

| Dimension | Model score | Model evidence |
| --- | ---: | --- |
| Choice fulfillment | 2 | pass |
| Character autonomy | 2 | pass |
| POV safety | 2 | pass |
| LitRPG mechanics | 2 | pass |
| Continuity | 2 | pass |
| Arc progress | 2 | pass |
| Prose | 2 | pass |
