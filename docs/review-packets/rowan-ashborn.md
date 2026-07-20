# POV Review Packet: rowan-ashborn

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

## Chapter 1: Read the Ash Trail

- Prose SHA-256: `8ee50a04ec45c91f9b2545fe739ad7a490fd76ce8a4dc4a879ef44d8d59cd97d`
- Trace run ID: `cce89baa-d24f-4667-a324-a0584a8667d1`
- Trace Git SHA: `4d47dfb7c748b9d620a81f37a849bf4c96b14edb`
- State: `d2074736cba4f3cf3941a5a02d6926717ddced6e10ea8d211cc3273532e834bd` to `6d2260fab7f34d65ae5b135d1e735e6eddf0197f2279c486127a4ce23f0b9caa`
- Schema version: `1.1.0-runtime-candidates-5`
- Words: 918
- Cost: $0.007248
- Latency: 20353 ms total, 20361 ms replay
- Stream: 11 chunks, reconstructed true
- Usage: 6948 input, 1258 output, 8206 total tokens

### Selected Player Action

~~~json
{
  "action": {
    "destinationId": "ash-road",
    "type": "move"
  },
  "actorId": "rowan-ashborn",
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
      "skillId": "ember-sense",
      "targetId": null,
      "type": "use_skill"
    },
    "description": "Use Ember Sense to read the immediate situation.",
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
        "Power without restraint destroyed Malachar",
        "No one can know who he was"
      ],
      "characterClassId": "ashbound",
      "characterClassName": "Ashbound",
      "conditions": [],
      "equipmentItemIds": [
        "rusted-sword"
      ],
      "experience": 10,
      "factionId": "cinder-survivors",
      "goals": [
        "Survive the ash-raider aftermath",
        "Hide his old identity"
      ],
      "health": {
        "current": 42,
        "maximum": 42
      },
      "id": "rowan-ashborn",
      "inventory": [
        {
          "equipped": true,
          "itemId": "rusted-sword",
          "name": "Rusted sword",
          "quantity": 1,
          "unique": true
        },
        {
          "equipped": false,
          "itemId": "copper-coin",
          "name": "Copper coin",
          "quantity": 9,
          "unique": false
        }
      ],
      "level": 1,
      "locationId": "ash-road",
      "mana": {
        "current": 18,
        "maximum": 18
      },
      "name": "Rowan Ashborn",
      "plan": [
        "Read the ash trail",
        "Learn what Nyra noticed"
      ],
      "publicRole": "Malachar reincarnated as a level-one human",
      "relationships": [
        {
          "characterId": "nyra-vale",
          "label": "uneasy ally",
          "score": 10
        },
        {
          "characterId": "varek-thorn",
          "label": "forgotten subordinate",
          "score": 0
        }
      ],
      "role": "reincarnated-demon-king",
      "secretFactIds": [
        "rowan-is-malachar-reincarnated"
      ],
      "skills": [
        {
          "id": "ember-sense",
          "manaCost": 2,
          "minimumLevel": 1,
          "name": "Ember Sense",
          "prerequisiteSkillIds": [],
          "rank": 1,
          "requiredClassId": "ashbound"
        },
        {
          "id": "sovereigns-echo",
          "manaCost": 5,
          "minimumLevel": 1,
          "name": "Sovereign's Echo",
          "prerequisiteSkillIds": [
            "ember-sense"
          ],
          "rank": 1,
          "requiredClassId": "ashbound"
        }
      ],
      "stats": {
        "agility": 6,
        "intellect": 10,
        "strength": 5,
        "vitality": 7,
        "willpower": 12
      },
      "status": "alive"
    },
    "facts": [
      {
        "certainty": "certain",
        "claim": "Rowan is Malachar reincarnated.",
        "discoveredChapter": 0,
        "id": "rowan-is-malachar-reincarnated",
        "ownerCharacterId": "rowan-ashborn",
        "source": "Reincarnation memory",
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
        "id": "event-1-0-rowan-ashborn",
        "locationId": "ash-road",
        "observerIds": [],
        "participantIds": [
          "rowan-ashborn"
        ],
        "summary": "Rowan Ashborn moved to ash-road.",
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
        "Power without restraint destroyed Malachar",
        "No one can know who he was"
      ],
      "characterClassId": "ashbound",
      "characterClassName": "Ashbound",
      "conditions": [],
      "equipmentItemIds": [
        "rusted-sword"
      ],
      "experience": 0,
      "factionId": "cinder-survivors",
      "goals": [
        "Survive the ash-raider aftermath",
        "Hide his old identity"
      ],
      "health": {
        "current": 42,
        "maximum": 42
      },
      "id": "rowan-ashborn",
      "inventory": [
        {
          "equipped": true,
          "itemId": "rusted-sword",
          "name": "Rusted sword",
          "quantity": 1,
          "unique": true
        },
        {
          "equipped": false,
          "itemId": "copper-coin",
          "name": "Copper coin",
          "quantity": 9,
          "unique": false
        }
      ],
      "level": 1,
      "locationId": "cinder-village",
      "mana": {
        "current": 18,
        "maximum": 18
      },
      "name": "Rowan Ashborn",
      "plan": [
        "Read the ash trail",
        "Learn what Nyra noticed"
      ],
      "publicRole": "Malachar reincarnated as a level-one human",
      "relationships": [
        {
          "characterId": "nyra-vale",
          "label": "uneasy ally",
          "score": 10
        },
        {
          "characterId": "varek-thorn",
          "label": "forgotten subordinate",
          "score": 0
        }
      ],
      "role": "reincarnated-demon-king",
      "secretFactIds": [
        "rowan-is-malachar-reincarnated"
      ],
      "skills": [
        {
          "id": "ember-sense",
          "manaCost": 2,
          "minimumLevel": 1,
          "name": "Ember Sense",
          "prerequisiteSkillIds": [],
          "rank": 1,
          "requiredClassId": "ashbound"
        },
        {
          "id": "sovereigns-echo",
          "manaCost": 5,
          "minimumLevel": 1,
          "name": "Sovereign's Echo",
          "prerequisiteSkillIds": [
            "ember-sense"
          ],
          "rank": 1,
          "requiredClassId": "ashbound"
        }
      ],
      "stats": {
        "agility": 6,
        "intellect": 10,
        "strength": 5,
        "vitality": 7,
        "willpower": 12
      },
      "status": "alive"
    },
    "facts": [
      {
        "certainty": "certain",
        "claim": "Rowan is Malachar reincarnated.",
        "discoveredChapter": 0,
        "id": "rowan-is-malachar-reincarnated",
        "ownerCharacterId": "rowan-ashborn",
        "source": "Reincarnation memory",
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
        "id": "event-1-0-rowan-ashborn",
        "kind": "move",
        "locationId": "ash-road",
        "observerIds": [],
        "participantIds": [
          "rowan-ashborn"
        ],
        "summary": "Rowan Ashborn moved to ash-road.",
        "visibility": "participants"
      }
    ],
    "knowledgeMutations": [],
    "stateMutations": [
      {
        "characterId": "rowan-ashborn",
        "fromLocationId": "cinder-village",
        "toLocationIds": [
          "ash-road"
        ],
        "type": "set_location"
      },
      {
        "amount": 10,
        "characterId": "rowan-ashborn",
        "type": "grant_experience"
      }
    ],
    "surfacedClueFactIds": []
  }
}
~~~

