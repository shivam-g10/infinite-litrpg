# POV Review Packet: varek-thorn

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

## Chapter 1: Ash Road

- Prose SHA-256: `c26ea1290f2969e7230103d069839ed9b9993f869ee2049dbc15c1ea53d4bc6a`
- Trace run ID: `192a9de8-0588-498d-a363-0c504f9cdd0c`
- Trace Git SHA: `ded7b00c54f6a6d70e073aad159e2d6e66b80fc2`
- State: `4c22d3ffbbec13b95a50ec7f6f20727fcd791d5c4aae84f2116fe6686e8ca228` to `18f1f4d6b8a93efd8792ccc8c540edd4ac3fc20e924071645e179e14eaf9058b`
- Schema version: `1.1.0-runtime-candidates-5`
- Words: 921
- Cost: $0.009114
- Latency: 15184 ms total, 15186 ms replay
- Stream: 11 chunks, reconstructed true
- Usage: 9732 input, 1416 output, 11148 total tokens

### Selected Player Action

~~~json
{
  "action": {
    "destinationId": "ash-road",
    "type": "move"
  },
  "actorId": "varek-thorn",
  "description": "Travel toward Ash Road.",
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
      "subjectId": "ash-road",
      "type": "investigate"
    },
    "description": "Investigate the immediate signs around Ash Road.",
    "id": "choice-1",
    "milestoneId": null
  },
  {
    "action": {
      "factionId": "ashen-legion",
      "locationId": "ash-road",
      "type": "rally"
    },
    "description": "Rally Ashen Legion at Ash Road.",
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
        "Oaths bind only while they protect the living",
        "The Black March remembers loyalty"
      ],
      "characterClassId": "dread-marshal",
      "characterClassName": "Dread Marshal",
      "conditions": [],
      "equipmentItemIds": [
        "march-cleaver"
      ],
      "experience": 2110,
      "factionId": "ashen-legion",
      "goals": [
        "Protect the Black March",
        "Decide whether Malachar's oath still rules him"
      ],
      "health": {
        "current": 318,
        "maximum": 318
      },
      "id": "varek-thorn",
      "inventory": [
        {
          "equipped": true,
          "itemId": "march-cleaver",
          "name": "March cleaver",
          "quantity": 1,
          "unique": true
        },
        {
          "equipped": false,
          "itemId": "black-ration",
          "name": "Black ration",
          "quantity": 5,
          "unique": false
        }
      ],
      "level": 27,
      "locationId": "ash-road",
      "mana": {
        "current": 88,
        "maximum": 88
      },
      "name": "Varek Thorn",
      "plan": [
        "Rally isolated companies",
        "Test reports of the old sovereign's return"
      ],
      "publicRole": "Former Demon General between oath and people",
      "relationships": [
        {
          "characterId": "rowan-ashborn",
          "label": "unknown echo",
          "score": 0
        },
        {
          "characterId": "lucan-aurelis",
          "label": "enemy prince",
          "score": -50
        }
      ],
      "role": "former-demon-general",
      "secretFactIds": [
        "old-oath-binds-varek-to-malachar"
      ],
      "skills": [
        {
          "id": "iron-command",
          "manaCost": 8,
          "minimumLevel": 15,
          "name": "Iron Command",
          "prerequisiteSkillIds": [],
          "rank": 5,
          "requiredClassId": "dread-marshal"
        }
      ],
      "stats": {
        "agility": 28,
        "intellect": 24,
        "strength": 52,
        "vitality": 55,
        "willpower": 46
      },
      "status": "alive"
    },
    "facts": [
      {
        "certainty": "certain",
        "claim": "Varek's old oath binds him to Malachar.",
        "discoveredChapter": 0,
        "id": "old-oath-binds-varek-to-malachar",
        "ownerCharacterId": "varek-thorn",
        "source": "Blood oath",
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
        "id": "event-1-0-varek-thorn",
        "locationId": "ash-road",
        "observerIds": [],
        "participantIds": [
          "varek-thorn"
        ],
        "summary": "Varek Thorn moved to ash-road.",
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
        "Oaths bind only while they protect the living",
        "The Black March remembers loyalty"
      ],
      "characterClassId": "dread-marshal",
      "characterClassName": "Dread Marshal",
      "conditions": [],
      "equipmentItemIds": [
        "march-cleaver"
      ],
      "experience": 2100,
      "factionId": "ashen-legion",
      "goals": [
        "Protect the Black March",
        "Decide whether Malachar's oath still rules him"
      ],
      "health": {
        "current": 318,
        "maximum": 318
      },
      "id": "varek-thorn",
      "inventory": [
        {
          "equipped": true,
          "itemId": "march-cleaver",
          "name": "March cleaver",
          "quantity": 1,
          "unique": true
        },
        {
          "equipped": false,
          "itemId": "black-ration",
          "name": "Black ration",
          "quantity": 5,
          "unique": false
        }
      ],
      "level": 27,
      "locationId": "black-march",
      "mana": {
        "current": 88,
        "maximum": 88
      },
      "name": "Varek Thorn",
      "plan": [
        "Rally isolated companies",
        "Test reports of the old sovereign's return"
      ],
      "publicRole": "Former Demon General between oath and people",
      "relationships": [
        {
          "characterId": "rowan-ashborn",
          "label": "unknown echo",
          "score": 0
        },
        {
          "characterId": "lucan-aurelis",
          "label": "enemy prince",
          "score": -50
        }
      ],
      "role": "former-demon-general",
      "secretFactIds": [
        "old-oath-binds-varek-to-malachar"
      ],
      "skills": [
        {
          "id": "iron-command",
          "manaCost": 8,
          "minimumLevel": 15,
          "name": "Iron Command",
          "prerequisiteSkillIds": [],
          "rank": 5,
          "requiredClassId": "dread-marshal"
        }
      ],
      "stats": {
        "agility": 28,
        "intellect": 24,
        "strength": 52,
        "vitality": 55,
        "willpower": 46
      },
      "status": "alive"
    },
    "facts": [
      {
        "certainty": "certain",
        "claim": "Varek's old oath binds him to Malachar.",
        "discoveredChapter": 0,
        "id": "old-oath-binds-varek-to-malachar",
        "ownerCharacterId": "varek-thorn",
        "source": "Blood oath",
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
        "id": "event-1-0-varek-thorn",
        "kind": "move",
        "locationId": "ash-road",
        "observerIds": [],
        "participantIds": [
          "varek-thorn"
        ],
        "summary": "Varek Thorn moved to ash-road.",
        "visibility": "participants"
      }
    ],
    "knowledgeMutations": [],
    "stateMutations": [
      {
        "characterId": "varek-thorn",
        "fromLocationId": "black-march",
        "toLocationIds": [
          "ash-road"
        ],
        "type": "set_location"
      },
      {
        "amount": 10,
        "characterId": "varek-thorn",
        "type": "grant_experience"
      }
    ],
    "surfacedClueFactIds": []
  }
}
~~~

