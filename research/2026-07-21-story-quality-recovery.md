# Story Quality Recovery Research

Date: 2026-07-21

## Facts

- OpenAI positions GPT-5.6 Sol as the flagship tier, Terra as the balanced tier, and Luna as the fastest low-cost tier. Current regular API prices are $5/$30, $2.50/$15, and $1/$6 per million uncached input/output tokens respectively. Reasoning effort is configurable. Sources: [OpenAI GPT-5.6 launch](https://openai.com/index/gpt-5-6/), [Responses reasoning reference](https://platform.openai.com/docs/api-reference/responses-streaming/response/refusal/delta?lang=curl).
- The current runtime uses Luna with `none` reasoning for chapter frames, prose, and holistic audit. It sends no previous prose, previous title, chapter memory, open-thread ledger, or long-range plan to those calls.
- The current resolver grants every accepted player turn exactly 10 XP. Waiting can earn XP. Level changes do not deterministically add a stat, skill, resource ceiling, item access, or other new capability.
- Current investigation results use the generic form “found corroborating traces tied to…”. Automatic continuation always executes deterministic `choice-1`.
- Long-form generation research reports better coherence and premise relevance from explicit planning and hierarchical outlines. Sources: [Re3](https://aclanthology.org/2022.emnlp-main.296/), [DOC](https://aclanthology.org/2023.acl-long.190/), [CONCOCT](https://aclanthology.org/2023.findings-emnlp.723/).
- Creative-writing guidance connects compelling characters to clear goals, conflict, revealed traits, and visible change. Sources: [Purdue character goals](https://owl.purdue.edu/owl/subject_specific_writing/creative_writing/writers/fiction-basics/writing_compelling_characters.html), [Purdue character development](https://owl.purdue.edu/owl/subject_specific_writing/creative_writing/writers/fiction-basics/building_and_revealing_characters.html).
- LitRPG references treat visible progression and game mechanics as integral story events, not decoration. Sources: [LitRPG practitioner definition](https://www.litrpg.com/litrpgblog/2019/10/6/what-is-litrpg), [DiGRA paper](https://dl.digra.org/index.php/dl/article/download/1358/1358/1355).

## Inference

- Luna-only, no-reasoning generation is mismatched to planning and prose quality work. The missing history and plan context strongly explains repeated titles, repeated openings, sensory padding, and stalled character movement. A controlled variant comparison is still required to prove model causality.
- Raw full-novel prose should not go to private background-character agents because it leaks hidden POV knowledge. The canonical narrator and continuity auditor can receive full prior chapters through the 100-chapter demo; each background actor receives only its own POV-safe history.
- More model reasoning cannot repair hollow deterministic progression. XP, System notices, clue steps, and capability changes need explicit engine rules first.

## Decision

1. Freeze deterministic quality baselines before prompt or model changes.
2. Keep Luna for at most three background intent agents and cheap schema work.
3. Use Sol for validated chapter planning and prose. Start planning at low reasoning; compare prose at none and low.
4. Use Terra low for continuity and quality audit.
5. Give planner, narrator, frame, and audit prior titles, openings, actions, and chapter history. Preserve the strict POV boundary for background agents.
6. Add deterministic System progression, concrete challenge-based XP, finite clue steps, and a requirement that every chapter changes a tracked story element.
7. Reject duplicate or near-duplicate titles and openings before commit. Audit dialogue, character movement, progression, pacing, and thread movement against history.