### Prose

Ash Road received Rowan Ashborn beneath a sky the color of cooled iron.

He stopped at its edge, where the packed gray track left Cinder Village behind. Smoke still dragged across the fields in thin ribbons. Beyond it, the road cut through old battlefields, straight and pale between low ridges of ash. The village had been struck by Ash-raiders. They had withdrawn toward this road. That was all Rowan knew for certain.

It was enough.

His hand settled on the rusted sword at his hip. The grip was rough beneath his fingers, and the familiar weight offered little comfort. He had nine copper coins, a body that could fail, and no room for careless power. His health was forty-two of forty-two. His mana was eighteen of eighteen. The numbers came to him with the quiet precision of a system that did not care whether he trusted it.

Rowan stepped onto the road.

Ash shifted beneath his boots. He lowered his gaze and studied the surface. Broken lines crossed the gray dust: boot marks, wheel cuts, scuffs blurred by wind. The trail was not clear enough to promise direction, yet it led toward Ash Road’s farther reaches, where the old battlefields widened and the road divided toward the capital road and the Black March.

He moved slowly.

A gust pulled at his coat and carried the taste of soot from behind him. Cinder Village remained at his back, burned and rebuilding beside the old demon roads. Rowan did not turn. Survival demanded forward motion, but forward motion did not require haste.

