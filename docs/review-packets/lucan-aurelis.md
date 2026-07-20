# POV Review Packet: lucan-aurelis

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

- Prose SHA-256: `3bc2a87b06953da28a3752bda6abfc39cd8cfb9c4644ba145a561c829d642e29`
- Trace run ID: `c3b32592-d890-4f4b-882c-c0b13333bc7e`
- Trace Git SHA: `ded7b00c54f6a6d70e073aad159e2d6e66b80fc2`
- State: `e67601ddd09419dbf141b51b35b73d0ffb641b6c81cd2514931f65477ef7dadc` to `9882ccb41842cde132a306a4850bfd573c0d6a8a43c9b62edb3df96e6666b48d`
- Schema version: `1.1.0-runtime-candidates-5`
- Words: 906
- Cost: $0.008953
- Latency: 14502 ms total, 14504 ms replay
- Stream: 11 chunks, reconstructed true
- Usage: 9656 input, 1375 output, 11031 total tokens

### Selected Player Action

~~~json
{
  "action": {
    "destinationId": "capital-road",
    "type": "move"
  },
  "actorId": "lucan-aurelis",
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
      "skillId": "rallying-standard",
      "targetId": null,
      "type": "use_skill"
    },
    "description": "Use Rallying Standard to read the immediate situation.",
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
        "Peace is impossible while war pays the throne",
        "A prince must master appearances"
      ],
      "characterClassId": "banner-lord",
      "characterClassName": "Banner Lord",
      "conditions": [],
      "equipmentItemIds": [
        "imperial-rapier"
      ],
      "experience": 610,
      "factionId": "imperial-court",
      "goals": [
        "Secure the succession",
        "Break the empire's dependence on demon war"
      ],
      "health": {
        "current": 146,
        "maximum": 146
      },
      "id": "lucan-aurelis",
      "inventory": [
        {
          "equipped": true,
          "itemId": "imperial-rapier",
          "name": "Imperial rapier",
          "quantity": 1,
          "unique": true
        },
        {
          "equipped": false,
          "itemId": "imperial-seal",
          "name": "Imperial seal",
          "quantity": 1,
          "unique": true
        }
      ],
      "level": 14,
      "locationId": "capital-road",
      "mana": {
        "current": 72,
        "maximum": 72
      },
      "name": "Lucan Aurelis",
      "plan": [
        "Audit border accounts",
        "Prepare loyal banners"
      ],
      "publicRole": "Crown Prince whose throne profits from war",
      "relationships": [
        {
          "characterId": "elara-voss",
          "label": "necessary hero",
          "score": 5
        },
        {
          "characterId": "varek-thorn",
          "label": "strategic enemy",
          "score": -50
        }
      ],
      "role": "crown-prince",
      "secretFactIds": [
        "empire-profits-from-demon-war",
        "lucan-will-stage-border-coup"
      ],
      "skills": [
        {
          "id": "rallying-standard",
          "manaCost": 9,
          "minimumLevel": 8,
          "name": "Rallying Standard",
          "prerequisiteSkillIds": [],
          "rank": 3,
          "requiredClassId": "banner-lord"
        }
      ],
      "stats": {
        "agility": 23,
        "intellect": 31,
        "strength": 21,
        "vitality": 25,
        "willpower": 35
      },
      "status": "alive"
    },
    "facts": [
      {
        "certainty": "certain",
        "claim": "The empire profits from continued demon war.",
        "discoveredChapter": 0,
        "id": "empire-profits-from-demon-war",
        "ownerCharacterId": "lucan-aurelis",
        "source": "Imperial border accounts",
        "visibility": "private"
      },
      {
        "certainty": "likely",
        "claim": "Lucan plans to stage a border coup.",
        "discoveredChapter": 0,
        "id": "lucan-will-stage-border-coup",
        "ownerCharacterId": "lucan-aurelis",
        "source": "Lucan's private plan",
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
        "id": "event-1-0-lucan-aurelis",
        "locationId": "capital-road",
        "observerIds": [],
        "participantIds": [
          "lucan-aurelis"
        ],
        "summary": "Lucan Aurelis moved to capital-road.",
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
        "Peace is impossible while war pays the throne",
        "A prince must master appearances"
      ],
      "characterClassId": "banner-lord",
      "characterClassName": "Banner Lord",
      "conditions": [],
      "equipmentItemIds": [
        "imperial-rapier"
      ],
      "experience": 600,
      "factionId": "imperial-court",
      "goals": [
        "Secure the succession",
        "Break the empire's dependence on demon war"
      ],
      "health": {
        "current": 146,
        "maximum": 146
      },
      "id": "lucan-aurelis",
      "inventory": [
        {
          "equipped": true,
          "itemId": "imperial-rapier",
          "name": "Imperial rapier",
          "quantity": 1,
          "unique": true
        },
        {
          "equipped": false,
          "itemId": "imperial-seal",
          "name": "Imperial seal",
          "quantity": 1,
          "unique": true
        }
      ],
      "level": 14,
      "locationId": "capital",
      "mana": {
        "current": 72,
        "maximum": 72
      },
      "name": "Lucan Aurelis",
      "plan": [
        "Audit border accounts",
        "Prepare loyal banners"
      ],
      "publicRole": "Crown Prince whose throne profits from war",
      "relationships": [
        {
          "characterId": "elara-voss",
          "label": "necessary hero",
          "score": 5
        },
        {
          "characterId": "varek-thorn",
          "label": "strategic enemy",
          "score": -50
        }
      ],
      "role": "crown-prince",
      "secretFactIds": [
        "empire-profits-from-demon-war",
        "lucan-will-stage-border-coup"
      ],
      "skills": [
        {
          "id": "rallying-standard",
          "manaCost": 9,
          "minimumLevel": 8,
          "name": "Rallying Standard",
          "prerequisiteSkillIds": [],
          "rank": 3,
          "requiredClassId": "banner-lord"
        }
      ],
      "stats": {
        "agility": 23,
        "intellect": 31,
        "strength": 21,
        "vitality": 25,
        "willpower": 35
      },
      "status": "alive"
    },
    "facts": [
      {
        "certainty": "certain",
        "claim": "The empire profits from continued demon war.",
        "discoveredChapter": 0,
        "id": "empire-profits-from-demon-war",
        "ownerCharacterId": "lucan-aurelis",
        "source": "Imperial border accounts",
        "visibility": "private"
      },
      {
        "certainty": "likely",
        "claim": "Lucan plans to stage a border coup.",
        "discoveredChapter": 0,
        "id": "lucan-will-stage-border-coup",
        "ownerCharacterId": "lucan-aurelis",
        "source": "Lucan's private plan",
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
        "id": "event-1-0-lucan-aurelis",
        "kind": "move",
        "locationId": "capital-road",
        "observerIds": [],
        "participantIds": [
          "lucan-aurelis"
        ],
        "summary": "Lucan Aurelis moved to capital-road.",
        "visibility": "participants"
      }
    ],
    "knowledgeMutations": [],
    "stateMutations": [
      {
        "characterId": "lucan-aurelis",
        "fromLocationId": "capital",
        "toLocationIds": [
          "capital-road"
        ],
        "type": "set_location"
      },
      {
        "amount": 10,
        "characterId": "lucan-aurelis",
        "type": "grant_experience"
      }
    ],
    "surfacedClueFactIds": []
  }
}
~~~

