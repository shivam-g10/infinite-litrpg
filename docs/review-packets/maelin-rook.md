# POV Review Packet: maelin-rook

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

## Chapter 1: Trace the Hidden Threat

- Prose SHA-256: `2ed0d3140edb44b20755402529361ea499c6475cd2b6ccb1437eefd687d8cafd`
- Trace run ID: `b8a0ddea-9a05-4f5d-9212-b4691caba5a6`
- Trace Git SHA: `ded7b00c54f6a6d70e073aad159e2d6e66b80fc2`
- State: `292871826816a4e4fa8fbdf6a724757974d7b3881530d8a5545e46276c356ca5` to `6ec70bf5053547ab410ae2861ce13aed0134009cecb3fcb794fdee5d0204ac47`
- Schema version: `1.1.0-runtime-candidates-5`
- Words: 908
- Cost: $0.016467
- Latency: 29128 ms total, 29131 ms replay
- Stream: 11 chunks, reconstructed true
- Usage: 13015 input, 3320 output, 16335 total tokens

### Selected Player Action

~~~json
{
  "action": {
    "destinationId": "capital",
    "type": "move"
  },
  "actorId": "maelin-rook",
  "description": "Travel toward Aurelis Capital.",
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
      "subjectId": "capital",
      "type": "investigate"
    },
    "description": "Investigate the immediate signs around Aurelis Capital.",
    "id": "choice-1",
    "milestoneId": null
  },
  {
    "action": {
      "approach": "Ask for a direct account.",
      "targetId": "elara-voss",
      "type": "interact"
    },
    "description": "Ask Elara Voss what they know now.",
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
        "Truth can survive the Church",
        "Mercy without truth becomes obedience"
      ],
      "characterClassId": "oracle",
      "characterClassName": "Oracle",
      "conditions": [],
      "equipmentItemIds": [
        "saints-censer"
      ],
      "experience": 910,
      "factionId": "solar-church",
      "goals": [
        "Preserve proof of the deeper threat",
        "Keep the Church from purging witnesses"
      ],
      "health": {
        "current": 132,
        "maximum": 132
      },
      "id": "maelin-rook",
      "inventory": [
        {
          "equipped": true,
          "itemId": "saints-censer",
          "name": "Saint's censer",
          "quantity": 1,
          "unique": true
        },
        {
          "equipped": false,
          "itemId": "sealed-testimony",
          "name": "Sealed testimony",
          "quantity": 1,
          "unique": true
        }
      ],
      "level": 16,
      "locationId": "capital",
      "mana": {
        "current": 154,
        "maximum": 154
      },
      "name": "Maelin Rook",
      "plan": [
        "Move the testimony",
        "Contact Elara without alerting the synod"
      ],
      "publicRole": "Saint guarding the Church's buried proof",
      "relationships": [
        {
          "characterId": "elara-voss",
          "label": "trusted hero",
          "score": 45
        },
        {
          "characterId": "lucan-aurelis",
          "label": "watched prince",
          "score": -5
        }
      ],
      "role": "saint",
      "secretFactIds": [
        "malachar-contained-the-void"
      ],
      "skills": [
        {
          "id": "truths-lantern",
          "manaCost": 10,
          "minimumLevel": 10,
          "name": "Truth's Lantern",
          "prerequisiteSkillIds": [],
          "rank": 3,
          "requiredClassId": "oracle"
        }
      ],
      "stats": {
        "agility": 14,
        "intellect": 36,
        "strength": 12,
        "vitality": 22,
        "willpower": 41
      },
      "status": "alive"
    },
    "facts": [
      {
        "certainty": "certain",
        "claim": "Malachar contained the Void beneath his throne.",
        "discoveredChapter": 0,
        "id": "malachar-contained-the-void",
        "ownerCharacterId": "maelin-rook",
        "source": "Sealed Church testimony",
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
        "id": "event-1-0-maelin-rook",
        "locationId": "capital",
        "observerIds": [
          "elara-voss",
          "lucan-aurelis"
        ],
        "participantIds": [
          "maelin-rook"
        ],
        "summary": "Maelin Rook moved to capital.",
        "visibility": "participants"
      },
      {
        "id": "event-1-1-elara-voss",
        "locationId": "capital",
        "observerIds": [
          "maelin-rook",
          "lucan-aurelis"
        ],
        "participantIds": [
          "elara-voss"
        ],
        "summary": "Elara Voss investigated prophecy-has-missing-lines.",
        "visibility": "participants"
      },
      {
        "id": "event-1-2-lucan-aurelis",
        "locationId": "capital",
        "observerIds": [
          "elara-voss",
          "maelin-rook"
        ],
        "participantIds": [
          "lucan-aurelis"
        ],
        "summary": "Lucan Aurelis investigated empire-profits-from-demon-war.",
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
        "Truth can survive the Church",
        "Mercy without truth becomes obedience"
      ],
      "characterClassId": "oracle",
      "characterClassName": "Oracle",
      "conditions": [],
      "equipmentItemIds": [
        "saints-censer"
      ],
      "experience": 900,
      "factionId": "solar-church",
      "goals": [
        "Preserve proof of the deeper threat",
        "Keep the Church from purging witnesses"
      ],
      "health": {
        "current": 132,
        "maximum": 132
      },
      "id": "maelin-rook",
      "inventory": [
        {
          "equipped": true,
          "itemId": "saints-censer",
          "name": "Saint's censer",
          "quantity": 1,
          "unique": true
        },
        {
          "equipped": false,
          "itemId": "sealed-testimony",
          "name": "Sealed testimony",
          "quantity": 1,
          "unique": true
        }
      ],
      "level": 16,
      "locationId": "high-basilica",
      "mana": {
        "current": 154,
        "maximum": 154
      },
      "name": "Maelin Rook",
      "plan": [
        "Move the testimony",
        "Contact Elara without alerting the synod"
      ],
      "publicRole": "Saint guarding the Church's buried proof",
      "relationships": [
        {
          "characterId": "elara-voss",
          "label": "trusted hero",
          "score": 45
        },
        {
          "characterId": "lucan-aurelis",
          "label": "watched prince",
          "score": -5
        }
      ],
      "role": "saint",
      "secretFactIds": [
        "malachar-contained-the-void"
      ],
      "skills": [
        {
          "id": "truths-lantern",
          "manaCost": 10,
          "minimumLevel": 10,
          "name": "Truth's Lantern",
          "prerequisiteSkillIds": [],
          "rank": 3,
          "requiredClassId": "oracle"
        }
      ],
      "stats": {
        "agility": 14,
        "intellect": 36,
        "strength": 12,
        "vitality": 22,
        "willpower": 41
      },
      "status": "alive"
    },
    "facts": [
      {
        "certainty": "certain",
        "claim": "Malachar contained the Void beneath his throne.",
        "discoveredChapter": 0,
        "id": "malachar-contained-the-void",
        "ownerCharacterId": "maelin-rook",
        "source": "Sealed Church testimony",
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
        "id": "event-1-0-maelin-rook",
        "kind": "move",
        "locationId": "capital",
        "observerIds": [
          "elara-voss",
          "lucan-aurelis"
        ],
        "participantIds": [
          "maelin-rook"
        ],
        "summary": "Maelin Rook moved to capital.",
        "visibility": "participants"
      },
      {
        "id": "event-1-1-elara-voss",
        "kind": "investigate",
        "locationId": "capital",
        "observerIds": [
          "maelin-rook",
          "lucan-aurelis"
        ],
        "participantIds": [
          "elara-voss"
        ],
        "summary": "Elara Voss investigated prophecy-has-missing-lines.",
        "visibility": "participants"
      },
      {
        "id": "event-1-2-lucan-aurelis",
        "kind": "investigate",
        "locationId": "capital",
        "observerIds": [
          "elara-voss",
          "maelin-rook"
        ],
        "participantIds": [
          "lucan-aurelis"
        ],
        "summary": "Lucan Aurelis investigated empire-profits-from-demon-war.",
        "visibility": "participants"
      }
    ],
    "knowledgeMutations": [],
    "stateMutations": [
      {
        "characterId": "maelin-rook",
        "fromLocationId": "high-basilica",
        "toLocationIds": [
          "capital"
        ],
        "type": "set_location"
      },
      {
        "amount": 10,
        "characterId": "maelin-rook",
        "type": "grant_experience"
      }
    ],
    "surfacedClueFactIds": []
  }
}
~~~