He crouched beside a darkened patch in the dust.

The ember-sense skill waited inside him, simple and sharp. He knew its cost: two mana. He could use it. He could also leave it untouched. Power without restraint had destroyed Malachar. The belief had survived every silence that followed the war, even when the name itself had been buried beneath the declaration that Demon King Malachar was dead.

Rowan kept his hand off the skill.

No one could know who he had been.

The thought came without heat. It was not fear exactly. Fear flared and faded. This was a rule, harder than fear, laid across every choice. He was Rowan Ashborn now: a level-one human, Ashbound, carrying a rusted sword and the past of a dead king where no eye could see it.

He rose and continued along the road.

The gray track dipped between two low banks. Ash gathered there in soft drifts, hiding the harder earth beneath. Rowan tested each step before committing his weight. His agility was six, his strength five, his vitality seven. Such figures were poor armor against the world. His willpower was twelve, his intellect ten. Those were better tools, but tools still required care.

Ahead, the road climbed.

He paused halfway up the slope and looked back. Cinder Village had become a dark cluster behind the smoke. No figures moved there that he could see. The road before him was empty. The old battlefields spread on either side, their surfaces broken by stones and shallow hollows. The weakening seal beneath the old Demon Throne was a fact of the world, distant but present in the shape of a danger no one could measure from here.

Rowan faced forward again.

At the crest, he found another stretch of disturbed ash. Several impressions overlapped near the roadside, their edges softened. He bent close without touching them. The trail remained a trail. Nothing more revealed itself.

His breath left him in a slow white thread despite the day’s muted warmth.

Nyra Vale had noticed something in the aftermath. Rowan’s plan was to learn what she had noticed. The thought belonged to later, when the road had given him enough distance from the village and when questions could be asked without turning into accusations. For now, Nyra remained an uneasy ally, and unease was safer than trust when the world had ash in its lungs.

He walked until the village smoke thinned behind him.

The road’s silence changed as he entered the old battlefield. Wind slid over the gray surface and stirred loose ash around his boots. Here, the ground seemed broader, stripped of all shelter. Rowan kept his sword hand relaxed and his attention moving from the trail to the ridges, from the ridges to the empty road ahead.

No raider appeared. No attack came. He received no sign beyond the marks already before him.

That absence was not safety. It was only absence.

At the next bend, Rowan stopped beneath the shadow of a weathered stone. He checked the sword’s position, felt the copper coins against his side, and listened to the wind pass over the battlefield.

Then he resumed his travel toward Ash Road, carrying his secret beneath the quiet weight of his steps. The road narrowed where the ash lay deepest, its pale surface broken by shallow ruts and scattered stones. Rowan moved through them without haste, keeping to the same measured pace. The ridges remained quiet on either side, their slopes bare beneath the open sky. Behind him, the battlefield faded into the distance, though the smell of ash still clung to the wind. Ahead, the road continued toward Ash Road in a long, empty line. Rowan kept his sword hand relaxed and his attention moving as before, from the trail to the ridges and back again. The coins rested against his side. He listened to the wind, watched the ground, and continued beneath the quiet weight of his steps.

### Reviewer-Only Canon Appendix

Spoilers follow. Background intents are noncanonical proposals. The accepted delta is the sole new canon.

