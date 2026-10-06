# Diagram boxes: free resize and move on the slide

Date: 2026-10-06

## Goal

The four diagrams (Flowchart, Cycle, Mind Map, Tree, in the "Diagrams" group of the Elements panel)
draw their boxes in an automatic layout. Teachers want to change **one box at a time, freely**:
drag its corner to any size, and drag the box itself to a new spot, right on the slide.

This replaces the Small / Medium / Large buttons, which are removed.

## What the teacher sees

- **Click a diagram once:** it is selected as today (move, resize, rotate the whole diagram).
- **Click a box inside the selected diagram:** that box is *picked*. It gets a violet outline
  (`--accent`) and 4 round corner handles, styled like the element's own resize handles.
  - **Drag a corner:** free resize, any width and height. The opposite corner stays still.
  - **Drag the picked box:** it moves. Its arrows (flowchart, cycle) or lines (mind map, tree) follow.
  - **Click outside the picked box, or press Esc:** back to the whole diagram.
    Selecting another element, or deselecting, also un-picks.
- **Other boxes never move** when one box is resized or moved. Boxes may overlap.
- **Text re-fits** as the box changes: a bigger box allows bigger text (up to 2× the normal 12, so 24),
  a smaller one shrinks it (never below the current minimum).
- **The diagram grows to fit:** if a box goes past the diagram's edge, the drawing area grows to
  include it. Everything already drawn stays in the same place on the slide (also when the
  diagram is rotated or flipped). The diagram can't grow past the box it sits in (canvas, question,
  option or side box); a drag that would do that stops at the edge.
- **Undo:** one whole drag is one undo step (the store already merges quick changes).

## Settings panel

- Text and box count work as today. The S | M | L buttons are removed.
- New **"Tidy up"** text button (next to Reset, same style): puts every box back in its automatic
  spot and size, keeping all text. **Reset** still resets everything.
- Adding a box puts it in its automatic spot. Boxes the teacher moved stay where they are, even if
  that makes them overlap; Tidy up fixes it.

## Saved data

Each diagram box is `{ text, x?, y?, width?, height? }`, all in drawing units (the diagram's
viewBox units). The four numbers are saved together or not at all:

- **Missing:** the box uses its automatic spot and size (today's layout, medium size).
- **Present:** `x, y` = the box's top-left corner, `width, height` = its size. The automatic
  layout is ignored for that box.

Zod (in `schema.ts`, limits in `constants.ts`): `width` 24–400, `height` 16–300, `x`/`y` any finite
number in −2000…2000. The `size` field and `DIAGRAM_BOX_SIZES` are removed (nothing saved uses them:
the diagrams are not committed yet).

## How it is built

### `src/lib/svgLibrary.tsx`

- Each diagram's layout function already places every box. It now:
  - uses a box's saved `x, y, width, height` when it has them, else the automatic spot;
  - works out the drawing area as **all boxes together plus a 4-unit margin**, so it can start
    below 0 (a box dragged up or left). The viewBox's min-x / min-y can be negative.
- New export `getDiagramBoxes(assetId, settings)`: the placed boxes of a diagram in drawing units,
  each with a **path** saying which box it is (`["steps", 2]`, `["center"]`, `["ideas", 0]`,
  `["root"]`, `["branches", 1, "label"]`, `["branches", 1, "leaves", 0]`), plus the viewBox.
  Returns `null` for any other asset. The renderers use the same layouts, so the overlay always
  matches the drawing.
- Text font max = 12 × √(box area ÷ automatic box area), kept between 9 and 24.
- Arrows and lines are still drawn from box centers to box edges, so they follow moved boxes.

### `src/components/editor/DiagramBoxEditor.tsx` (new)

A layer inside the selected diagram element (in `SvgElementItem`, shown only when the diagram is the
one selected element and not being cropped — diagrams can't be cropped anyway):

- Turns each box from drawing units into element px with the same "meet" fit the `<svg>` uses
  (scale = the smaller of width/viewBox-width and height/viewBox-height, centered), mirrored when
  flipped. The element's rotation is already applied by the parent box, so pointer moves are turned
  into element space by rotating them back by the element's angle (and mirroring for flips) and
  dividing by zoom and scale.
- Clicking a box picks it (state kept in this component; cleared when the element is no longer
  the only one selected). Pointer down on the picked box starts a move; on a corner, a resize.
  Clicks on the diagram outside any box fall through to today's whole-element drag.
- On each pointer move it writes the box's new `{ x, y, width, height }` (clamped to the limits) into
  the diagram's settings at the box's path, and works out the new viewBox. If the viewBox changed,
  it also updates the element's `x, y, width, height` so drawn content stays still on the slide:
  the px-per-unit scale stays the same, and the shift of the viewBox's corner (rotated by the element's
  angle around the old center) moves the element. If the new element box would leave its container,
  that move is skipped (the drag stops at the edge).
- Esc un-picks.

### `src/components/editor/MathToolPanels.tsx`

- Remove the S | M | L chips; each box row is just its text input again.
- Add the "Tidy up" button to all four panels (clears `x, y, width, height` from every box, then
  resizes the element with the existing `useResizeForViewBox`).
- Box count and Reset work as today.

### `src/lib/importPresentation.ts`

- Claude's boxes go back to `{ text }` only (no `size`, no positions); Claude keeps the automatic
  layout. Its notes drop the small/medium/large sentence.

## Out of scope

- Resizing by dragging the box's edges (corners only).
- Snapping boxes to each other or to guides.
- Moving arrows on their own, or adding arrows between any two boxes.
- Keeping a box's shape while resizing (Shift).

## Checking

`npx tsc --noEmit` and eslint on the changed files; read the diff against this spec. The teacher
tests in the browser.
