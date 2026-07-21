# Domain Model

## Core Records

### StorySetupV2

- creator selections, optional protagonist name, guidance
- no client-provided world, cast, inventory, topology, or opening canon

### StoryGenesisCandidateV1

- protagonist, past life, five supporting actors
- System rules, class, two skills, zero to six starting items
- five to nine connected locations, three to six factions
- incident, pressure, opening action, relationships, threat, discoverable facts
- seven milestones, ending constraints, concrete guidance coverage

### StoryGenesisRecordV1

- accepted candidate and audit
- exact compiled initial world and legal opening action
- setup and world hashes
- Sol and Terra response, usage, latency, and cost evidence

### WorldState

- `version`
- `chapter`
- `act`
- `calendar`
- `threat`
- locations, factions, active events
- generated System and origin metadata
- terminal status and ending constraints

### CharacterState

- identity, role, status
- class, level, experience, stats
- skills and prerequisites
- health, mana, conditions
- inventory and equipment
- location
- goals, plan, beliefs
- faction and relationships

### KnowledgeLedger

- character ID
- fact ID
- claim
- source
- certainty
- discovery chapter
- visibility class

### ArcClock

- seven acts of at most 50 chapters
- required milestones
- act deadline
- convergence pressure
- terminal conditions

### WorldIntent

- actor, goal, action, target
- prerequisites
- expected effect
- state version

### WorldDelta

- accepted and rejected intents
- events
- state mutations
- knowledge mutations
- surfaced clues
- resulting clock changes

### ChapterRecord

- POV action
- state-before and state-after versions
- safe context hash
- prose
- trace ID
- usage, latency, cost

## Hard Invariants

- Dead or terminal character cannot act.
- Character occupies exactly one location.
- Inventory cannot go negative or duplicate unique item.
- Skill needs class, level, mana, and prerequisites.
- Intent cannot use fact absent from actor knowledge.
- Narration cannot use fact absent from POV knowledge or observed chapter events.
- Only expected world version can commit.
- Chapter increments once per successful commit.
- Act transitions at chapters 50, 100, 150, 200, 250, and 300.
- Chapter 301 begins final campaign.
- Chapter 350 is terminal.
- Chapter 351 is rejected before model call.

## Seven-Act Clock

| Chapters   | Arc                            |
| ---------- | ------------------------------ |
| 1 to 50    | Reincarnation and survival     |
| 51 to 100  | Class growth and first faction |
| 101 to 150 | Regional conflict              |
| 151 to 200 | Hidden-history reveal          |
| 201 to 250 | Continental war                |
| 251 to 300 | Convergence and betrayals      |
| 301 to 350 | Final campaign and resolution  |

At chapter 40 inside each act, raise convergence pressure. At chapter 48, offer only actions compatible with required transition. Chapter 50 forces transition.