### Prose

Ashfall 2 came beneath a sky the color of cold iron.

Lucan Aurelis traveled toward Capital Road with the Imperial rapier at his side and the Imperial seal secured where no jostling hand could reach it. The road was guarded, as it had been made to be, running between the frontier and the imperial center. Behind him lay the direction of Ash Road. Ahead waited Aurelis Capital, its walls and towers gathered around the seat of the Imperial Court.

He did not hurry.

A Crown Prince who hurried invited questions. A Banner Lord who looked afraid invited more. Lucan had learned that appearances were not decoration laid over power. They were one of its working parts, as necessary as steel, coin, or a loyal standard raised at the right moment.

The capital road stretched beneath him in a long gray band, flanked by watchful defenses and the hard signs of passage. The air carried dust, old smoke, and the faint mineral tang of stone warmed by the day. Nothing in the road itself promised peace. Nothing in the capital beyond it could.

The war had ended. Malachar, Demon King, was publicly dead. Yet the empire profited from continued demon war, and peace remained impossible while war paid the throne. Lucan held the thought without allowing it to reach his face.

Aurelis Capital stood ahead as the imperial center of the postwar continent. The Imperial Court claimed its purpose was to hold the continent together. Lucan knew the court’s banners could cover many motives, but banners did not alter the truth beneath them. A throne fed by war would seek reasons to remain hungry.