~~~json
{
  "acceptedDelta": {
    "acceptedIntentIds": [
      "intent-player-1-1",
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
        "id": "event-1-0-rowan-ashborn",
        "kind": "move",
        "locationId": "ash-road",
        "observerIds": [],
        "participantIds": [
          "rowan-ashborn"
        ],
        "summary": "Rowan Ashborn moved to ash-road.",
        "visibility": "participants"
      },
      {
        "id": "event-1-1-nyra-vale",
        "kind": "investigate",
        "locationId": "cinder-village",
        "observerIds": [],
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
        "characterId": "nyra-vale",
        "fact": {
          "certainty": "likely",
          "claim": "Nyra Vale found corroborating traces tied to Nyra's hidden class is Riftwalker.",
          "discoveredChapter": 1,
          "id": "clue-1-1-nyra-vale",
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
        "characterId": "rowan-ashborn",
        "fromLocationId": "cinder-village",
        "toLocationIds": [
          "ash-road"
        ],
        "type": "set_location"
      },
      {
        "amount": 10,
        "characterId": "rowan-ashborn",
        "type": "grant_experience"
      }
    ],
    "surfacedClueFactIds": [
      "clue-1-1-nyra-vale"
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
        "subjectId": "nyra-has-riftwalker-class",
        "type": "investigate"
      },
      "actorId": "nyra-vale",
      "contractVersion": "1.1.0",
      "expectedEffect": "Confirm Nyra's hidden class.",
      "goal": "Identify her unrecorded class.",
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
    }
  ],
  "forbiddenFacts": [
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
      "claim": "Nyra Vale found corroborating traces tied to Nyra's hidden class is Riftwalker.",
      "id": "clue-1-1-nyra-vale"
    }
  ]
}
~~~

## Chapter 2: Read the Ash Trail

- Prose SHA-256: `628ef392b5a9cfb2168f13f451664b82424877d1b6674e0117328356b5729e21`
- Trace run ID: `2b68ad35-d51a-4ae3-87ab-31d922b17612`
- Trace Git SHA: `4d47dfb7c748b9d620a81f37a849bf4c96b14edb`
- State: `6d2260fab7f34d65ae5b135d1e735e6eddf0197f2279c486127a4ce23f0b9caa` to `a837022ad004dc07689652f56b4d75583ea53932cbe5c82201bb258327f77584`
- Schema version: `1.1.0-runtime-candidates-5`
- Words: 910
- Cost: $0.008282
- Latency: 15688 ms total, 15692 ms replay
- Stream: 11 chunks, reconstructed true
- Usage: 8583 input, 1330 output, 9913 total tokens

### Selected Player Action

