# Claude sets element effects (click-by-click) — short design

Date: 2026-11-26. Builds on `2026-11-26-element-effects-design.md` (which listed Claude as a non-goal; the user asked
for it afterwards).

## Intent

Lessons Claude sends should be able to bring in their points one click at a time while the teacher presents (Fade or
Pop up), like a teacher sets in the Effects panel. Claude should also see the effects a teacher added when it reads a
presentation, so an edited version keeps them.

- Goals: an optional `"effect"` on `elements` and `textBoxes` of blank and title slides; `read_presentation` gives
  it back in the same shape; the format text says when to use it.
- Non-goals: effects on the slide's own `"title"` / `"text"` boxes (Claude puts points to reveal in `textBoxes`),
  decorations (`design`), the answer canvas, question slides.
- Anti-goals: a slip in an effect never refuses the whole presentation (left out with a note, like other slips);
  no new saved shape (DATA_VERSION stays 7, no migration).

## Approaches

1. **(Picked)** The recipe's `effect: { type, step, speed? }` on each piece; the import keeps it on the element as the
   saved `effect` (`order` = `step`) and runs `tidyEffects` (`src/lib/elementEffects.ts`), so steps are 1..n and a
   group is one step, exactly like the editor. `read_presentation` turns the saved effect back into `{ type, step,
   speed }` (`step` from `stepNumbers`). Same words both ways, so Claude sends back what it read.
2. A slide-level list of steps (`"steps": [["text box 1"], ["element 2"]]`): one place to read the order, but Claude
   would have to name pieces by place, which breaks when it reorders them. Dropped.
3. Read back the raw saved `order`: simpler, but a different word than the recipe and gaps after deletes. Dropped.

## Details (my calls)

- `step`: whole number 1–`MAX_ELEMENTS` (slips rounded and pulled in, `fitted`). Same step = together. Gaps don't
  matter. `speed`: 1–5, left out = 3.
- A picture with `count` > 1: every copy gets the same step (they come in together). Its callouts (arrows + labels)
  come in with it.
- A group: giving `effect` to one piece is enough; the whole group comes in together with the effect of the piece
  with the lowest step (`tidyEffects`).
- On a question or custom slide, or in the answer canvas: left out, with a note in the layout report.
- The layout report adds a line: how many clicks the slide's pieces take.
- Notes: `src/pages/api/CLAUDE.md`, `src/lib/CLAUDE.md`, `e2e/CLAUDE.md`.
- Tests: `npm test` can't load `importPresentation.ts` (it loads drawings), so the logic is in `elementEffects.ts`
  (`applyRecipeEffects`, `recipeEffectOf`) and tested in `elementEffects.test.ts`; `e2e/claude-element-effects.mjs`
  calls the real connector (format, send with slips, the draft's steps in the editor, read back).
- No tool is added or renamed, so the connector needs no reconnect; Claude reads the new format in its next
  `get_presentation_format` (a new chat to be sure).