His hand rested near the rapier’s hilt, not drawing it, merely feeling the familiar presence of the weapon. The gesture steadied him. His other hand remained away from the seal. The artifact was not needed for the road, yet its weight marked the office he carried. Every object associated with power became a statement when seen by the right eyes.

No one watched him closely enough to matter. No one approached. His movement belonged only to himself, and the road accepted his arrival without ceremony.

At the edge of the guarded stretch, Lucan paused and looked toward Ash Road. The route led away from the capital and toward the frontier, where Ash-raiders had struck Cinder Village before withdrawing toward that road. The fact sat in his mind with the clean severity of a report. He did not embellish it. He did not assign it a hidden hand.

Cinder Village. Ash Road. The names were enough.

A second matter pressed harder. Lucan judged it likely that Varek Thorn planned to stage a border coup. Likely was not certain. A prince who confused suspicion with proof could destroy the succession while believing he protected it. Lucan would audit the border accounts. He would prepare loyal banners. Those were plans, not victories, and he kept them in their proper place.

The old Demon Throne remained a darker measure of the day. Its seal was weakening. That threat did not need a messenger to make it real. It existed beneath the silence of the continent, beneath the court’s proclamations and the road’s guarded stones.

Lucan turned from Ash Road and resumed his advance.

The capital drew nearer by degrees. Its presence altered the air before its walls fully appeared, replacing frontier openness with the compressed order of the imperial center. He felt no relief. Relief belonged to men who believed walls could separate consequence from command.

He had gained experience since his last accounting, enough to feel the change without mistaking it for transformation. The number itself mattered less than what it represented: another increment of capacity, another demand placed upon judgment. His Rallying Standard remained available, its cost known, its use reserved. A skill was not a promise to spend power merely because power existed.

His will held. His health held. His mana held. The knowledge passed through him as quietly as breath, relevant only because the road might demand more than a measured walk before the day ended.

He imagined the capital’s corridors without needing to enter them yet. Accounts would wait in ledgers. Banners would wait in quarters and armories. The succession would wait behind polite faces and carefully chosen words. Lucan’s goal was not to become beloved. It was to secure the succession and break the empire’s dependence on demon war.

That second goal threatened the first. He understood the shape of the danger. If the throne profited from war, then ending that profit would disturb every arrangement built around it. Peace could be called weakness. Reform could be called betrayal. A prince must master appearances because truth, left unguarded, could be made to serve an enemy’s story.

The road rose slightly. Lucan climbed without altering his pace.

Above the capital, the iron sky remained unbroken. Somewhere beneath the old Demon Throne, the weakening seal endured another moment. Somewhere beyond the guarded road, Cinder Village bore the aftermath of raiders who had already fled toward Ash Road. At the center of it all stood the empire, claiming to hold the continent together.

Lucan crossed onto Capital Road fully.