~~~json
{
  "action": {
    "subjectId": "ash-road",
    "type": "investigate"
  },
  "actorId": "rowan-ashborn",
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
      "skillId": "ember-sense",
      "targetId": null,
      "type": "use_skill"
    },
    "description": "Use Ember Sense to read the immediate situation.",
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
        "Power without restraint destroyed Malachar",
        "No one can know who he was"
      ],
      "characterClassId": "ashbound",
      "characterClassName": "Ashbound",
      "conditions": [],
      "equipmentItemIds": [
        "rusted-sword"
      ],
      "experience": 20,
      "factionId": "cinder-survivors",
      "goals": [
        "Survive the ash-raider aftermath",
        "Hide his old identity"
      ],
      "health": {
        "current": 42,
        "maximum": 42
      },
      "id": "rowan-ashborn",
      "inventory": [
        {
          "equipped": true,
          "itemId": "rusted-sword",
          "name": "Rusted sword",
          "quantity": 1,
          "unique": true
        },
        {
          "equipped": false,
          "itemId": "copper-coin",
          "name": "Copper coin",
          "quantity": 9,
          "unique": false
        }
      ],
      "level": 1,
      "locationId": "ash-road",
      "mana": {
        "current": 18,
        "maximum": 18
      },
      "name": "Rowan Ashborn",
      "plan": [
        "Read the ash trail",
        "Learn what Nyra noticed"
      ],
      "publicRole": "Malachar reincarnated as a level-one human",
      "relationships": [
        {
          "characterId": "nyra-vale",
          "label": "uneasy ally",
          "score": 10
        },
        {
          "characterId": "varek-thorn",
          "label": "forgotten subordinate",
          "score": 0
        }
      ],
      "role": "reincarnated-demon-king",
      "secretFactIds": [
        "rowan-is-malachar-reincarnated"
      ],
      "skills": [
        {
          "id": "ember-sense",
          "manaCost": 2,
          "minimumLevel": 1,
          "name": "Ember Sense",
          "prerequisiteSkillIds": [],
          "rank": 1,
          "requiredClassId": "ashbound"
        },
        {
          "id": "sovereigns-echo",
          "manaCost": 5,
          "minimumLevel": 1,
          "name": "Sovereign's Echo",
          "prerequisiteSkillIds": [
            "ember-sense"
          ],
          "rank": 1,
          "requiredClassId": "ashbound"
        }
      ],
      "stats": {
        "agility": 6,
        "intellect": 10,
        "strength": 5,
        "vitality": 7,
        "willpower": 12
      },
      "status": "alive"
    },
    "facts": [
      {
        "certainty": "certain",
        "claim": "Rowan is Malachar reincarnated.",
        "discoveredChapter": 0,
        "id": "rowan-is-malachar-reincarnated",
        "ownerCharacterId": "rowan-ashborn",
        "source": "Reincarnation memory",
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
        "claim": "Rowan Ashborn found corroborating traces tied to Ash Road",
        "discoveredChapter": 2,
        "id": "clue-2-0-rowan-ashborn",
        "ownerCharacterId": "rowan-ashborn",
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
        "id": "event-1-0-rowan-ashborn",
        "locationId": "ash-road",
        "observerIds": [],
        "participantIds": [
          "rowan-ashborn"
        ],
        "summary": "Rowan Ashborn moved to ash-road.",
        "visibility": "participants"
      },
      {
        "id": "event-2-0-rowan-ashborn",
        "locationId": "ash-road",
        "observerIds": [],
        "participantIds": [
          "rowan-ashborn"
        ],
        "summary": "Rowan Ashborn investigated ash-road.",
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
        "Power without restraint destroyed Malachar",
        "No one can know who he was"
      ],
      "characterClassId": "ashbound",
      "characterClassName": "Ashbound",
      "conditions": [],
      "equipmentItemIds": [
        "rusted-sword"
      ],
      "experience": 10,
      "factionId": "cinder-survivors",
      "goals": [
        "Survive the ash-raider aftermath",
        "Hide his old identity"
      ],
      "health": {
        "current": 42,
        "maximum": 42
      },
      "id": "rowan-ashborn",
      "inventory": [
        {
          "equipped": true,
          "itemId": "rusted-sword",
          "name": "Rusted sword",
          "quantity": 1,
          "unique": true
        },
        {
          "equipped": false,
          "itemId": "copper-coin",
          "name": "Copper coin",
          "quantity": 9,
          "unique": false
        }
      ],
      "level": 1,
      "locationId": "ash-road",
      "mana": {
        "current": 18,
        "maximum": 18
      },
      "name": "Rowan Ashborn",
      "plan": [
        "Read the ash trail",
        "Learn what Nyra noticed"
      ],
      "publicRole": "Malachar reincarnated as a level-one human",
      "relationships": [
        {
          "characterId": "nyra-vale",
          "label": "uneasy ally",
          "score": 10
        },
        {
          "characterId": "varek-thorn",
          "label": "forgotten subordinate",
          "score": 0
        }
      ],
      "role": "reincarnated-demon-king",
      "secretFactIds": [
        "rowan-is-malachar-reincarnated"
      ],
      "skills": [
        {
          "id": "ember-sense",
          "manaCost": 2,
          "minimumLevel": 1,
          "name": "Ember Sense",
          "prerequisiteSkillIds": [],
          "rank": 1,
          "requiredClassId": "ashbound"
        },
        {
          "id": "sovereigns-echo",
          "manaCost": 5,
          "minimumLevel": 1,
          "name": "Sovereign's Echo",
          "prerequisiteSkillIds": [
            "ember-sense"
          ],
          "rank": 1,
          "requiredClassId": "ashbound"
        }
      ],
      "stats": {
        "agility": 6,
        "intellect": 10,
        "strength": 5,
        "vitality": 7,
        "willpower": 12
      },
      "status": "alive"
    },
    "facts": [
      {
        "certainty": "certain",
        "claim": "Rowan is Malachar reincarnated.",
        "discoveredChapter": 0,
        "id": "rowan-is-malachar-reincarnated",
        "ownerCharacterId": "rowan-ashborn",
        "source": "Reincarnation memory",
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
        "id": "event-1-0-rowan-ashborn",
        "locationId": "ash-road",
        "observerIds": [],
        "participantIds": [
          "rowan-ashborn"
        ],
        "summary": "Rowan Ashborn moved to ash-road.",
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
        "id": "event-2-0-rowan-ashborn",
        "kind": "investigate",
        "locationId": "ash-road",
        "observerIds": [],
        "participantIds": [
          "rowan-ashborn"
        ],
        "summary": "Rowan Ashborn investigated ash-road.",
        "visibility": "participants"
      }
    ],
    "knowledgeMutations": [
      {
        "characterId": "rowan-ashborn",
        "fact": {
          "certainty": "likely",
          "claim": "Rowan Ashborn found corroborating traces tied to Ash Road",
          "discoveredChapter": 2,
          "id": "clue-2-0-rowan-ashborn",
          "ownerCharacterId": "rowan-ashborn",
          "source": "Investigation of ash-road",
          "visibility": "observed"
        },
        "type": "discover_fact"
      }
    ],
    "stateMutations": [
      {
        "amount": 10,
        "characterId": "rowan-ashborn",
        "type": "grant_experience"
      }
    ],
    "surfacedClueFactIds": [
      "clue-2-0-rowan-ashborn"
    ]
  }
}
~~~