### Prose

Ash Road ran gray beneath the second day of Ashfall, a hard line cut through fields that remembered battle only as broken stone and shallow scars. Varek Thorn reached it without ceremony. One moment the Black March held him in its cold, iron silence; the next, the road stretched beneath his boots, empty in both directions.

He stopped where the ground leveled.

The wind carried ash along the ruts. It gathered against his greaves, lifted, and scattered again. Varek watched the motion until the road blurred into a pale band beneath the sky. His hand rested on the March cleaver’s grip, not drawing it, merely feeling the familiar weight at his side. The weapon was singular, black-edged and ready, as it had been when the Ashen Legion still possessed enough soldiers to make its banners seem numerous.

The road led toward Cinder Village in one direction, toward the capital road in another, and back toward the Black March behind him. No company waited in sight. No messenger approached. No voice crossed the open ground.

That emptiness did not make the road peaceful.

Ash-raiders had struck Cinder Village and fled toward Ash Road. The fact stood before him with the clean, immovable shape of a wound. Rowan Ashborn and Nyra Vale had witnessed the aftermath. Varek knew no more than that. He would not purchase certainty with invention.

He looked toward Cinder Village.

Smoke was absent from the distant horizon. That meant only that smoke was absent. The thought came coldly, and he accepted it. A Dread Marshal could not command what he could not see, and he could not protect what he refused to measure honestly.