### Prose

Maelin Rook reached Aurelis Capital beneath the gray light of Ashfall 2.

The capital stood as the imperial center of the postwar continent, its streets bearing the dull movement of people who had not forgotten war but had learned to walk around its shape. Maelin entered without ceremony. No bell announced him. No hand rose in greeting. The move was complete, and that was all the world permitted him to know.

The sealed testimony rested against him, kept close beneath his saint’s robes. Its weight was small. Its meaning was not.

He had left the High Basilica behind. The Solar Church remained there, with its sealed archives and its purpose: preserving the postwar faith. Maelin had guarded the Church’s buried proof long enough to understand how easily proof could become a weapon in the hands of those who feared it. Truth could survive the Church. Mercy without truth became obedience.

The thought followed him through the capital’s streets.

He kept his pace measured. His censer hung at his side, unused, its metal dark beneath the soot-colored daylight. He did not reach for it. Nothing required its flame. Nothing allowed him to alter what had already happened.

The prophecy had missing lines.

Elara Voss had investigated that fact in the capital. Maelin knew this because she had done so where he was present as an observer, not because he had spoken with her or because her investigation had reached him. The distinction mattered. He held it carefully, as he held the testimony.

Elara was a trusted hero. The trust between them had survived with a narrow strength, enough for Maelin to keep her in his plan and not enough to make certainty from hope. He intended to contact her without alerting the synod. Intention was not contact. Arrival was not notice. He repeated the boundaries inwardly until they became steadier than prayer.