### Prose

Ash Road held the morning in a gray grip.

Rowan crouched beside the road’s broken edge, one gloved hand hovering above the powdery ash. The surface looked undisturbed at first: a flat smear between the old battlefield and the rutted track, scattered with pebbles and black splinters. Yet the road had been crossed. He could see it now in the shallow disturbances, each one almost erased by drifting soot.

He did not touch the first mark. He leaned closer instead.

A narrow heel had pressed into the ash, then lifted cleanly. Farther on, another print overlapped a wheel rut. The impressions angled away from Cinder Village, toward the road’s branching distance. Ash Road ran between the old battlefields, with Cinder Village behind him and the routes toward Capital Road and the Black March ahead. The tracks followed the road rather than leaving it.

Fresh tracks. That was what he had come to find.

The knowledge should have been simple. It was not. His pulse gave one hard beat beneath his ribs, and the rusted sword at his hip shifted against his thigh as he lowered himself farther. He had only a rusted sword, nine copper coins, and the strength of a level-one Ashbound. None of those facts changed because the trail had become clearer.

His fingers tightened against the ground.

The ash was cool on top and faintly warm beneath. Rowan stilled. The warmth might have belonged to the buried road, to the old fields, to the day itself. He would not give it a story. Power without restraint had destroyed Malachar. That belief had survived every silence, and it warned him against turning a sign into certainty merely because certainty felt useful.

He drew a slow breath and let Ember Sense answer.

Two mana left him in a measured thread. The skill did not transform the road or show him a hidden shape. It sharpened what was already there: disturbed ash, faint impressions, a broken line where something had dragged across the surface before vanishing beneath the next layer. The effect passed quickly. His mana settled at sixteen of eighteen.

Rowan moved along the marks on bent knees.

The impressions varied in depth. Some were crisp enough to hold their edges. Others had softened, though not into nothing. He counted them without deciding how many feet had made them. He noted where the ash had gathered in the hollows and where the gray dust lay thin across the road. He studied a small crescent scraped beside one print, then the longer interruption near the wheel rut.

Nothing else announced itself.

The ash-raiders had struck Cinder Village and fled toward Ash Road. That was certain. The trail before him corroborated the road’s direction, but it did not give him more than that. Rowan kept his conclusions narrow. A narrow truth could be carried. A swollen one could break a man’s hands.

He rose and looked back.

Cinder Village lay beyond the road’s bends, out of sight from where he stood. Nyra Vale had been there in the aftermath. Their uneasy alliance was a fact he carried carefully, like a chipped cup. He had planned to learn what she noticed, but no answer came across the distance. No voice reached him. No figure appeared on the road. There was only the ash, the road, and the marks he had found by looking.

He turned forward again.

For an instant, the road seemed to divide beneath his attention. Capital Road promised one direction. The Black March marked another. The old battlefields surrounded both with their gray silence. Above them all, the threat remained: the seal beneath the old Demon Throne was weakening.