Behind him lay the Black March, defended by remnants of the Ashen Legion. Its goal was simple: protect the borderland. His goal was no different. Yet the old sovereign’s name pressed against every silence.

Malachar.

The Demon King had died at the end of the war. That was certain. So was the old oath. It bound Varek to Malachar. Both truths occupied him at once, locked together like teeth in a mechanism that no longer had a visible hand to turn it.

He had once believed an oath was strongest when it endured beyond reason. Now another belief held its ground: oaths bind only while they protect the living.

The wind scraped at his cloak. Varek drew a slow breath and tasted dust.

The seal beneath the old Demon Throne was weakening.

He did not know what that meant beyond the words. He did not know whether the dead sovereign could return, or whether a weakening seal promised only danger without a face. Reports of the old sovereign’s return needed testing. That was his plan. Rally isolated companies. Test what could be tested. Protect the Black March.

The order formed in him before it reached his mouth, though there was no one nearby to receive it.

Iron Command.

The skill waited behind his will, precise and costly. Its use would require eight measures of mana. Varek did not spend the reserve. Nothing stood before him that required command, and no strength was gained by shaping authority over empty air.

He let his hand fall from the cleaver.

Five black rations remained in his pack. Their weight was slight, but it reminded him that bodies required maintenance even when causes became uncertain. His own body was sound. The road had not taken blood from him. His endurance remained his, as did the strength in his arms and the will that had carried him across the borderland.

A faint measure of experience had joined him with the arrival. Ten points, no more, no less. It was not victory. It was not proof. It was simply a change, small enough to fit beside the road without altering it.

Varek turned his head toward the Black March.

The fortress land did not answer. Its dark ridges held the light in broken strips. Somewhere beyond them, isolated companies remained part of the Legion whether they stood beneath banners or not. He would rally them. The intention was clear. The method was not.

Toward Cinder Village, ash dragged itself over the road in thin veils. The raiders had withdrawn toward here, and the road gave no confession of their passing. Varek studied the ruts, the stones, the pale ditch grass. He found no clue and claimed none.

That restraint felt less like wisdom than discipline, but discipline had carried him farther than certainty.

Malachar was publicly dead.

The oath remained.

Varek faced the road ahead. His shadow stretched beside him, long and narrow, severed by a rut before joining itself again. He stepped forward, the March cleaver at his side, the black ration pack against his back, and the Ashen Legion’s purpose fixed within him.

The road offered no welcome.

He walked it anyway. The village fell behind without ceremony. Its ash-streaked walls narrowed, then blurred into the gray distance, while the road kept its patient line between ditch and field. Varek did not look back. He carried no answer from Cinder Village, only the same silence he had entered with, weighed now against the measured rhythm of his steps. The ruts broke the road into uneven lengths, and his shadow followed them, narrowing and widening beneath the pale air. Malachar’s name remained unspoken. The oath needed no witness. Varek continued beneath the burden of the black ration pack, the March cleaver resting at his side, and the purpose of the Ashen Legion held close as the road passed beneath him.

### Reviewer-Only Canon Appendix

Spoilers follow. Background intents are noncanonical proposals. The accepted delta is the sole new canon.