Across the capital, Lucan Aurelis had investigated another matter: the empire profited from the demon war.

Maelin knew that because Lucan’s investigation was visible to him. He did not know what Lucan had found. He did not attach the investigation to any cause, confession, alliance, or answer. Lucan remained a watched prince, and the thought carried no permission to approach him. The prince’s search was simply a fact within the capital, as solid and impersonal as the road beneath Maelin’s feet.

The day offered no other certainty.

A wind moved through the avenue, carrying ash against the stone walls. It caught at Maelin’s sleeves and pressed the scent of burned dust into his breath. He continued toward the city’s inner streets, where the capital’s imperial center gathered its towers, offices, and guarded distances into one severe mass.

Beneath his throne, Malachar had contained the Void.

That was certain.

Demon King Malachar had died at the end of the war.

That was certain as well.

The seal beneath the old Demon Throne was weakening.

That was the threat.

Maelin did not let the three truths touch beyond their exact edges. He did not build a cause between them. He did not name what the weakening meant. The testimony remained sealed. The proof remained proof. His task was to preserve it and keep the Church from purging witnesses, though no witness stood before him now, and no purge had begun within the day’s permitted shape.

He reached a quieter stretch of road and paused beneath the shadow of a high wall. The capital continued around him. Footsteps crossed behind him. Voices rose and fell, too indistinct to become knowledge. His body remained whole, his strength unspent. His mana remained full. Truth’s Lantern waited within him, a skill whose light he did not summon.

Aurelis Capital gave him no welcome and no refusal.

Maelin looked toward the direction of the High Basilica. It was adjacent to the capital, close enough to remain part of the city’s pressure, distant enough that its sealed archives were not before his eyes. The Church’s buried proof lay there in memory only, while the sealed testimony lay with him now. He did not confuse those facts. He did not imagine that moving one had moved the other.

He tightened his hand around the edge of his robe, feeling the concealed packet beneath it.

Contact Elara without alerting the synod.

The plan remained a plan.

Move the testimony.

The move had brought him here.

Nothing more had been granted. Nothing less had been lost. Maelin stepped away from the wall and continued into the capital, carrying the sealed testimony beneath the ash-colored sky while the weakening seal waited somewhere beyond his sight. The capital received him without recognition. Its streets carried their ordinary burdens beneath the ash-colored sky, indifferent to the packet hidden beneath his robe and to the testimony whose custody had changed without its meaning changing with it. Maelin kept his pace measured. He did not look toward the distant archives. He did not mistake their silence for safety, nor the weakening seal beyond his sight for a summons he could answer by thought alone. The plan remained bounded by what he knew: contact Elara without alerting the synod, and move the testimony when movement could be made without confusing it for proof. For now, he carried it. The concealed packet pressed against his hand as he walked deeper into the capital, while the Church’s buried proof remained where memory had placed it, distant and sealed, and the weakening seal waited beyond his sight.

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
        "id": "event-1-0-maelin-rook",
        "kind": "move",
        "locationId": "capital",
        "observerIds": [
          "elara-voss",
          "lucan-aurelis"
        ],
        "participantIds": [
          "maelin-rook"
        ],
        "summary": "Maelin Rook moved to capital.",
        "visibility": "participants"
      },
      {
        "id": "event-1-1-elara-voss",
        "kind": "investigate",
        "locationId": "capital",
        "observerIds": [
          "maelin-rook",
          "lucan-aurelis"
        ],
        "participantIds": [
          "elara-voss"
        ],
        "summary": "Elara Voss investigated prophecy-has-missing-lines.",
        "visibility": "participants"
      },
      {
        "id": "event-1-2-lucan-aurelis",
        "kind": "investigate",
        "locationId": "capital",
        "observerIds": [
          "elara-voss",
          "maelin-rook"
        ],
        "participantIds": [
          "lucan-aurelis"
        ],
        "summary": "Lucan Aurelis investigated empire-profits-from-demon-war.",
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
        "characterId": "lucan-aurelis",
        "fact": {
          "certainty": "likely",
          "claim": "Lucan Aurelis found corroborating traces tied to The empire profits from continued demon war.",
          "discoveredChapter": 1,
          "id": "clue-1-2-lucan-aurelis",
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
        "characterId": "maelin-rook",
        "fromLocationId": "high-basilica",
        "toLocationIds": [
          "capital"
        ],
        "type": "set_location"
      },
      {
        "amount": 10,
        "characterId": "maelin-rook",
        "type": "grant_experience"
      }
    ],
    "surfacedClueFactIds": [
      "clue-1-1-elara-voss",
      "clue-1-2-lucan-aurelis",
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
      "expectedEffect": "Find the prophecy's missing lines",
      "goal": "Clarify the prophecy's authenticity",
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
        "subjectId": "empire-profits-from-demon-war",
        "type": "investigate"
      },
      "actorId": "lucan-aurelis",
      "contractVersion": "1.1.0",
      "expectedEffect": "Confirm imperial war profits",
      "goal": "Audit border accounts",
      "id": "intent-background-1-2",
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
      "expectedEffect": "Confirm the hidden Riftwalker class.",
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
      "claim": "The official prophecy has missing lines.",
      "id": "prophecy-has-missing-lines"
    },
    {
      "claim": "Elara believes the prophecy was forged.",
      "id": "elara-believes-prophecy-is-forged"
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
      "claim": "Elara Voss found corroborating traces tied to The official prophecy has missing lines.",
      "id": "clue-1-1-elara-voss"
    },
    {
      "claim": "Lucan Aurelis found corroborating traces tied to The empire profits from continued demon war.",
      "id": "clue-1-2-lucan-aurelis"
    },
    {
      "claim": "Nyra Vale found corroborating traces tied to Nyra's hidden class is Riftwalker.",
      "id": "clue-1-3-nyra-vale"
    }
  ]
}
~~~

