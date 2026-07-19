# Interface Design System

Concept sources:

- `reader-concept.png`: locked-POV desktop reader.
- `selection-concept.png`: six-character selection and permanent lock.
- `god-mode-concept.png`: intents, canonical delta, trace, audit, and commit.
- `mobile-reader-concept.png`: responsive reader continuation.

## Direction

- Dark literary editorial interface. True blue-black charcoal background, bone-white reading text, muted slate chrome, restrained ember-orange accent.
- Serif narrative and headings. Crisp sans-serif UI labels and controls.
- Open columns, rails, lists, and hairline dividers. Avoid nested cards, pills, badges, gradients, glows, and decorative art.
- Radius range: 4 to 8 pixels. Shadows nearly absent. Orange vertical rules and square rune marks indicate active canon or selection.

## Tokens

- Background: `#07131c`.
- Raised background: `#0b1822`.
- Reading text: `#eee8df`.
- Chrome text: `#9ca7b2`.
- Border: `#34424d`.
- Accent: `#f16b22`.
- Success: `#79c879`.
- Danger: `#ff5c4d`.
- Mana: `#5c91eb`.
- Content serif: Georgia-compatible local stack.
- UI sans: system sans stack.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64.

## Component Families

- Quiet header with brand, story title, Reader, God Mode, and Export.
- Profile rows with one selected variant and public-only detail rail.
- Act rail with seven fixed entries and active ember rule.
- Open chapter column with 65-character maximum line length.
- Bordered action rows, custom action field, and primary Attempt button.
- Visible-state definition lists and meter lines.
- Inspector rows for intents, accepted delta, trace metadata, audit, and commit.
- Mobile disclosures for character state, story clock, usage, and trace.

## Copy Lock

Above fold uses only product copy shown in concepts or required by `docs/PRODUCT.md`. No eyebrow, badge, invented metric, or promotional claim.

## Responsive Rules

- Desktop: act rail, reading column, visible-state rail.
- Tablet: act rail collapses first; state becomes disclosure below actions.
- Mobile: one reading column with 24-pixel gutters, 44-pixel tap targets, disclosures after action form, Reader and God Mode bottom navigation.

## Interaction Inventory

- Character row selection and irreversible viewpoint lock confirmation.
- Reader and God Mode mode switch.
- Two suggested choices and one validated custom action.
- Export menu for Markdown and JSON.
- Intent selection, trace copy, and audit or commit disclosure.
- Clear focus, hover, disabled, busy, success, and error states. Respect reduced motion.