~~~json
{
  "acceptedDelta": {
    "acceptedIntentIds": [
      "intent-player-1-1",
      "intent-background-1-3",
      "intent-background-1-1"
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
        "id": "event-1-0-varek-thorn",
        "kind": "move",
        "locationId": "ash-road",
        "observerIds": [],
        "participantIds": [
          "varek-thorn"
        ],
        "summary": "Varek Thorn moved to ash-road.",
        "visibility": "participants"
      },
      {
        "id": "event-1-1-lucan-aurelis",
        "kind": "investigate",
        "locationId": "capital",
        "observerIds": [
          "elara-voss"
        ],
        "participantIds": [
          "lucan-aurelis"
        ],
        "summary": "Lucan Aurelis investigated empire-profits-from-demon-war.",
        "visibility": "participants"
      },
      {
        "id": "event-1-2-nyra-vale",
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
          "id": "clue-1-2-nyra-vale",
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
        "code": "KNOWLEDGE_MISSING",
        "intentId": "intent-background-1-2",
        "reason": "rowan-ashborn lacks fact cinder-raid-aftermath"
      }
    ],
    "stateMutations": [
      {
        "characterId": "varek-thorn",
        "fromLocationId": "black-march",
        "toLocationIds": [
          "ash-road"
        ],
        "type": "set_location"
      },
      {
        "amount": 10,
        "characterId": "varek-thorn",
        "type": "grant_experience"
      }
    ],
    "surfacedClueFactIds": [
      "clue-1-1-lucan-aurelis",
      "clue-1-2-nyra-vale"
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
      "expectedEffect": "Confirm imperial war profiteering details",
      "goal": "Audit border accounts discreetly",
      "id": "intent-background-1-3",
      "prerequisites": {
        "requiredFactIds": [
          "empire-profits-from-demon-war"
        ],
        "requiredItemIds": [],
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
      "id": "intent-background-1-1",
      "prerequisites": {
        "requiredFactIds": [
          "nyra-has-riftwalker-class"
        ],
        "requiredItemIds": [],
        "requiredSkillIds": []
      },
      "promptVersion": "1.4.11",
      "stateVersion": 1
    },
    {
      "action": {
        "subjectId": "cinder-raid-aftermath",
        "type": "investigate"
      },
      "actorId": "rowan-ashborn",
      "contractVersion": "1.1.0",
      "expectedEffect": "Read the ash trail toward Ash Road",
      "goal": "Trace the raiders without revealing Rowan's identity",
      "id": "intent-background-1-2",
      "prerequisites": {
        "requiredFactIds": [
          "cinder-raid-aftermath",
          "cinder-village-raided"
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
      "id": "clue-1-2-nyra-vale"
    }
  ]
}
~~~

## Chapter 2: Ash Road Investigation

- Prose SHA-256: `f15891a697ff8c815afdbfe370c94ccaca22a729ba1b6da42a70c1b742232edb`
- Trace run ID: `ddc359de-20e7-47c8-a3ff-a61ee0ff1b5a`
- Trace Git SHA: `ded7b00c54f6a6d70e073aad159e2d6e66b80fc2`
- State: `18f1f4d6b8a93efd8792ccc8c540edd4ac3fc20e924071645e179e14eaf9058b` to `9caece3ce3b1791cd5c14acd226e14461df3c5ec1de4751164be6f12eef059ca`
- Schema version: `1.1.0-runtime-candidates-5`
- Words: 917
- Cost: $0.011277
- Latency: 15681 ms total, 15684 ms replay
- Stream: 11 chunks, reconstructed true
- Usage: 13392 input, 1527 output, 14919 total tokens

### Selected Player Action

~~~json
{
  "action": {
    "subjectId": "ash-road",
    "type": "investigate"
  },
  "actorId": "varek-thorn",
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
      "subjectId": "ash-road",
      "type": "investigate"
    },
    "description": "Investigate the immediate signs around Ash Road.",
    "id": "choice-1",
    "milestoneId": null
  },
  {
    "action": {
      "factionId": "ashen-legion",
      "locationId": "ash-road",
      "type": "rally"
    },
    "description": "Rally Ashen Legion at Ash Road.",
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
        "Oaths bind only while they protect the living",
        "The Black March remembers loyalty"
      ],
      "characterClassId": "dread-marshal",
      "characterClassName": "Dread Marshal",
      "conditions": [],
      "equipmentItemIds": [
        "march-cleaver"
      ],
      "experience": 2120,
      "factionId": "ashen-legion",
      "goals": [
        "Protect the Black March",
        "Decide whether Malachar's oath still rules him"
      ],
      "health": {
        "current": 318,
        "maximum": 318
      },
      "id": "varek-thorn",
      "inventory": [
        {
          "equipped": true,
          "itemId": "march-cleaver",
          "name": "March cleaver",
          "quantity": 1,
          "unique": true
        },
        {
          "equipped": false,
          "itemId": "black-ration",
          "name": "Black ration",
          "quantity": 5,
          "unique": false
        }
      ],
      "level": 27,
      "locationId": "ash-road",
      "mana": {
        "current": 88,
        "maximum": 88
      },
      "name": "Varek Thorn",
      "plan": [
        "Rally isolated companies",
        "Test reports of the old sovereign's return"
      ],
      "publicRole": "Former Demon General between oath and people",
      "relationships": [
        {
          "characterId": "rowan-ashborn",
          "label": "unknown echo",
          "score": 0
        },
        {
          "characterId": "lucan-aurelis",
          "label": "enemy prince",
          "score": -50
        }
      ],
      "role": "former-demon-general",
      "secretFactIds": [
        "old-oath-binds-varek-to-malachar"
      ],
      "skills": [
        {
          "id": "iron-command",
          "manaCost": 8,
          "minimumLevel": 15,
          "name": "Iron Command",
          "prerequisiteSkillIds": [],
          "rank": 5,
          "requiredClassId": "dread-marshal"
        }
      ],
      "stats": {
        "agility": 28,
        "intellect": 24,
        "strength": 52,
        "vitality": 55,
        "willpower": 46
      },
      "status": "alive"
    },
    "facts": [
      {
        "certainty": "certain",
        "claim": "Varek's old oath binds him to Malachar.",
        "discoveredChapter": 0,
        "id": "old-oath-binds-varek-to-malachar",
        "ownerCharacterId": "varek-thorn",
        "source": "Blood oath",
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
        "claim": "Varek Thorn found corroborating traces tied to Ash Road",
        "discoveredChapter": 2,
        "id": "clue-2-0-varek-thorn",
        "ownerCharacterId": "varek-thorn",
        "source": "Investigation of ash-road",
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
        "id": "event-1-0-varek-thorn",
        "locationId": "ash-road",
        "observerIds": [],
        "participantIds": [
          "varek-thorn"
        ],
        "summary": "Varek Thorn moved to ash-road.",
        "visibility": "participants"
      },
      {
        "id": "event-2-0-varek-thorn",
        "locationId": "ash-road",
        "observerIds": [],
        "participantIds": [
          "varek-thorn"
        ],
        "summary": "Varek Thorn investigated ash-road.",
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
        "Oaths bind only while they protect the living",
        "The Black March remembers loyalty"
      ],
      "characterClassId": "dread-marshal",
      "characterClassName": "Dread Marshal",
      "conditions": [],
      "equipmentItemIds": [
        "march-cleaver"
      ],
      "experience": 2110,
      "factionId": "ashen-legion",
      "goals": [
        "Protect the Black March",
        "Decide whether Malachar's oath still rules him"
      ],
      "health": {
        "current": 318,
        "maximum": 318
      },
      "id": "varek-thorn",
      "inventory": [
        {
          "equipped": true,
          "itemId": "march-cleaver",
          "name": "March cleaver",
          "quantity": 1,
          "unique": true
        },
        {
          "equipped": false,
          "itemId": "black-ration",
          "name": "Black ration",
          "quantity": 5,
          "unique": false
        }
      ],
      "level": 27,
      "locationId": "ash-road",
      "mana": {
        "current": 88,
        "maximum": 88
      },
      "name": "Varek Thorn",
      "plan": [
        "Rally isolated companies",
        "Test reports of the old sovereign's return"
      ],
      "publicRole": "Former Demon General between oath and people",
      "relationships": [
        {
          "characterId": "rowan-ashborn",
          "label": "unknown echo",
          "score": 0
        },
        {
          "characterId": "lucan-aurelis",
          "label": "enemy prince",
          "score": -50
        }
      ],
      "role": "former-demon-general",
      "secretFactIds": [
        "old-oath-binds-varek-to-malachar"
      ],
      "skills": [
        {
          "id": "iron-command",
          "manaCost": 8,
          "minimumLevel": 15,
          "name": "Iron Command",
          "prerequisiteSkillIds": [],
          "rank": 5,
          "requiredClassId": "dread-marshal"
        }
      ],
      "stats": {
        "agility": 28,
        "intellect": 24,
        "strength": 52,
        "vitality": 55,
        "willpower": 46
      },
      "status": "alive"
    },
    "facts": [
      {
        "certainty": "certain",
        "claim": "Varek's old oath binds him to Malachar.",
        "discoveredChapter": 0,
        "id": "old-oath-binds-varek-to-malachar",
        "ownerCharacterId": "varek-thorn",
        "source": "Blood oath",
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
        "id": "event-1-0-varek-thorn",
        "locationId": "ash-road",
        "observerIds": [],
        "participantIds": [
          "varek-thorn"
        ],
        "summary": "Varek Thorn moved to ash-road.",
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
        "id": "event-2-0-varek-thorn",
        "kind": "investigate",
        "locationId": "ash-road",
        "observerIds": [],
        "participantIds": [
          "varek-thorn"
        ],
        "summary": "Varek Thorn investigated ash-road.",
        "visibility": "participants"
      }
    ],
    "knowledgeMutations": [
      {
        "characterId": "varek-thorn",
        "fact": {
          "certainty": "likely",
          "claim": "Varek Thorn found corroborating traces tied to Ash Road",
          "discoveredChapter": 2,
          "id": "clue-2-0-varek-thorn",
          "ownerCharacterId": "varek-thorn",
          "source": "Investigation of ash-road",
          "visibility": "observed"
        },
        "type": "discover_fact"
      }
    ],
    "stateMutations": [
      {
        "amount": 10,
        "characterId": "varek-thorn",
        "type": "grant_experience"
      }
    ],
    "surfacedClueFactIds": [
      "clue-2-0-varek-thorn"
    ]
  }
}
~~~