## Chapter 2: Uncover the Capital's Truth

- Prose SHA-256: `44248ae0a493779d70bc256ef8952413561a79571785094659e016c34c1e5a2c`
- Trace run ID: `46f48320-4d67-427d-9012-3e6e770ce9c1`
- Trace Git SHA: `ded7b00c54f6a6d70e073aad159e2d6e66b80fc2`
- State: `6ec70bf5053547ab410ae2861ce13aed0134009cecb3fcb794fdee5d0204ac47` to `a92f80580dfd0a7842a72089d7b1646ad62da0cecf7b88d668394b3f6210c14b`
- Schema version: `1.1.0-runtime-candidates-5`
- Words: 936
- Cost: $0.017826
- Latency: 29922 ms total, 29925 ms replay
- Stream: 12 chunks, reconstructed true
- Usage: 14669 input, 3497 output, 18166 total tokens

### Selected Player Action

~~~json
{
  "action": {
    "subjectId": "capital",
    "type": "investigate"
  },
  "actorId": "maelin-rook",
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
      "subjectId": "capital",
      "type": "investigate"
    },
    "description": "Investigate the immediate signs around Aurelis Capital.",
    "id": "choice-1",
    "milestoneId": null
  },
  {
    "action": {
      "approach": "Ask for a direct account.",
      "targetId": "elara-voss",
      "type": "interact"
    },
    "description": "Ask Elara Voss what they know now.",
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
        "Truth can survive the Church",
        "Mercy without truth becomes obedience"
      ],
      "characterClassId": "oracle",
      "characterClassName": "Oracle",
      "conditions": [],
      "equipmentItemIds": [
        "saints-censer"
      ],
      "experience": 920,
      "factionId": "solar-church",
      "goals": [
        "Preserve proof of the deeper threat",
        "Keep the Church from purging witnesses"
      ],
      "health": {
        "current": 132,
        "maximum": 132
      },
      "id": "maelin-rook",
      "inventory": [
        {
          "equipped": true,
          "itemId": "saints-censer",
          "name": "Saint's censer",
          "quantity": 1,
          "unique": true
        },
        {
          "equipped": false,
          "itemId": "sealed-testimony",
          "name": "Sealed testimony",
          "quantity": 1,
          "unique": true
        }
      ],
      "level": 16,
      "locationId": "capital",
      "mana": {
        "current": 154,
        "maximum": 154
      },
      "name": "Maelin Rook",
      "plan": [
        "Move the testimony",
        "Contact Elara without alerting the synod"
      ],
      "publicRole": "Saint guarding the Church's buried proof",
      "relationships": [
        {
          "characterId": "elara-voss",
          "label": "trusted hero",
          "score": 45
        },
        {
          "characterId": "lucan-aurelis",
          "label": "watched prince",
          "score": -5
        }
      ],
      "role": "saint",
      "secretFactIds": [
        "malachar-contained-the-void"
      ],
      "skills": [
        {
          "id": "truths-lantern",
          "manaCost": 10,
          "minimumLevel": 10,
          "name": "Truth's Lantern",
          "prerequisiteSkillIds": [],
          "rank": 3,
          "requiredClassId": "oracle"
        }
      ],
      "stats": {
        "agility": 14,
        "intellect": 36,
        "strength": 12,
        "vitality": 22,
        "willpower": 41
      },
      "status": "alive"
    },
    "facts": [
      {
        "certainty": "certain",
        "claim": "Malachar contained the Void beneath his throne.",
        "discoveredChapter": 0,
        "id": "malachar-contained-the-void",
        "ownerCharacterId": "maelin-rook",
        "source": "Sealed Church testimony",
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
        "claim": "Maelin Rook found corroborating traces tied to Aurelis Capital",
        "discoveredChapter": 2,
        "id": "clue-2-0-maelin-rook",
        "ownerCharacterId": "maelin-rook",
        "source": "Investigation of capital",
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
        "id": "event-1-0-maelin-rook",
        "locationId": "capital",
        "observerIds": [
          "elara-voss",
          "lucan-aurelis"
        ],
        "participantIds": [
          "maelin-rook"
        ],
        "summary": "Maelin Rook moved to capital.",
        "visibility": "participants"
      },
      {
        "id": "event-1-1-elara-voss",
        "locationId": "capital",
        "observerIds": [
          "maelin-rook",
          "lucan-aurelis"
        ],
        "participantIds": [
          "elara-voss"
        ],
        "summary": "Elara Voss investigated prophecy-has-missing-lines.",
        "visibility": "participants"
      },
      {
        "id": "event-1-2-lucan-aurelis",
        "locationId": "capital",
        "observerIds": [
          "elara-voss",
          "maelin-rook"
        ],
        "participantIds": [
          "lucan-aurelis"
        ],
        "summary": "Lucan Aurelis investigated empire-profits-from-demon-war.",
        "visibility": "participants"
      },
      {
        "id": "event-2-0-maelin-rook",
        "locationId": "capital",
        "observerIds": [
          "elara-voss",
          "lucan-aurelis"
        ],
        "participantIds": [
          "maelin-rook"
        ],
        "summary": "Maelin Rook investigated capital.",
        "visibility": "participants"
      },
      {
        "id": "event-2-1-elara-voss",
        "locationId": "capital",
        "observerIds": [
          "maelin-rook",
          "lucan-aurelis"
        ],
        "participantIds": [
          "elara-voss"
        ],
        "summary": "Elara Voss investigated prophecy-has-missing-lines.",
        "visibility": "participants"
      },
      {
        "id": "event-2-2-lucan-aurelis",
        "locationId": "capital",
        "observerIds": [
          "elara-voss",
          "maelin-rook"
        ],
        "participantIds": [
          "lucan-aurelis"
        ],
        "summary": "Lucan Aurelis investigated empire-profits-from-demon-war.",
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
        "Truth can survive the Church",
        "Mercy without truth becomes obedience"
      ],
      "characterClassId": "oracle",
      "characterClassName": "Oracle",
      "conditions": [],
      "equipmentItemIds": [
        "saints-censer"
      ],
      "experience": 910,
      "factionId": "solar-church",
      "goals": [
        "Preserve proof of the deeper threat",
        "Keep the Church from purging witnesses"
      ],
      "health": {
        "current": 132,
        "maximum": 132
      },
      "id": "maelin-rook",
      "inventory": [
        {
          "equipped": true,
          "itemId": "saints-censer",
          "name": "Saint's censer",
          "quantity": 1,
          "unique": true
        },
        {
          "equipped": false,
          "itemId": "sealed-testimony",
          "name": "Sealed testimony",
          "quantity": 1,
          "unique": true
        }
      ],
      "level": 16,
      "locationId": "capital",
      "mana": {
        "current": 154,
        "maximum": 154
      },
      "name": "Maelin Rook",
      "plan": [
        "Move the testimony",
        "Contact Elara without alerting the synod"
      ],
      "publicRole": "Saint guarding the Church's buried proof",
      "relationships": [
        {
          "characterId": "elara-voss",
          "label": "trusted hero",
          "score": 45
        },
        {
          "characterId": "lucan-aurelis",
          "label": "watched prince",
          "score": -5
        }
      ],
      "role": "saint",
      "secretFactIds": [
        "malachar-contained-the-void"
      ],
      "skills": [
        {
          "id": "truths-lantern",
          "manaCost": 10,
          "minimumLevel": 10,
          "name": "Truth's Lantern",
          "prerequisiteSkillIds": [],
          "rank": 3,
          "requiredClassId": "oracle"
        }
      ],
      "stats": {
        "agility": 14,
        "intellect": 36,
        "strength": 12,
        "vitality": 22,
        "willpower": 41
      },
      "status": "alive"
    },
    "facts": [
      {
        "certainty": "certain",
        "claim": "Malachar contained the Void beneath his throne.",
        "discoveredChapter": 0,
        "id": "malachar-contained-the-void",
        "ownerCharacterId": "maelin-rook",
        "source": "Sealed Church testimony",
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
        "id": "event-1-0-maelin-rook",
        "locationId": "capital",
        "observerIds": [
          "elara-voss",
          "lucan-aurelis"
        ],
        "participantIds": [
          "maelin-rook"
        ],
        "summary": "Maelin Rook moved to capital.",
        "visibility": "participants"
      },
      {
        "id": "event-1-1-elara-voss",
        "locationId": "capital",
        "observerIds": [
          "maelin-rook",
          "lucan-aurelis"
        ],
        "participantIds": [
          "elara-voss"
        ],
        "summary": "Elara Voss investigated prophecy-has-missing-lines.",
        "visibility": "participants"
      },
      {
        "id": "event-1-2-lucan-aurelis",
        "locationId": "capital",
        "observerIds": [
          "elara-voss",
          "maelin-rook"
        ],
        "participantIds": [
          "lucan-aurelis"
        ],
        "summary": "Lucan Aurelis investigated empire-profits-from-demon-war.",
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
        "id": "event-2-0-maelin-rook",
        "kind": "investigate",
        "locationId": "capital",
        "observerIds": [
          "elara-voss",
          "lucan-aurelis"
        ],
        "participantIds": [
          "maelin-rook"
        ],
        "summary": "Maelin Rook investigated capital.",
        "visibility": "participants"
      },
      {
        "id": "event-2-1-elara-voss",
        "kind": "investigate",
        "locationId": "capital",
        "observerIds": [
          "maelin-rook",
          "lucan-aurelis"
        ],
        "participantIds": [
          "elara-voss"
        ],
        "summary": "Elara Voss investigated prophecy-has-missing-lines.",
        "visibility": "participants"
      },
      {
        "id": "event-2-2-lucan-aurelis",
        "kind": "investigate",
        "locationId": "capital",
        "observerIds": [
          "elara-voss",
          "maelin-rook"
        ],
        "participantIds": [
          "lucan-aurelis"
        ],
        "summary": "Lucan Aurelis investigated empire-profits-from-demon-war.",
        "visibility": "participants"
      }
    ],
    "knowledgeMutations": [
      {
        "characterId": "maelin-rook",
        "fact": {
          "certainty": "likely",
          "claim": "Maelin Rook found corroborating traces tied to Aurelis Capital",
          "discoveredChapter": 2,
          "id": "clue-2-0-maelin-rook",
          "ownerCharacterId": "maelin-rook",
          "source": "Investigation of capital",
          "visibility": "observed"
        },
        "type": "discover_fact"
      }
    ],
    "stateMutations": [
      {
        "amount": 10,
        "characterId": "maelin-rook",
        "type": "grant_experience"
      }
    ],
    "surfacedClueFactIds": [
      "clue-2-0-maelin-rook"
    ]
  }
}
~~~

