# Diagrams: flowchart, cycle, mind map, tree and factor tree

Date: 2026-10-06 (updated the same day as the feature changed; this file describes how it works now)

## What it is

The **Diagrams** group of the Elements panel (right after Math Tools) has five pictures that show how
ideas connect:

| Picture | Asset id | Setting | Boxes |
|---|---|---|---|
| Flowchart | `flowchart` | `flowchart` | 2–8 steps in a row (Across) or column (Down), joined by dark arrows |
| Cycle | `cycle` | `cycle` | 3–8 steps in a ring, the first at the top, arrows going clockwise |
| Mind Map | `mind-map` | `mindMap` | a main idea in the middle, 2–8 ideas around it, joined by colored lines |
| Tree | `tree-diagram` | `tree` | a top box, 2–4 branches under it, 0–4 boxes under each branch, joined by colored lines |
| Factor Tree | `factor-tree` | `factorTree` | a top box; each box splits into exactly 2 or none; up to 8 levels and 31 boxes; circles joined by colored lines, edge to edge |

Boxes are rounded, with a light tint of the element color and dark text. The mind map's main idea and
the tree's top box get a stronger tint. Factor Tree boxes start as circles; any box can be switched
between a circle and a rounded box (the toolbar's shape button).

## What the teacher does

- **Click a diagram once:** it is selected like any element (move, resize, rotate the whole diagram).
- **Click a box inside the selected diagram:** that box is *picked*. It gets a violet outline and the
  **same handles as a text box**:
  - **Corners:** resize the box keeping its shape; the opposite corner stays put.
  - **Left / right handles:** change only its width. **Top / bottom handles:** change only its height.
  - **Drag the box itself:** move it. Its arrows or lines follow it. Other boxes never move; boxes may overlap.
    In the **Factor Tree**, every box under it (children, grandchildren, …) moves with it, also ones placed by hand.
- **Double-click a box:** type its text right on the slide (a typing area over the box, in the drawn
  text's size). **Shift+Enter** = new line; **Enter**, **Esc** or a click outside finishes.
- **"+" / ×** on every box (diagram selected): add a box next to it, or remove it. Factor Tree: "+" = Split into
  two (a `?` and a `?` under a box with no split), × = Remove this pair (the box, its partner and everything under them).
- **Esc** (not typing) or a click outside the box lets go of it. Selecting something else or
  deselecting does too.
- **Undo:** one whole drag is one undo step; typing is grouped like any typing.

## Text, like a text box

- A box **keeps its size** whatever its text (it never grows by itself).
- Text is size 12 (drawing units) and **shrinks to fit** the box when it's too long, down to 1. A bigger
  box does not make the text bigger.
- Lines wrap between words (a word too wide on its own is cut), and each Shift+Enter line starts a new line.
- Letter widths are **measured** with the page's font (canvas `measureText`, semibold), so the drawing
  breaks lines where the typing area does. Only once the page's fonts have loaded: before that, and on
  the server, an average letter width is used, so the server and the browser's first draw match
  (no hydration mismatch). The drawing redraws when the fonts finish loading.
- Up to 50,000 letters per box, the same as a text box.

## The diagram on the slide

- When a box goes past the diagram's edge, the drawing area grows to include it, and the element is
  moved and resized so **nothing already drawn moves on the slide** (also when rotated or flipped).
- Inside a question, option or side box, a drag that would push the diagram past that box's edge stops
  (compared with how far it already sticks out, so a turned diagram near the edge still works). On the
  slide itself, elements may already stick out past the edge, so there it may grow.

## Settings panel (button on the selected-element toolbar)

- **Box count** slider (Steps / Ideas); the Flowchart also has **Across / Down**.
- **Factor Tree:** only Tidy up and Reset (splitting is done with "+" and × on the slide).
- **Tree:** each branch and box is listed by its text (read-only) with **×** to remove it, plus
  **+ Add box** and **+ Add branch**.
- **Tidy up:** puts every box back in its automatic spot and size, keeping its text.
- **Reset:** everything back to the start.
- There are no text boxes in the panel: text is typed on the slide.
- Changing the box count keeps the diagram where it is: typing in a box doesn't move it, and removing a
  moved box doesn't make the others jump.

## Saved data

Each box is `{ text, x?, y?, width?, height?, fill?, border?, borderWidth?, textColor?, fontSize?, shape? }` in drawing units (the diagram's viewBox units):

- No `x, y, width, height`: the box uses its automatic spot and size.
- All four: the box's own place (top-left) and size. The four are saved together or not at all.

- Factor Tree boxes also have `children?`: exactly 2 boxes (`factorNodeSchema`, a nested `z.lazy` schema).
  The whole tree is at most `FACTOR_TREE_LEVELS` (8) levels and `FACTOR_TREE_BOXES` (31) boxes.
- `shape`: `rounded` or `circle`; missing = the diagram's own (circle for the Factor Tree, rounded for the rest).

Zod (`diagramBoxSchema` in `schema.ts`, limits in `constants.ts`): text up to `DIAGRAM_TEXT_MAX`
(50,000), width 24–400, height 16–300, x/y −2000…2000, box counts as in the table above.

## Claude (JSON import / MCP)

Claude adds diagrams with the `flowchart`, `cycle`, `mindMap`, `tree` and `factorTree` element settings, boxes as
`{ "text": "…" }` (`\n` = new line). Claude always uses the automatic layout; it can't place or size
single boxes. A factor tree's numbers are `{ "text": "…", "children"?: [two numbers] }`.

## Where the code lives

- `src/lib/svgLibrary.tsx`, section "Diagrams": layouts (`flowchartBoxes`, `cycleBoxes`,
  `mindMapBoxes`, `treeBoxes`, `factorTreeLayout`), `placeBox`, text measuring and fitting (`textWidth`, `wrapLines`,
  `fitDiagramText`), drawing (`DiagramBox`, `DiagramArrow`, `DiagramLine`), `getDiagramBoxes`
  (every placed box of a diagram, used by the editor), `diagramTextRoom` (text room per shape) and
  `moveDiagramBox` (a dragged box's new setting; in the Factor Tree also the boxes under it).
- `src/components/editor/DiagramBoxEditor.tsx`: the picked box's outline and handles, moving and
  resizing (`resizeBox`, `keepInPlace`), finding the box under the pointer (`findDiagramBoxAt`), and the
  typing area (`DiagramTextArea`).
- `src/components/editor/handles.ts`: the resize handles shared with every element (`CORNERS`, `EDGE_HANDLES`).
- `src/components/editor/SvgElementItem.tsx`: a click on a selected diagram picks a box; a double-click
  starts typing.
- `src/lib/store.ts`: `pickedDiagramBox` and `editingDiagramBox` (UI state, not saved).
- `src/components/editor/ElementSvg.tsx`: tells the drawing when the fonts have loaded (`fontsReady`).
- `src/components/editor/MathToolPanels.tsx`: the four settings panels.
- `src/lib/importPresentation.ts`: Claude's diagram settings.

## History

1. Built as four diagrams with text boxes in the panel and Small / Medium / Large box sizes.
2. S/M/L replaced by picking a box on the slide and dragging it or its corners freely (plan:
   `docs/superpowers/plans/2026-10-06-diagram-box-drag.md`).
3. Text typed on the slide (panel text boxes removed); boxes grew taller for long text.
4. Boxes made to work exactly like a text box: no growing, shrink-to-fit text, corner + side handles,
   real letter widths.
5. Box background, border, text color and text size (spec: `2026-10-07-diagram-box-style-design.md`).
6. "+" / × on every box, and box border width (spec: `2026-10-07-diagram-box-add-remove-design.md`).
7. Factor Tree, and box shape (circle / rounded) for every diagram (spec: `2026-10-07-factor-tree-design.md`).

## Known gaps (not done yet)

- Runs of spaces show while typing but shrink to one in the drawing; words with "-" or "/" may break
  a little differently from the typing area.
- Very long text (thousands of letters) can't fit a small box even at size 1, so it spills out.
- A box at the diagram's corner has its corner handle under the diagram's own; on a tiny box the
  handles can cover it.
- A picked box can stay picked after switching slides and back, or point at a neighbor after the panel
  removes a box.
- With a gradient color, the gradient shifts when the drawing area changes.
- Delete and arrow keys act on the whole diagram while a box is picked.
- Switching the Flowchart between Across and Down keeps moved boxes where they were.
- Factor Tree: splitting a number widens its side, so the boxes beside it spread apart (the top box stays still).
- A circle is picked by its whole box, so a click just outside the oval near a corner still picks it.