### Prose

Ash Road lay gray beneath the third day of Ashfall, its hard surface cutting through fields that had once been battlefields. Varek Thorn stood alone where the road widened between low banks of dead grass, listening to the silence settle over the land.

The silence did not feel empty. It carried the weight of the Black March, and the Black March remembered loyalty.

Varek lowered his gaze. Ash had gathered in the shallow ruts, soft enough to hold a mark and pale enough to reveal it. He studied the road without haste, letting his eyes separate old impressions from fresh disturbance. Wagon wheels had passed before. Boots had crossed in several directions. Wind had blurred most of the evidence into indistinct smears.

He crouched.

The movement drew a dull pull through his armor, but his body remained steady. The March cleaver hung at his side, its weight familiar, its edge undisturbed. Five black rations rested in his pack. Nothing else mattered here. The road mattered. The traces mattered. The report that Ash-raiders had struck Cinder Village and fled toward Ash Road mattered.

His gloved fingers hovered above a broken crust of ash.

There.

A narrow heel mark pressed deeper than the surrounding tracks. Beside it, the ash had been scuffed in a direction that did not match the older traffic. Varek shifted along the bank, following the disturbance by inches. More signs appeared: a heel dragged briefly, then lifted; a shallow line where something had brushed the road; a scatter of ash disturbed after the passage rather than before it.

