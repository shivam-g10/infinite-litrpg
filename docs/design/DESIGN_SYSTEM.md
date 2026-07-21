# Interface Design System

Current references:

- `../screenshots/story-creator-desktop.png`
- `../screenshots/story-creator-mobile.png`

## Direction

- Dark literary editorial UI.
- Bone reading text, muted slate controls, restrained ember accent.
- Serif story copy and headings. System sans for controls.
- One centered reading column. Avoid decorative cards, badges, gradients, and telemetry.
- Minimum 44-pixel tap targets. Clear focus, hover, disabled, progress, success, and error states.

## Main surfaces

- Story creator with click controls, sensible defaults, optional typed guidance, and optional protagonist name.
- Story library available during generation.
- Clean reader with chapter navigation, decisions, reroll, reject, and export.
- Inline chapter progress that never takes over the reader.
- Responsive single-column mobile layout.

## Copy rules

- Say `Chapter X`, not `Chapter X of 100`.
- Do not show model, prompt, cost, trace, local-load, or audit messages in the reader.
- Do not expose internal milestones or generation instructions.
- Progress says what is happening in reader language: preparing world, following characters, resolving events, writing chapter, checking continuity, saving.