### Prose

Ashfall 3 settled over Aurelis Capital in a thin gray veil. Maelin Rook watched it gather along the stones and in the seams between them, turning the imperial center into a map of blurred edges. He kept one hand near the Saint’s censer, though he did not lift it. The other rested against the sealed testimony beneath his coat.

He had come to investigate the immediate area for fresh tracks.

Nothing more.

That boundary mattered. The Church had survived because truth could survive it, but truth had to remain proof before it became accusation. Mercy without truth became obedience. Maelin had seen the shape of obedience often enough in the high halls of the Solar Church, where silence could be polished until it looked like devotion.

He lowered himself beside the street.

The ground held no clean trail. Ash had fallen over older marks, and the pale grit shifted beneath his fingertips. He examined the edges of the stones, the dust caught against a low threshold, and the narrow dark lines where one slab met another. He searched for fresh tracks, not meaning. The distinction steadied him.

Behind him, capital continued its measured movement. Elara Voss investigated the missing lines of the prophecy. Lucan Aurelis investigated the question of how the empire profited from the demon war. Maelin knew only that each inquiry occupied the same city and that both investigators were present. He did not let those facts join themselves into a story.

The sealed testimony pressed coldly against his ribs.

He had to move it. He had to contact Elara without alerting the synod. Those were plans, not actions. The paper remained where it was, protected by its seal and by the discipline of his silence. Contact had not happened. Delivery had not happened. No response waited for him.