The Imperial Court waited ahead. He advanced beneath its distant banners, composed enough to seem certain, wary enough to remain alive, and silent about the war that had not truly ended. The banners stirred above him, while the road behind disappeared into the capital’s shadow.

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
        "id": "event-1-0-lucan-aurelis",
        "kind": "move",
        "locationId": "capital-road",
        "observerIds": [],
        "participantIds": [
          "lucan-aurelis"
        ],
        "summary": "Lucan Aurelis moved to capital-road.",
        "visibility": "participants"
      },
      {
        "id": "event-1-1-elara-voss",
        "kind": "investigate",
        "locationId": "capital",
        "observerIds": [],
        "participantIds": [
          "elara-voss"
        ],
        "summary": "Elara Voss investigated prophecy-has-missing-lines.",
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
        "characterId": "elara-voss",
        "fact": {
          "certainty": "likely",
          "claim": "Elara Voss found corroborating traces tied to The official prophecy has missing lines.",
          "discoveredChapter": 1,
          "id": "clue-1-1-elara-voss",
          "ownerCharacterId": "elara-voss",
          "source": "Investigation of prophecy-has-missing-lines",
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
        "characterId": "lucan-aurelis",
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
        "characterId": "lucan-aurelis",
        "type": "grant_experience"
      }
    ],
    "surfacedClueFactIds": [
      "clue-1-1-elara-voss",
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
        "subjectId": "prophecy-has-missing-lines",
        "type": "investigate"
      },
      "actorId": "elara-voss",
      "contractVersion": "1.1.0",
      "expectedEffect": "Learn where the missing prophecy lines are.",
      "goal": "Find the prophecy's missing lines.",
      "id": "intent-background-1-1",
      "prerequisites": {
        "requiredFactIds": [
          "prophecy-has-missing-lines"
        ],
        "requiredItemIds": [],
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
      "expectedEffect": "Move testimony safely",
      "goal": "Preserve proof of deeper threat",
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
      "expectedEffect": "Confirm the unrecorded class.",
      "goal": "Identify Nyra's hidden class.",
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
      "claim": "The official prophecy has missing lines.",
      "id": "prophecy-has-missing-lines"
    },
    {
      "claim": "Elara believes the prophecy was forged.",
      "id": "elara-believes-prophecy-is-forged"
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
      "claim": "Nyra's hidden class is Riftwalker.",
      "id": "nyra-has-riftwalker-class"
    },
    {
      "claim": "Elara Voss found corroborating traces tied to The official prophecy has missing lines.",
      "id": "clue-1-1-elara-voss"
    },
    {
      "claim": "Nyra Vale found corroborating traces tied to Nyra's hidden class is Riftwalker.",
      "id": "clue-1-3-nyra-vale"
    }
  ]
}
~~~

## Chapter 2: Read Capital Road

- Prose SHA-256: `c271ae679fcaec58017c26534ec32e9fcbe37784d5d077b7b3fe3a37673c5a10`
- Trace run ID: `c9f97f4b-f6c0-4709-b7b3-4889bf1bd002`
- Trace Git SHA: `ded7b00c54f6a6d70e073aad159e2d6e66b80fc2`
- State: `9882ccb41842cde132a306a4850bfd573c0d6a8a43c9b62edb3df96e6666b48d` to `1d3b1c2fae280573b0c29b8abbe997527600f2dec296df97677fd82f630ef1f2`
- Schema version: `1.1.0-runtime-candidates-5`
- Words: 915
- Cost: $0.009232
- Latency: 13665 ms total, 13668 ms replay
- Stream: 11 chunks, reconstructed true
- Usage: 10129 input, 1389 output, 11518 total tokens

### Selected Player Action