He did not name the makers. The road offered no faces, and he had no need to invent them.

He followed the traces until they thinned near a patch of hard ground. There, the marks became faint but corroborating. The movement had gone toward Ash Road. That was enough to set the clue in its proper place, not enough to answer every question.

Varek rose.

The old oath bound him to Malachar. The truth sat inside him with the cold permanence of iron. Demon King Malachar had died at the end of the war. Both facts remained certain, and neither yielded to the other.

His hand closed once at his side.

Oaths bind only while they protect the living.

The belief was not a comfort. It was a blade he kept turned inward, testing the line between obedience and ruin. He had to protect the Black March. He had to decide whether Malachar’s oath still ruled him. The two demands stood together on the road, neither softened by distance or time.

At the edge of the bank, another impression interrupted the gray: a partial sole, angled toward the same direction as the others. Varek leaned closer. The track was fresh enough to preserve its shape, though not fresh enough to tell him more than that. He examined its depth, its edges, and the ash gathered inside it.

His investigation yielded no voice, no figure, and no answer beyond the road itself.

Still, the traces formed a line. Faint, broken, and incomplete, but real.

Varek turned his head toward Cinder Village. The village lay along the road’s reach, and the memory of the raid stood in the fact of it: Ash-raiders had struck, then withdrawn toward Ash Road. He did not add motives to the event. He did not imagine what waited ahead. His plan was narrower than imagination. Rally isolated companies. Test reports of the old sovereign’s return. Protect the Black March.

The seal beneath the old Demon Throne was weakening.

That threat required no embellishment. It pressed against every decision, silent and unseen, while the road offered only marks in ash.