A faint disturbance marked the ash near the curb. Maelin leaned closer. A line had broken through the powder, but it ended almost at once, dissolving into the roughness of the street. It could not be claimed as a track. He traced its short length with his eyes, then withdrew his hand.

Across the way, Elara’s investigation continued. She did not speak to him. Lucan’s did as well. Their presence was visible; their conclusions were not.

Maelin let his breath out slowly. The city offered fragments: ash, stone, pressure, absence. Proof demanded more than fragments. His work was to preserve what could withstand examination, not to make the empty places answer.

The threat remained beyond the visible street: the seal beneath the old Demon Throne was weakening. He held that knowledge inwardly, where it could not be mistaken for evidence found beneath his fingers. The buried danger did not alter the curb, the threshold, or the ash before him. It did not grant him a track.

He rose.

The movement drew no reply. The observers remained observers. Elara Voss investigated the prophecy’s missing lines. Lucan Aurelis investigated imperial profit from the demon war. Maelin Rook investigated the capital. The three inquiries occupied one place without becoming one event.

His boots left fresh impressions in the ash, and he noticed them at once. They belonged to him. He memorized their shape only long enough to distinguish them from anything older. The right heel pressed deeper; the left edge of the sole dragged slightly. He stepped aside before the marks could confuse his search.