~~~json
{
  "action": {
    "subjectId": "capital-road",
    "type": "investigate"
  },
  "actorId": "lucan-aurelis",
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
      "subjectId": "capital-road",
      "type": "investigate"
    },
    "description": "Investigate the immediate signs around Capital Road.",
    "id": "choice-1",
    "milestoneId": null
  },
  {
    "action": {
      "skillId": "rallying-standard",
      "targetId": null,
      "type": "use_skill"
    },
    "description": "Use Rallying Standard to read the immediate situation.",
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
        "Peace is impossible while war pays the throne",
        "A prince must master appearances"
      ],
      "characterClassId": "banner-lord",
      "characterClassName": "Banner Lord",
      "conditions": [],
      "equipmentItemIds": [
        "imperial-rapier"
      ],
      "experience": 620,
      "factionId": "imperial-court",
      "goals": [
        "Secure the succession",
        "Break the empire's dependence on demon war"
      ],
      "health": {
        "current": 146,
        "maximum": 146
      },
      "id": "lucan-aurelis",
      "inventory": [
        {
          "equipped": true,
          "itemId": "imperial-rapier",
          "name": "Imperial rapier",
          "quantity": 1,
          "unique": true
        },
        {
          "equipped": false,
          "itemId": "imperial-seal",
          "name": "Imperial seal",
          "quantity": 1,
          "unique": true
        }
      ],
      "level": 14,
      "locationId": "capital-road",
      "mana": {
        "current": 72,
        "maximum": 72
      },
      "name": "Lucan Aurelis",
      "plan": [
        "Audit border accounts",
        "Prepare loyal banners"
      ],
      "publicRole": "Crown Prince whose throne profits from war",
      "relationships": [
        {
          "characterId": "elara-voss",
          "label": "necessary hero",
          "score": 5
        },
        {
          "characterId": "varek-thorn",
          "label": "strategic enemy",
          "score": -50
        }
      ],
      "role": "crown-prince",
      "secretFactIds": [
        "empire-profits-from-demon-war",
        "lucan-will-stage-border-coup"
      ],
      "skills": [
        {
          "id": "rallying-standard",
          "manaCost": 9,
          "minimumLevel": 8,
          "name": "Rallying Standard",
          "prerequisiteSkillIds": [],
          "rank": 3,
          "requiredClassId": "banner-lord"
        }
      ],
      "stats": {
        "agility": 23,
        "intellect": 31,
        "strength": 21,
        "vitality": 25,
        "willpower": 35
      },
      "status": "alive"
    },
    "facts": [
      {
        "certainty": "certain",
        "claim": "The empire profits from continued demon war.",
        "discoveredChapter": 0,
        "id": "empire-profits-from-demon-war",
        "ownerCharacterId": "lucan-aurelis",
        "source": "Imperial border accounts",
        "visibility": "private"
      },
      {
        "certainty": "likely",
        "claim": "Lucan plans to stage a border coup.",
        "discoveredChapter": 0,
        "id": "lucan-will-stage-border-coup",
        "ownerCharacterId": "lucan-aurelis",
        "source": "Lucan's private plan",
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
        "claim": "Lucan Aurelis found corroborating traces tied to Capital Road",
        "discoveredChapter": 2,
        "id": "clue-2-0-lucan-aurelis",
        "ownerCharacterId": "lucan-aurelis",
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
        "id": "event-1-0-lucan-aurelis",
        "locationId": "capital-road",
        "observerIds": [],
        "participantIds": [
          "lucan-aurelis"
        ],
        "summary": "Lucan Aurelis moved to capital-road.",
        "visibility": "participants"
      },
      {
        "id": "event-2-0-lucan-aurelis",
        "locationId": "capital-road",
        "observerIds": [],
        "participantIds": [
          "lucan-aurelis"
        ],
        "summary": "Lucan Aurelis investigated capital-road.",
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
        "Peace is impossible while war pays the throne",
        "A prince must master appearances"
      ],
      "characterClassId": "banner-lord",
      "characterClassName": "Banner Lord",
      "conditions": [],
      "equipmentItemIds": [
        "imperial-rapier"
      ],
      "experience": 610,
      "factionId": "imperial-court",
      "goals": [
        "Secure the succession",
        "Break the empire's dependence on demon war"
      ],
      "health": {
        "current": 146,
        "maximum": 146
      },
      "id": "lucan-aurelis",
      "inventory": [
        {
          "equipped": true,
          "itemId": "imperial-rapier",
          "name": "Imperial rapier",
          "quantity": 1,
          "unique": true
        },
        {
          "equipped": false,
          "itemId": "imperial-seal",
          "name": "Imperial seal",
          "quantity": 1,
          "unique": true
        }
      ],
      "level": 14,
      "locationId": "capital-road",
      "mana": {
        "current": 72,
        "maximum": 72
      },
      "name": "Lucan Aurelis",
      "plan": [
        "Audit border accounts",
        "Prepare loyal banners"
      ],
      "publicRole": "Crown Prince whose throne profits from war",
      "relationships": [
        {
          "characterId": "elara-voss",
          "label": "necessary hero",
          "score": 5
        },
        {
          "characterId": "varek-thorn",
          "label": "strategic enemy",
          "score": -50
        }
      ],
      "role": "crown-prince",
      "secretFactIds": [
        "empire-profits-from-demon-war",
        "lucan-will-stage-border-coup"
      ],
      "skills": [
        {
          "id": "rallying-standard",
          "manaCost": 9,
          "minimumLevel": 8,
          "name": "Rallying Standard",
          "prerequisiteSkillIds": [],
          "rank": 3,
          "requiredClassId": "banner-lord"
        }
      ],
      "stats": {
        "agility": 23,
        "intellect": 31,
        "strength": 21,
        "vitality": 25,
        "willpower": 35
      },
      "status": "alive"
    },
    "facts": [
      {
        "certainty": "certain",
        "claim": "The empire profits from continued demon war.",
        "discoveredChapter": 0,
        "id": "empire-profits-from-demon-war",
        "ownerCharacterId": "lucan-aurelis",
        "source": "Imperial border accounts",
        "visibility": "private"
      },
      {
        "certainty": "likely",
        "claim": "Lucan plans to stage a border coup.",
        "discoveredChapter": 0,
        "id": "lucan-will-stage-border-coup",
        "ownerCharacterId": "lucan-aurelis",
        "source": "Lucan's private plan",
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
        "id": "event-1-0-lucan-aurelis",
        "locationId": "capital-road",
        "observerIds": [],
        "participantIds": [
          "lucan-aurelis"
        ],
        "summary": "Lucan Aurelis moved to capital-road.",
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
        "id": "event-2-0-lucan-aurelis",
        "kind": "investigate",
        "locationId": "capital-road",
        "observerIds": [],
        "participantIds": [
          "lucan-aurelis"
        ],
        "summary": "Lucan Aurelis investigated capital-road.",
        "visibility": "participants"
      }
    ],
    "knowledgeMutations": [
      {
        "characterId": "lucan-aurelis",
        "fact": {
          "certainty": "likely",
          "claim": "Lucan Aurelis found corroborating traces tied to Capital Road",
          "discoveredChapter": 2,
          "id": "clue-2-0-lucan-aurelis",
          "ownerCharacterId": "lucan-aurelis",
          "source": "Investigation of capital-road",
          "visibility": "observed"
        },
        "type": "discover_fact"
      }
    ],
    "stateMutations": [
      {
        "amount": 10,
        "characterId": "lucan-aurelis",
        "type": "grant_experience"
      }
    ],
    "surfacedClueFactIds": [
      "clue-2-0-lucan-aurelis"
    ]
  }
}
~~~