Varek took one black ration from his pack, then returned it without opening the wrapper. Hunger could wait. His current strength remained whole, his will unspent, his mana undiminished. If the road demanded Iron Command, the skill waited within him, but no command belonged here. There was no company to rally, no soldier before him, no living ear to receive his voice.

He moved a few paces farther along the road, careful not to disturb the marks. The gray trade road stretched ahead between the old battlefields, branching toward the capital-road in one direction and the Black March in another. Its emptiness gave him no promise.

Varek memorized the visible pattern.

A heel. A drag. A broken crust. Ash scattered against the wind’s old work.

Then he looked back once at the path from Cinder Village and faced forward again. Ten points of hard-won understanding settled into him, small beside the weight of the oath but sufficient to sharpen the next step.

He began walking along Ash Road, following what the ground had allowed him to learn. The road held its silence around him. Behind, Cinder Village diminished into the gray distance, its path joining the scars and crossings he had already measured. Ahead, the marks remained faint but legible: a heel pressed into dust, a dragged edge, a break in the crust, ash lying where the wind had left it. Varek kept his attention lowered, matching each sign against the next without disturbing the pattern. The capital-road waited somewhere beyond the branching ground; the Black March lay along the other direction. Neither offered certainty. Only the road offered what he could read, and only reading could keep the oath from becoming blind weight. He continued along Ash Road, carrying those ten points of understanding with him as the gray distance opened before his steps.

### Reviewer-Only Canon Appendix

Spoilers follow. Background intents are noncanonical proposals. The accepted delta is the sole new canon.