The Saint’s censer hung quiet at his belt. He did not use it. No smoke rose, no hidden sign appeared, and no resource left him. The testimony remained sealed. His body remained sound. The capital remained beneath the gray fall of Ashfall 3.

A small gain waited inside him, clean and exact: ten experience had been granted. His total stood at 920, increased from 910. His level remained sixteen. The change brought no revelation and required no celebration. It was simply a measured alteration, as definite as the ash on the stones.

Maelin looked once more over the immediate area.

No fresh track could be proven.

He turned his attention from the ground to the sealed testimony, then stopped himself before action could outrun purpose. The evidence needed movement, but not here, not yet. His goals endured without becoming deeds. Preserve proof. Keep witnesses from the synod’s purge. The words were a compass, not a command.

He walked through the capital, careful not to assign significance to every mark beneath his feet. Ash whispered against stone. The censer touched his side with each step. Elara remained somewhere within the city’s visible reach, investigating the prophecy. Lucan did the same with the empire’s profits. Maelin carried the sealed testimony and the weight of what he knew.

The old Demon Throne waited beyond the limits of his search, and beneath it the weakening seal held its silence.

For this moment, that was all he could honestly say. He kept to that narrow measure, neither mistaking silence for safety nor turning uncertainty into a summons. The testimony remained sealed. The witnesses remained beyond his reach, and therefore beyond any promise he could make on their behalf. Around him, the capital offered only its visible roads, its ash-marked stones, and the muted rhythm of the censer at his side. He followed none of these as signs. He merely continued, carrying what had been entrusted to him without adding meaning that the evidence could not bear. The prophecy waited in Elara’s keeping; the empire’s profits waited in Lucan’s reckoning. His own task remained smaller, and for that reason still possible: preserve proof, protect what could be protected, and let the silence beneath the old Demon Throne remain unanswered.

### Reviewer-Only Canon Appendix

Spoilers follow. Background intents are noncanonical proposals. The accepted delta is the sole new canon.