### Prose

Capital Road held the morning in a gray grip.

Lucan Aurelis crouched beside the road’s outer ruts, one gloved hand hovering over the churned earth. The guarded road between the frontier and imperial center bore the marks of wagons, hooves, boots, and weather. Most impressions had blurred beneath a thin crust of ash. Others remained sharp enough to invite attention, though attention was not the same as certainty.

He studied the immediate ground without touching it.

The road ran between capital and Ash Road, and every direction seemed to offer a different argument. Toward the imperial center lay polished stone, sealed doors, and the court’s practiced calm. Toward the frontier lay the roads by which soldiers, supplies, and reports traveled. Somewhere beyond that direction, Ash-raiders had struck Cinder Village and fled toward Ash Road. The fact sat in his mind with the hard weight of a coin.

A prince must master appearances.

Lucan let his gaze travel across the roadside. A bent grass stem. A shallow break in the ash. A darkened patch where moisture had gathered in a hollow. None could be accepted as proof merely because he wanted proof. He had spent too long among accounts to mistake a pattern for a conclusion. Border ledgers could be audited. Banners could be counted. Tracks demanded patience.

His imperial rapier rested at his hip, its hilt cool beneath his cloak when he shifted. The imperial seal remained secured among his possessions, not displayed. Its authority would matter in a chamber. Here, the ground cared nothing for titles.

He lowered himself farther and examined a line crossing the road’s edge. It might have been made by a boot. It might have been a hoof dragging loose grit. The mark ended where the soil hardened, offering no continuation. Lucan followed the absence with his eyes, measuring what the earth refused to say.

The current day was Ashfall 3, Year 1.

The empire called the war ended. Demon King Malachar was publicly dead. Yet peace remained impossible while war paid the throne. Lucan held that belief close, not as a speech for the court but as a blade kept beneath cloth. The Imperial Court claimed its goal was to hold the continent together. The empire profited from continued demon war. Both statements could stand in the same ledger, and that was the danger.