Rowan pressed his thumb against the rusted sword’s worn grip. He did not draw it. The gesture steadied his hand without changing anything else.

A small stone rested inside one footprint. He shifted it aside with the tip of his boot and saw the print’s edge break. The mark had been real before he disturbed it. Now it was only partly real, like every clue after a careless hand. He stepped away from the remaining impressions.

The road offered no name, no face, no promise.

That was enough.

He followed the visible trail a short distance, placing his boots beyond the marks. Each step demanded attention. Ash whispered under his soles. The gray surface accepted the disturbance and left it behind. Rowan kept his gaze lowered, reading what remained without asking the road to reveal more than it held.

Ten experience settled into him without spectacle. There was no flare of light, no change in his level. The gain simply became part of the measure he carried, experience rising from ten to twenty while the first level remained fixed. He noticed it, recorded it, and returned his attention to the trail.

Survive the aftermath. Hide the old identity. Those goals remained his own, untouched by the road’s silence.

He stopped where the tracks thinned into ordinary ash. Ahead, the marks continued in fragments, still angled away from Cinder Village. Behind him, the village remained distant. Rowan let his hand fall from the sword and stood alone beneath the pale sky, with the weakening seal somewhere beyond sight and the gray road stretching between what had been disturbed and what had not.

Then he bent once more to inspect the next print. Its edge held the same faint distortion, a shallow mark in the ash, leading onward through the pale road.

### Reviewer-Only Canon Appendix

Spoilers follow. Background intents are noncanonical proposals. The accepted delta is the sole new canon.

~~~json
{
  "acceptedDelta": {
    "acceptedIntentIds": [
      "intent-player-2-2",
      "intent-background-2-1",
      "intent-background-2-2"
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
        "id": "event-2-0-rowan-ashborn",
        "kind": "investigate",
        "locationId": "ash-road",
        "observerIds": [],
        "participantIds": [
          "rowan-ashborn"
        ],
        "summary": "Rowan Ashborn investigated ash-road.",
        "visibility": "participants"
      },
      {
        "id": "event-2-1-nyra-vale",
        "kind": "investigate",
        "locationId": "cinder-village",
        "observerIds": [],
        "participantIds": [
          "nyra-vale"
        ],
        "summary": "Nyra Vale investigated clue-1-1-nyra-vale.",
        "visibility": "participants"
      },
      {
        "id": "event-2-2-varek-thorn",
        "kind": "rally",
        "locationId": "black-march",
        "observerIds": [],
        "participantIds": [
          "varek-thorn"
        ],
        "summary": "Varek Thorn rallied ashen-legion at black-march.",
        "visibility": "participants"
      }
    ],
    "expectedWorldVersion": 2,
    "knowledgeMutations": [
      {
        "characterId": "rowan-ashborn",
        "fact": {
          "certainty": "likely",
          "claim": "Rowan Ashborn found corroborating traces tied to Ash Road",
          "discoveredChapter": 2,
          "id": "clue-2-0-rowan-ashborn",
          "ownerCharacterId": "rowan-ashborn",
          "source": "Investigation of ash-road",
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
          "id": "clue-2-1-nyra-vale",
          "ownerCharacterId": "nyra-vale",
          "source": "Investigation of clue-1-1-nyra-vale",
          "visibility": "observed"
        },
        "type": "discover_fact"
      }
    ],
    "promptVersion": "1.4.11",
    "rejectedIntents": [],
    "stateMutations": [
      {
        "amount": 10,
        "characterId": "rowan-ashborn",
        "type": "grant_experience"
      }
    ],
    "surfacedClueFactIds": [
      "clue-2-0-rowan-ashborn",
      "clue-2-1-nyra-vale"
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
        "subjectId": "clue-1-1-nyra-vale",
        "type": "investigate"
      },
      "actorId": "nyra-vale",
      "contractVersion": "1.1.0",
      "expectedEffect": "Confirm traces linked to Nyra's hidden class.",
      "goal": "Identify her unrecorded class",
      "id": "intent-background-2-1",
      "prerequisites": {
        "requiredFactIds": [
          "nyra-has-riftwalker-class",
          "clue-1-1-nyra-vale"
        ],
        "requiredItemIds": [],
        "requiredSkillIds": []
      },
      "promptVersion": "1.4.11",
      "stateVersion": 2
    },
    {
      "action": {
        "factionId": "ashen-legion",
        "locationId": "black-march",
        "type": "rally"
      },
      "actorId": "varek-thorn",
      "contractVersion": "1.1.0",
      "expectedEffect": "Rally isolated companies defending the Black March.",
      "goal": "Protect the Black March",
      "id": "intent-background-2-2",
      "prerequisites": {
        "requiredFactIds": [
          "cinder-village-raided"
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
      "claim": "Nyra Vale found corroborating traces tied to Nyra's hidden class is Riftwalker.",
      "id": "clue-1-1-nyra-vale"
    },
    {
      "claim": "Nyra Vale found corroborating traces tied to Nyra Vale found corroborating traces tied to Nyra's hidden class is Riftwalker.",
      "id": "clue-2-1-nyra-vale"
    }
  ]
}
~~~