~~~json
{
  "acceptedDelta": {
    "acceptedIntentIds": [
      "intent-player-2-2",
      "intent-background-2-1",
      "intent-background-2-2",
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
        "id": "event-2-0-maelin-rook",
        "kind": "investigate",
        "locationId": "capital",
        "observerIds": [
          "elara-voss",
          "lucan-aurelis"
        ],
        "participantIds": [
          "maelin-rook"
        ],
        "summary": "Maelin Rook investigated capital.",
        "visibility": "participants"
      },
      {
        "id": "event-2-1-elara-voss",
        "kind": "investigate",
        "locationId": "capital",
        "observerIds": [
          "maelin-rook",
          "lucan-aurelis"
        ],
        "participantIds": [
          "elara-voss"
        ],
        "summary": "Elara Voss investigated prophecy-has-missing-lines.",
        "visibility": "participants"
      },
      {
        "id": "event-2-2-lucan-aurelis",
        "kind": "investigate",
        "locationId": "capital",
        "observerIds": [
          "elara-voss",
          "maelin-rook"
        ],
        "participantIds": [
          "lucan-aurelis"
        ],
        "summary": "Lucan Aurelis investigated empire-profits-from-demon-war.",
        "visibility": "participants"
      },
      {
        "id": "event-2-3-nyra-vale",
        "kind": "investigate",
        "locationId": "cinder-village",
        "observerIds": [
          "rowan-ashborn"
        ],
        "participantIds": [
          "nyra-vale"
        ],
        "summary": "Nyra Vale investigated clue-1-3-nyra-vale.",
        "visibility": "participants"
      }
    ],
    "expectedWorldVersion": 2,
    "knowledgeMutations": [
      {
        "characterId": "maelin-rook",
        "fact": {
          "certainty": "likely",
          "claim": "Maelin Rook found corroborating traces tied to Aurelis Capital",
          "discoveredChapter": 2,
          "id": "clue-2-0-maelin-rook",
          "ownerCharacterId": "maelin-rook",
          "source": "Investigation of capital",
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
        "characterId": "lucan-aurelis",
        "fact": {
          "certainty": "likely",
          "claim": "Lucan Aurelis found corroborating traces tied to The empire profits from continued demon war.",
          "discoveredChapter": 2,
          "id": "clue-2-2-lucan-aurelis",
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
          "id": "clue-2-3-nyra-vale",
          "ownerCharacterId": "nyra-vale",
          "source": "Investigation of clue-1-3-nyra-vale",
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
        "characterId": "maelin-rook",
        "type": "grant_experience"
      }
    ],
    "surfacedClueFactIds": [
      "clue-2-0-maelin-rook",
      "clue-2-1-elara-voss",
      "clue-2-2-lucan-aurelis",
      "clue-2-3-nyra-vale"
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
      "expectedEffect": "Learn more about the missing prophecy lines.",
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
        "subjectId": "empire-profits-from-demon-war",
        "type": "investigate"
      },
      "actorId": "lucan-aurelis",
      "contractVersion": "1.1.0",
      "expectedEffect": "Confirm imperial war profits.",
      "goal": "Audit border accounts",
      "id": "intent-background-2-2",
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
      "stateVersion": 2
    },
    {
      "action": {
        "subjectId": "clue-1-3-nyra-vale",
        "type": "investigate"
      },
      "actorId": "nyra-vale",
      "contractVersion": "1.1.0",
      "expectedEffect": "Confirm traces linked to Nyra's hidden class.",
      "goal": "Identify her unrecorded class",
      "id": "intent-background-2-3",
      "prerequisites": {
        "requiredFactIds": [
          "nyra-has-riftwalker-class",
          "clue-1-3-nyra-vale"
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
      "claim": "Elara Voss found corroborating traces tied to The official prophecy has missing lines.",
      "id": "clue-1-1-elara-voss"
    },
    {
      "claim": "Lucan Aurelis found corroborating traces tied to The empire profits from continued demon war.",
      "id": "clue-1-2-lucan-aurelis"
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
      "claim": "Lucan Aurelis found corroborating traces tied to The empire profits from continued demon war.",
      "id": "clue-2-2-lucan-aurelis"
    },
    {
      "claim": "Nyra Vale found corroborating traces tied to Nyra Vale found corroborating traces tied to Nyra's hidden class is Riftwalker.",
      "id": "clue-2-3-nyra-vale"
    }
  ]
}
~~~

<!-- HUMAN REVIEW START -->

## Human Review Record

- Reviewer: Codex root agent, acting as human reviewer per user instruction
- Review date: 2026-07-20
- Final verdict: pass
- Cross-chapter continuity evidence: Chapter 1 carries sealed testimony into Aurelis Capital. Chapter 2 keeps it “beneath his coat” and “where it was.” Experience advances from 910 to 920.
- Repetition evidence: Both chapters repeat bounded knowledge, sealed testimony, unused censer, and capital ash. This protects POV but makes Chapter 2 thin.
- Release notes: Pass. Chapter 2 has a score-1 strain: “No fresh track could be proven,” while accepted canon records generic likely “corroborating traces tied to capital.”

Cite exact prose or canon evidence for every score.

### Chapter 1 Human Scores

| Dimension | Human score 0 to 2 | Exact evidence |
| --- | ---: | --- |
| Choice fulfillment | 2 | Selected action is “Travel toward Aurelis Capital”; prose says “Maelin Rook reached Aurelis Capital”; delta sets `high-basilica` to `capital`. |
| Character autonomy | 2 | “Contact Elara without alerting the synod” and “Move the testimony” drive Maelin’s action. |
| POV safety | 2 | “He did not know what Lucan had found” and did not assign a cause to Lucan’s investigation. |
| LitRPG mechanics | 2 | Delta grants 10 experience; prose keeps Truth’s Lantern unused and mana full. |
| Continuity | 2 | Prose preserves Maelin’s private testimony and the public fact that Malachar died. |
| Arc progress | 1 | Movement advances setup, but no clue or Act 1 milestone changes. |
| Prose | 1 | Controlled voice, but testimony, archive, ash, and “bounded” knowledge repeat. |

- Human chapter verdict: pass
- Human chapter notes: Safe arrival chapter. Plot movement and prose variety remain limited.

### Chapter 2 Human Scores

| Dimension | Human score 0 to 2 | Exact evidence |
| --- | ---: | --- |
| Choice fulfillment | 1 | Prose performs the fresh-track search but concludes “No fresh track could be proven,” while accepted canon records a likely corroborating trace. |
| Character autonomy | 2 | “He turned his attention from the ground to the sealed testimony, then stopped himself before action could outrun purpose.” |
| POV safety | 2 | “Their presence was visible; their conclusions were not.” |
| LitRPG mechanics | 1 | “ten experience had been granted” and total 920 are exact, but the accepted generic clue is not concretely surfaced. |
| Continuity | 2 | Testimony remains sealed, censer unused, level sixteen, and experience rises from 910 to 920. |
| Arc progress | 1 | The investigation gives no usable named track and changes no Act 1 milestone. |
| Prose | 1 | Evidence discipline fits Maelin, but repeated ash, testimony, and restraint make the chapter static. |

- Human chapter verdict: pass
- Human chapter notes: Release-safe. “No fresh track” can coexist with a generic likely corroborating trace, but earns score 1.

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
