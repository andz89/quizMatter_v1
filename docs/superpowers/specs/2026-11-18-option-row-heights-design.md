# Option row heights (fit rows to text, drag lines)

Date: 2026-11-18. Mockup the user approved: https://claude.ai/artifact/YE3tGkjTMEB3wLR3x8VZha (version 7).

## Why

Every option row is the same height today. A long option gets a small text size to fit its row (Q16: A at 13 px)
while a short option's row is half empty (C). A correct answer in smaller, longer text also stands out to students.
Teachers need the room to go where the text is.

## Goals

- List and list + side box: rows sized by their text, with one click, and adjustable by hand.
- Grid: rows that never leave a long option cut off or run off the slide after a shuffle or reorder.
## Non-goals / anti-goals

- No free placing of options (moving boxes with gaps between them): rejected, see Approaches.
- **No text resizing, ever, by this feature** (the user's rule, 2026-11-18). Fit rows to text, drag lines, Shuffle,
  reorder and Claude's import only change row heights. Every option keeps its own text size; only the teacher changes
  it (− / +, the size box). This matches the app-wide rule that slide text never shrinks to fit.
- Rows never pass the bottom of the slide. A slide must never draw options outside itself.
- No drag lines in grid.

## Approaches

1. **Rows share the space (chosen).** "Fit rows to text" plus drag lines between rows. The rows always fill the
   options area exactly, so nothing overlaps or runs off.
2. **Move & resize each option** (the user's second idea): each option a box that can be moved up/down and
   stretched, stopping at its neighbors. Rejected by the user after trying it: twice the handles, they clash with the
   reorder grip, and Shuffle / reorder would make boxes overlap and need re-stacking.
3. **Grid: height moves with the option.** Rejected: after a shuffle two tall options can land in one column, which
   then runs past the bottom of the slide (shown in the mockup).
4. **Grid: equal rows like today.** Rejected in favour of rows fitted again after each shuffle.

## The design

### List and list + side box

- **Saved:** each option gets an optional `rowSize` (a number > 0). The numbers only count compared with each other,
  like a table's `rowSizes`: each row's height = its `rowSize` / the sum of the shown options' `rowSize`s × the room.
  Missing on a shown option = equal rows (today's look). Because it lives on the option, Shuffle and reorder carry it
  along: a long option keeps its tall row.
- **Fit rows to text** (a button shown when an option box is picked; builder's call where exactly): each row gets what
  its text needs **at the option's own text size**, and the spare room is shared out equally. Text sizes don't change.
  If the text needs more than the room, the rows share the room by what they need and "+…" shows on what's cut off;
  the teacher then lowers a size or shortens the text. One undo step.
- **Drag lines** between two neighboring rows: one row grows, the other shrinks, each down to one line of its own
  text size. The grab bar sits in the middle of the 12 px gap between rows, clear of the grip / ✓ on the left and the
  "+…" on the right. A whole drag is one undo step (like dragging the question box). Arrow keys on a focused line move
  it too.
- **The teacher's size change** (− / +, the size box) changes sizes only; rows stay until Fit rows to text.

### Grid

- **Saved:** the slide gets an optional `gridRowSizes` (two numbers > 0, by place: top row, bottom row; same
  "compared with each other" meaning). Missing = equal rows.
- Each row is as tall as the longer of its two options needs; spare room is shared out. Not enough room: the rows
  share by what they need ("+…" shows).
- **Fitted again** (text keeps its size) after Shuffle, after a reorder and on Fit rows to text. Not while typing
  (rows would jump): the "+…" mark tells the teacher.
- True / False grid has one row: nothing to fit.

### Everywhere

- **Rows never pass the bottom of the slide**: the sizes are shares of the room, so they always fill it exactly.
  Dragging the question box, the picture strip or switching layout keeps each row's share.
- **Measuring** happens in the editor (browser), at the option's real text width (half width when it has pictures,
  `OptionCard`), after the fonts load. The store's actions get the needs from a small measuring helper.
- **Pictures in an option:** the row's need is at least the bottom of its lowest picture (my call), and when a row's
  height changes its pictures scale with it, like `scaleElementsToBoxes` does for the question box.
- **Box sizes:** `getContainerBounds` returns each option's own height (today one size for all four), so pictures,
  snapping, the selection rectangle and the import use the right box. Presenting, thumbnails and the view page
  (`SlideStaticView`) read the same sizes through one shared helper in `constants.ts`, so they can't drift from the
  editor.
- **Hidden options** (True / False's C and D; short-answer, custom and blank slides' options) are left out of the sums.
- **Switching layout:** list and list + side box share the options' `rowSize`; grid uses `gridRowSizes`. Each keeps
  its own, so switching back brings them back.
- **Copies** (duplicate, slides from other presentations, shared copies, reviews, approvals) copy the slide whole, so
  the new fields go along.

### Claude's import

- The import sizes the rows like Fit rows to text, from its text estimates (`importText.ts`), and **no longer changes
  option text sizes** (`optionFontSizeFor`, which shrinks options in short rows, is removed). Text still too big for
  the room is named by the layout report ("will be cut off"), so Claude picks a smaller size itself. The report lists
  each row's size instead of "A–D … each". `getClaudeFormat()` and `src/pages/api/CLAUDE.md` say so.

### Saved shape and deploy

- New optional fields: `optionSchema.rowSize`, `slideSchema.gridRowSizes` (zod: finite, > 0, a sane maximum).
- `DATA_VERSION` 5 → 6, and a migration that raises `current_data_version()` to 6. The database doesn't check option
  fields, so nothing else changes there. Deploy order: test on Docker, the user pastes the migration into the live
  SQL editor, then the code goes to `dev`. Run Admin → Data check locally first.
- No Privacy Policy change (nothing new is collected).

## Tests

- `npm test`: the share math in one pure helper in `src/lib` (shares → heights, Fit from given needs, drag clamp,
  grid row needs, hidden options left out), and that Fit never touches a text size.
- SQL: the existing data-version test with 6.
- e2e (`e2e/`): Fit rows to text on a list slide, a drag line, Shuffle keeping a long option's row, grid re-fit after
  Shuffle, and "+…" when text is too big; presenting draws the same heights.

## Left to the builder

- Where exactly the Fit rows to text button sits in the toolbar, and its icon (Lucide).
- The zod maximum for `rowSize`, and how the measuring helper is shared between the editor and the store.
- Notes: `src/components/editor/CLAUDE.md` (a section), `src/lib/CLAUDE.md` (the helper, the new fields),
  `src/pages/api/CLAUDE.md` (Claude's import).