<!-- HUMAN REVIEW START -->

## Human Review Record

- Reviewer: Codex root agent, acting as human reviewer per user instruction
- Review date: 2026-07-20
- Final verdict: reject
- Cross-chapter continuity evidence: Chapter 1 leaves Ember Sense unused: “Rowan kept his hand off the skill” and mana “eighteen of eighteen.” Chapter 2 says “Two mana left him” and “mana settled at sixteen of eighteen,” but the accepted delta contains only `grant_experience`; canon remains 18/18.
- Repetition evidence: Both chapters repeat cautious Ash Road track study. Chapter 1 says “He lowered his gaze and studied the surface”; Chapter 2 says “Rowan crouched beside the road’s broken edge.”
- Release notes: Block release. Regenerate Chapter 2 without uncommitted skill use. Add deterministic narration-state coverage.

Cite exact prose or canon evidence for every score.

### Chapter 1 Human Scores

| Dimension | Human score 0 to 2 | Exact evidence |
| --- | ---: | --- |
| Choice fulfillment | 2 | Selected action is `move` to `ash-road`; accepted delta says “Rowan Ashborn moved to ash-road,” and prose says “Rowan stepped onto the road.” |
| Character autonomy | 2 | Rowan chooses: “He could use it. He could also leave it untouched” and “Rowan kept his hand off the skill.” |
| POV safety | 2 | “That was all Rowan knew for certain”; the seal stays “distant” rather than becoming new private knowledge. |
| LitRPG mechanics | 2 | “health was forty-two of forty-two. His mana was eighteen of eighteen”; Ember Sense’s “cost: two mana” is stated but not spent. |
| Continuity | 2 | Accepted delta commits `ash-road`; prose puts Cinder Village behind Rowan and keeps him on Ash Road. |
| Arc progress | 2 | The committed move advances chapter 0 to 1 and begins the Act 1 trail investigation. |
| Prose | 1 | Concrete atmosphere works, but “He moved slowly,” “He rose and continued,” and “He walked” repeat one beat. |

- Human chapter verdict: pass
- Human chapter notes: Selected move is met. Repetition is not release-blocking.

### Chapter 2 Human Scores

| Dimension | Human score 0 to 2 | Exact evidence |
| --- | ---: | --- |
| Choice fulfillment | 2 | Selected action investigates fresh tracks; accepted delta says “Rowan Ashborn investigated ash-road,” and prose says “Fresh tracks. That was what he had come to find.” |
| Character autonomy | 2 | “He would not give it a story” and “Rowan kept his conclusions narrow.” |
| POV safety | 2 | “The trail before him corroborated the road’s direction, but it did not give him more than that.” |
| LitRPG mechanics | 0 | “Two mana left him” and “mana settled at sixteen of eighteen,” but accepted state mutations contain only `grant_experience`. |
| Continuity | 0 | Canon before and after keeps mana at 18/18; prose invents an uncommitted 16/18 state. |
| Arc progress | 2 | Accepted delta advances chapter 1 to 2 and commits “corroborating traces tied to Ash Road.” |
| Prose | 1 | Rowan’s restrained voice fits, but repeated track reading and invented mana loss break reader trust. |

- Human chapter verdict: reject
- Human chapter notes: Release blocker. Narration and accepted state disagree on mana.

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