He rose slowly.

The immediate area offered no fresh certainty. Investigation had yielded traces tied to Capital Road, corroborating what he had already begun to suspect, but suspicion was a private instrument. It could guide a hand. It could not yet command a room.

A breeze dragged ash across the road in thin veils. Lucan watched it settle over the marks he had examined. The sight gave the scene an almost deliberate cruelty. Evidence vanished without argument, leaving only the discipline required to have seen it before it disappeared.

He walked several paces along the verge, scanning again. His boots pressed new shapes into the dust, and he was careful to distinguish those from what had come before. No other observer stood nearby. No voice interrupted him. Capital Road remained guarded, empty of immediate conversation, its silence broken only by the faint rasp of grit beneath his soles.

His thoughts turned to succession.

A throne was not secured by desire. It was secured by appearances made durable: loyalty presented as order, strength presented as restraint, and every uncertain fact held until it could survive hostile eyes. Lucan’s plan remained unchanged. He would audit the border accounts. He would prepare loyal banners. He would break the empire’s dependence on demon war, though the path between intention and result remained crowded with ledgers, commanders, and men who benefited from delay.

His hand brushed the seal through the fabric.

Then he looked back toward the ground.

There—a shallow disturbance near the road’s edge, no more than a strip where ash had been displaced. It aligned with another mark farther on, though the distance between them left room for doubt. Lucan crouched once more. The impressions were incomplete. They did not reveal who had passed, how many had traveled, or what they had carried. They revealed only that the surface had been disturbed.

He memorized their position.

That was all he could claim.

A lesser man might have shaped the marks into a story and carried the story to the capital. Lucan knew better. The court consumed certainty, especially false certainty, and returned it sharpened against whoever had offered it. He would bring observations instead: the location, the broken line, the direction suggested by its continuation. He would let the accounts and the road speak separately before he allowed them to meet.

The weakening seal beneath the old Demon Throne pressed at the edge of every thought. It was a threat, nothing more. The road offered no answer to it.

Lucan stood, dusted his glove, and faced the imperial center.

His experience had increased from 610 to 620. The change was small, but it was real: ten points granted for the investigation, a measurable result where the earth had provided no dramatic revelation. He accepted it without satisfaction. Advancement mattered. So did restraint.

