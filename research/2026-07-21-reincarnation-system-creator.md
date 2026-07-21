# Reincarnation + System story creator

## Product decision

The current demo supports one foundation only: **Reincarnation + LitRPG System**. The creator varies the opening, protagonist, tone, and progression promise inside that foundation. It does not offer Transmigration, Regression, or Custom yet.

The previous six-POV chooser is the wrong creation model. Rowan remains the internal protagonist ID so existing canon and engine rules stay stable. The other five established characters remain independent world actors. New-story setup defines Rowan's presentation, rebirth, starting age, power path, temperament, body background, System focus, genres, and optional direction.

## Evidence

### Genre patterns

- Royal Road's reincarnation catalogue exposes reader-facing tags such as male or female lead, weak-to-strong or strong lead, action, adventure, drama, romance, non-human lead, progression, and LitRPG. These are useful expectation controls, not plot templates: [Best Rated Reincarnation](https://www.royalroad.com/fictions/best-rated?genre=reincarnation).
- _Engine of Reincarnation_ starts the protagonist as a baby, preserves memories and System progress across lives, and makes the form of the new life materially constrain the story: [Royal Road](https://www.royalroad.com/fiction/143293/engine-of-reincarnation).
- _Unhinged Fury_ uses a four-year-old body and makes childhood limits central to progression. Starting age must therefore change the opening rather than act as a cosmetic tag: [Royal Road](https://www.royalroad.com/fiction/90250/unhinged-fury-litrpg-reincarnation).
- _Mythshaper_ uses a newborn body, initially missing past-life memories, weak-to-strong progression, crafting, training, and a slow burn. Memory retention and power curve are separate useful controls: [Royal Road](https://www.royalroad.com/fiction/104817/mythshaper-reincarnation-crafting-litrpg).
- _System Outcast_ pairs adult reincarnation with immediate System conflict, a refusal, a concrete disadvantage, and a survival problem. The System works best when it applies pressure and cost instead of displaying decoration: [Royal Road](https://www.royalroad.com/fiction/148088/system-outcast-a-litrpg-progression-fantasy).
- Sample chapter-one pages repeatedly combine awakening in a changed body, immediate sensory orientation, a first System manifestation, and danger or choice. This supports an origin-scene gate without copying prose or scene order: [Archmage Reborn chapter 1](https://www.royalroad.com/fiction/78336/archmage-reborn-reincarnated-to-spellcraft-secondary/chapter/1441810/chapter-1), [Dungeon Awakening chapter 1](https://www.royalroad.com/fiction/130425/dungeon-awakening-a-litrpg-isekai-progression/chapter/2551757/chapter-1-awakening-in-the-dungeon).

### Form and interaction patterns

- Use radio-style controls for one choice and checkbox-style controls for several. Labels must also say “Choose one” or “Choose up to N”; visual shape alone is not enough: [GOV.UK radios](https://design-system.service.gov.uk/components/radios/), [GOV.UK checkboxes](https://design-system.service.gov.uk/components/checkboxes/).
- Avoid a multi-select dropdown. Visible choices are easier to scan and have better assistive-technology support: [GOV.UK select guidance](https://design-system.service.gov.uk/components/select/).
- Group questions in the order users think about them and reveal optional detail only when needed. NHS guidance starts with one decision per page; this creator keeps the common path on one calm screen and moves opening detail behind one disclosure because users may create several drafts quickly: [NHS question order](https://service-manual.nhs.uk/content/how-to-write-good-questions-for-forms/get-the-questions-into-order).
- Linear progress indicators help only when a task truly has multiple steps. This creator uses one screen and one primary action, so a decorative stepper would add noise: [Carbon progress indicator](https://carbondesignsystem.com/components/progress-indicator/usage/).
- Copyright protects expression, not a general idea or system. Reincarnation, levels, classes, Demon Kings, and System interfaces may be genre foundations, but names, wording, scenes, ability trees, and distinctive sequences must remain original: [U.S. Copyright Office FAQ](https://www.copyright.gov/help/faq/faq-protect.html).

## Creator taxonomy

| Group            | Type          | Choices                                                     | Default                    |
| ---------------- | ------------- | ----------------------------------------------------------- | -------------------------- |
| Foundation       | Fixed         | Reincarnation + System                                      | Fixed                      |
| Title            | Text          | 1–100 single-line characters                                | Local suggestion, editable |
| Starting life    | One           | Born again, Child, Teen, Adult                              | Adult                      |
| Power path       | One           | Weak to strong, Overpowered                                 | Weak to strong             |
| Main character   | One           | Male, Female                                                | Male                       |
| Story mix        | Up to 3       | Adventure, Action, Drama, Romance, Mystery, Dark fantasy    | Adventure, Action, Drama   |
| Personality      | Up to 3       | Pragmatic, Protective, Ambitious, Curious, Ruthless, Warm   | Pragmatic, Protective      |
| Body background  | Up to 2       | Orphan, Hidden heir, Outcast, Former ruler                  | Outcast, Former ruler      |
| Rebirth cause    | One           | Sacrifice, Betrayal, Accident, Execution, Ritual failure    | Betrayal                   |
| Past-life memory | One           | Full, Fragments, Sealed                                     | Fragments                  |
| System focus     | One           | Levels and class, Skill fusion, Titles and oaths, Territory | Titles and oaths           |
| Guidance         | Optional text | Up to 500 characters                                        | Empty                      |

Defaults are intentional here. This is a creative settings surface, not a factual questionnaire. A user can create a coherent first draft with one title edit and one click, then change only the dimensions they care about.

## Chapter-one contract

Chapter one must:

1. Dramatize the end of the prior life or its immediate consequence.
2. Show awakening or arrival in the selected body and starting age.
3. Establish the immediate world through action, sensation, and one relationship rather than a lore dump.
4. Show one concise System manifestation tied to survival, identity, or a costly decision.
5. End with a concrete next threat or commitment.

It must not expose act numbers, milestone IDs, target chapter numbers, evaluation language, prompt language, scheduled beats, or internal planning deadlines.

## UX design

- Desktop concept: `docs/design/story-creator-desktop.png`.
- Mobile concept: `docs/design/story-creator-mobile.png`.
- Dark ink background, warm ivory text, ember accent, bronze hairlines.
- One open form surface. No dashboard, no character-art gallery, no cost data, no God Mode, no nested card grid.
- Large visible click targets. Selected state uses border plus checkmark, not color alone.
- Live premise summary on desktop; compact disclosure on mobile.
- One primary action: **Create chapter one**.

## Unknowns to test with users

- Whether most users want a generated title suggestion or a blank title field.
- Whether “Born again” should mean birth scene or first meaningful awareness after a time skip.
- Whether Overpowered should begin with high visible stats or strong latent abilities under immediate constraints.
- Whether optional opening controls belong open by default after repeat use.