~~~json
{
  "acceptedDelta": {
    "acceptedIntentIds": [
      "intent-player-2-2",
      "intent-background-2-3",
      "intent-background-2-1"
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
        "id": "event-2-0-varek-thorn",
        "kind": "investigate",
        "locationId": "ash-road",
        "observerIds": [],
        "participantIds": [
          "varek-thorn"
        ],
        "summary": "Varek Thorn investigated ash-road.",
        "visibility": "participants"
      },
      {
        "id": "event-2-1-lucan-aurelis",
        "kind": "investigate",
        "locationId": "capital",
        "observerIds": [
          "elara-voss"
        ],
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
        "summary": "Nyra Vale investigated clue-1-2-nyra-vale.",
        "visibility": "participants"
      }
    ],
    "expectedWorldVersion": 2,
    "knowledgeMutations": [
      {
        "characterId": "varek-thorn",
        "fact": {
          "certainty": "likely",
          "claim": "Varek Thorn found corroborating traces tied to Ash Road",
          "discoveredChapter": 2,
          "id": "clue-2-0-varek-thorn",
          "ownerCharacterId": "varek-thorn",
          "source": "Investigation of ash-road",
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
          "claim": "Nyra Vale found corroborating traces tied to Nyra Vale found corroborating traces tied to Nyra's hidden class is Riftwalker.",
          "discoveredChapter": 2,
          "id": "clue-2-2-nyra-vale",
          "ownerCharacterId": "nyra-vale",
          "source": "Investigation of clue-1-2-nyra-vale",
          "visibility": "observed"
        },
        "type": "discover_fact"
      }
    ],
    "promptVersion": "1.4.11",
    "rejectedIntents": [
      {
        "code": "KNOWLEDGE_MISSING",
        "intentId": "intent-background-2-2",
        "reason": "rowan-ashborn lacks fact cinder-raid-aftermath"
      }
    ],
    "stateMutations": [
      {
        "amount": 10,
        "characterId": "varek-thorn",
        "type": "grant_experience"
      }
    ],
    "surfacedClueFactIds": [
      "clue-2-0-varek-thorn",
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
      "goal": "Break dependence on demon war.",
      "id": "intent-background-2-3",
      "prerequisites": {
        "requiredFactIds": [
          "empire-profits-from-demon-war"
        ],
        "requiredItemIds": [],
        "requiredSkillIds": []
      },
      "promptVersion": "1.4.11",
      "stateVersion": 2
    },
    {
      "action": {
        "subjectId": "clue-1-2-nyra-vale",
        "type": "investigate"
      },
      "actorId": "nyra-vale",
      "contractVersion": "1.1.0",
      "expectedEffect": "Confirm traces supporting Nyra's hidden class.",
      "goal": "Identify her unrecorded class",
      "id": "intent-background-2-1",
      "prerequisites": {
        "requiredFactIds": [
          "nyra-has-riftwalker-class",
          "clue-1-2-nyra-vale"
        ],
        "requiredItemIds": [],
        "requiredSkillIds": []
      },
      "promptVersion": "1.4.11",
      "stateVersion": 2
    },
    {
      "action": {
        "approach": "question",
        "targetId": "nyra-vale",
        "type": "interact"
      },
      "actorId": "rowan-ashborn",
      "contractVersion": "1.1.0",
      "expectedEffect": "Learn what Nyra noticed.",
      "goal": "Read the ash trail with Nyra.",
      "id": "intent-background-2-2",
      "prerequisites": {
        "requiredFactIds": [
          "cinder-raid-aftermath",
          "event-1-2-nyra-vale"
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
      "id": "clue-1-2-nyra-vale"
    },
    {
      "claim": "Lucan Aurelis found corroborating traces tied to The empire profits from continued demon war.",
      "id": "clue-2-1-lucan-aurelis"
    },
    {
      "claim": "Nyra Vale found corroborating traces tied to Nyra Vale found corroborating traces tied to Nyra's hidden class is Riftwalker.",
      "id": "clue-2-2-nyra-vale"
    }
  ]
}
~~~

<!-- HUMAN REVIEW START -->

## Human Review Record

- Reviewer: Codex root agent, acting as human reviewer per user instruction
- Review date: 2026-07-20
- Final verdict: pass
- Cross-chapter continuity evidence: Chapter 1 moves Varek to Ash Road with no clue. Chapter 2 stays there and adds the likely trace. Both retain the March cleaver, five black rations, Malachar oath, and Black March goal.
- Repetition evidence: Both chapters repeat the gray road, Black March, oath, unused Iron Command, and limited certainty. Chapter 2 adds concrete track detail.
- Release notes: Pass. Both chapters stay canon-safe and mechanically faithful. Arc movement remains early and limited.

Cite exact prose or canon evidence for every score.

### Chapter 1 Human Scores

| Dimension | Human score 0 to 2 | Exact evidence |
| --- | ---: | --- |
| Choice fulfillment | 2 | Selected action moves to Ash Road; “Varek Thorn reached it,” and delta sets `black-march` to `ash-road`. |
| Character autonomy | 2 | “He found no clue and claimed none” while preserving his own rally and defense plans. |
| POV safety | 2 | “Varek knew no more than that” about Cinder Village; he invents no raider identity or motive. |
| LitRPG mechanics | 2 | Iron Command costs “eight measures of mana,” remains unused, and the canonical 10 experience is recorded. |
| Continuity | 2 | Five black rations, March cleaver, Malachar’s death, oath, and weakening seal remain consistent. |
| Arc progress | 1 | Arrival positions Varek for investigation, but he “found no clue” and no milestone changes. |
| Prose | 1 | Martial voice works, but road, oath, ration pack, cleaver, and Legion purpose repeat. |

- Human chapter verdict: pass
- Human chapter notes: Faithful setup. It advances location and pressure, not the mystery.

### Chapter 2 Human Scores

| Dimension | Human score 0 to 2 | Exact evidence |
| --- | ---: | --- |
| Choice fulfillment | 2 | Prose follows heel marks, drag, broken crust, and disturbed ash; accepted canon adds the likely trace. |
| Character autonomy | 2 | “He did not name the makers” and “He did not add motives to the event.” |
| POV safety | 2 | There is “no voice, no figure, and no answer beyond the road itself.” |
| LitRPG mechanics | 2 | Canon awards 10 experience; prose records “Ten points of hard-won understanding.” Iron Command stays unused. |
| Continuity | 2 | Ash Road, five rations, cleaver, oath, Cinder raid, and weakening-seal threat continue from Chapter 1. |
| Arc progress | 1 | The likely clue advances investigation but remains “faint, broken, and incomplete”; no milestone changes. |
| Prose | 1 | Concrete track reading works, but road, oath, ash, and uncertainty repeat. |

- Human chapter verdict: pass
- Human chapter notes: Canon-aligned investigation with a concrete, limited clue.

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