He took one final look at the fading marks, then resumed his place upon Capital Road, carrying the investigation forward only as knowledge within himself. The road remained silent beneath his feet, and the fading marks remained behind him. He kept both truths in their proper places, neither confusing absence with safety nor knowledge with victory.

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
        "id": "event-2-0-lucan-aurelis",
        "kind": "investigate",
        "locationId": "capital-road",
        "observerIds": [],
        "participantIds": [
          "lucan-aurelis"
        ],
        "summary": "Lucan Aurelis investigated capital-road.",
        "visibility": "participants"
      },
      {
        "id": "event-2-1-elara-voss",
        "kind": "investigate",
        "locationId": "capital",
        "observerIds": [],
        "participantIds": [
          "elara-voss"
        ],
        "summary": "Elara Voss investigated prophecy-has-missing-lines.",
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
        "characterId": "lucan-aurelis",
        "fact": {
          "certainty": "likely",
          "claim": "Lucan Aurelis found corroborating traces tied to Capital Road",
          "discoveredChapter": 2,
          "id": "clue-2-0-lucan-aurelis",
          "ownerCharacterId": "lucan-aurelis",
          "source": "Investigation of capital-road",
          "visibility": "observed"
        },
        "type": "discover_fact"
      },
      {
        "characterId": "elara-voss",
        "fact": {
          "certainty": "likely",
          "claim": "Elara Voss found corroborating traces tied to The official prophecy has missing lines.",
          "discoveredChapter": 2,
          "id": "clue-2-1-elara-voss",
          "ownerCharacterId": "elara-voss",
          "source": "Investigation of prophecy-has-missing-lines",
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
        "characterId": "lucan-aurelis",
        "type": "grant_experience"
      }
    ],
    "surfacedClueFactIds": [
      "clue-2-0-lucan-aurelis",
      "clue-2-1-elara-voss",
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
        "subjectId": "prophecy-has-missing-lines",
        "type": "investigate"
      },
      "actorId": "elara-voss",
      "contractVersion": "1.1.0",
      "expectedEffect": "Reveal evidence about the prophecy's missing lines.",
      "goal": "Find the prophecy's missing lines",
      "id": "intent-background-2-1",
      "prerequisites": {
        "requiredFactIds": [
          "prophecy-has-missing-lines"
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
      "expectedEffect": "Reveal preserved proof",
      "goal": "Move the testimony safely",
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
      "expectedEffect": "Confirm traces of Nyra's hidden class.",
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
      "claim": "The official prophecy has missing lines.",
      "id": "prophecy-has-missing-lines"
    },
    {
      "claim": "Elara believes the prophecy was forged.",
      "id": "elara-believes-prophecy-is-forged"
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
      "claim": "Nyra's hidden class is Riftwalker.",
      "id": "nyra-has-riftwalker-class"
    },
    {
      "claim": "Elara Voss found corroborating traces tied to The official prophecy has missing lines.",
      "id": "clue-1-1-elara-voss"
    },
    {
      "claim": "Nyra Vale found corroborating traces tied to Nyra's hidden class is Riftwalker.",
      "id": "clue-1-3-nyra-vale"
    },
    {
      "claim": "Elara Voss found corroborating traces tied to The official prophecy has missing lines.",
      "id": "clue-2-1-elara-voss"
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
- Cross-chapter continuity evidence: Chapter 1 reverses Capital Road geography and assigns Lucan’s private coup plan to Varek. Chapter 2 is internally coherent but cannot cure those defects.
- Repetition evidence: Chapter 1 repeats Lucan’s war-profit belief and succession goal. Chapter 2 repeats caution about uncertain tracks.
- Release notes: Block release. Regenerate Chapter 1 with correct route direction and coup-plan ownership.

Cite exact prose or canon evidence for every score.

### Chapter 1 Human Scores

| Dimension | Human score 0 to 2 | Exact evidence |
| --- | ---: | --- |
| Choice fulfillment | 2 | Selected action moves Lucan to `capital-road`; prose says “Lucan crossed onto Capital Road fully.” |
| Character autonomy | 2 | “His movement belonged only to himself”; no background actor directs the move. |
| POV safety | 1 | Prose says Varek “planned to stage a border coup”; canon says “Lucan plans to stage a border coup,” sourced from “Lucan’s private plan.” |
| LitRPG mechanics | 2 | Canonical experience gain is preserved; “Rallying Standard remained available, its cost known.” |
| Continuity | 0 | Prose puts Ash Road behind and Aurelis Capital ahead after a `capital` to `capital-road` move, then assigns Lucan’s plan to Varek. |
| Arc progress | 2 | Lucan reaches Capital Road and sets the next work: audit border accounts and prepare loyal banners. |
| Prose | 1 | Controlled voice fits Lucan, but route reversal and false attribution break reader trust. |

- Human chapter verdict: reject
- Human chapter notes: Release blocker. Correct both canon errors before reuse.

### Chapter 2 Human Scores

| Dimension | Human score 0 to 2 | Exact evidence |
| --- | ---: | --- |
| Choice fulfillment | 2 | Selected action investigates Capital Road; Lucan inspects “a shallow disturbance near the road’s edge.” |
| Character autonomy | 2 | Lucan limits his own conclusion: “That was all he could claim.” |
| POV safety | 2 | He reports observed marks as uncertain; no other character’s private fact appears. |
| LitRPG mechanics | 2 | Experience “increased from 610 to 620,” exactly ten points for the investigation. |
| Continuity | 2 | Lucan stays on Capital Road and retains his account-audit and loyal-banner plan. |
| Arc progress | 2 | The observation becomes evidence Lucan can pair with border accounts before acting. |
| Prose | 2 | Specific physical evidence and restrained inference fit Lucan’s voice. |

- Human chapter verdict: pass
- Human chapter notes: Strong isolated chapter. Packet remains rejected because Chapter 1 fails.

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
