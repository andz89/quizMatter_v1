# Factor Tree diagram, and box shapes for every diagram

Date: 2026-10-07

## What it is

A 5th picture in the **Diagrams** group of the Elements panel: **Factor Tree**. A number splits into two
numbers under it, which can split again, as many levels as the teacher wants (within the limits).
It starts like this:

```
        48
      /    \
     6      8
    / \    / \
   2   3  2   4
             / \
            2   2
```

It works like the other diagrams (spec: `2026-10-06-diagram-box-drag-design.md`): pick a box, drag it,
resize it with the corner and side handles, double-click to type, the box style tools, "+" / ×, undo.
The one new behavior: **when a box moves, every box under it moves with it.**

Also new, for **all five diagrams**: each box can be a **circle** or a **rounded box**.

| Picture | Asset id | Setting | Boxes |
|---|---|---|---|
| Factor Tree | `factor-tree` | `factorTree` | a top box; each box has no children or exactly 2; up to 8 levels and 31 boxes |

## What the teacher does

- **Drag a box:** it moves, and so does everything under it (children, grandchildren, …), including
  boxes the teacher already placed by hand. Dragging a child moves only that child and what is under it.
  The parent and the other side stay still.
- **Resize a box:** only that box changes. Its children in their automatic spot stay just under it, so a
  taller box pushes them down; children placed by hand stay where they are.
- **"+" (Split)** on a box with no children: adds two children under it, both with the text `?`, copying
  the box's look (not its place or size). Hidden when the tree is at its level or box limit.
- **× (Remove this pair)** on any box except the top one: removes that box, its partner, and everything
  under both. The parent then has no children again.
- **Double-click a box:** type its number (or any text) on the slide, as in every diagram.
- **Settings panel:** only **Tidy up** (every box back to its automatic spot and size, text and look
  kept) and **Reset** (the 48 tree above). No count slider: splitting is done with "+" and ×.

## The look

- Every Factor Tree box starts as a **circle** (an oval filling the box) with the diagram's light Color
  tint and Color border, dark text, size 12 — the same defaults as the other diagrams' boxes, only round.
- Joining lines are in the diagram's Color, 2 wide, and go **edge to edge** (from the parent's edge to the
  child's edge), so a line never runs behind a number even when the background is removed.
- The teacher can remove the background or the border, change colors, border width and text size (all
  existing box styles), and switch the shape.

## Box shape (all diagrams)

- New optional box field `shape: "circle" | "rounded"`.
- Missing = the diagram's own default: **circle** for the Factor Tree, **rounded** for the flowchart,
  cycle, mind map and tree (so nothing already made changes).
- The toolbar's box style group gets a **Shape** choice (Circle / Rounded, Lucide icons `CircleIcon` /
  `SquareIcon`), going to the picked box, or every box when none is picked, through
  `diagramStyleTargets` + `withDiagramBoxStyle`, like the other box styles. New boxes ("+") copy it
  (`diagramBoxLook` includes `shape`).
- A circle is an `<ellipse>` filling the box (background, tint and border drawn the same way as the
  rounded `<rect>`).
- **Text in a circle** fits in the largest rectangle inside the oval: the box's width and height ÷ √2
  (minus the usual padding). Same shrink-to-fit rule as now (`fitDiagramText`). The typing area on the
  slide uses that same narrower room.
- **Lines and arrows stop at the oval's edge** (`boxEdge` becomes shape-aware: for an oval with half-sizes
  a, b and direction (ux, uy), the edge is at t = 1 / √((ux/a)² + (uy/b)²)).
- Picking a box still uses its whole rectangle (clicking the corner just outside the oval picks it too).

## Saved data

```ts
factorTree: { root: FactorNode }
FactorNode = DiagramBox & { children?: [FactorNode, FactorNode] }
```

- `DiagramBox` is the existing box (`text`, `x, y, width, height` all or none, `fill`, `border`,
  `borderWidth`, `textColor`, `fontSize`) plus the new `shape`.
- Zod: `factorNodeSchema` built with `z.lazy` (a schema that contains itself), `children` a tuple of
  exactly 2. A refine on `factorTree` checks the whole tree is at most `FACTOR_TREE_LEVELS` (8) levels
  deep and has at most `FACTOR_TREE_BOXES` (31) boxes. Both limits live in `constants.ts`. 2⁶ = 64
  (7 levels, 13 boxes) fits easily.
- A box's path: `["root"]`, `["root", "children", 0]`, `["root", "children", 1, "children", 0]`, …
  The existing `replaceAtPath` works on these as-is.

## Automatic layout (`factorTreeBoxes` in `svgLibrary.tsx`)

One layout, used by both the drawing and the editor (`getDiagramBoxes`), as for every diagram.

- Automatic box size: `FACTOR_BOX = { width: 44, height: 34 }`.
- Each subtree's width is worked out first (bottom up): a box alone = its width; a box with children =
  the left child's subtree width + a gap (12) + the right child's subtree width, or its own width if wider.
- The top box sits at the top middle. A child's automatic spot is measured **from its parent's drawn
  box** (its own place if moved, else its automatic spot): its top is the parent's bottom + a level gap
  (22); its middle is left or right of the parent's middle by half the space its side needs (so the
  two sides never overlap).
- Because children are placed from where their parent is drawn, moving the parent moves its
  automatically placed children with no extra saving.
- `allFactorTreeBoxes` lists every box, parents before children (so children are drawn, and picked,
  on top).

## Dragging (`moveDiagramBox` in `svgLibrary.tsx`)

- New helper `moveDiagramBox(diagram, box, next)`: returns the diagram's settings with `box` at `next`
  (its own place and size).
- For the Factor Tree it also adds the same move (`next.x − box.x`, `next.y − box.y`) to every box under
  `box` that has its own place, each kept within `DIAGRAM_BOX_POSITION_MAX`. Boxes under it in their
  automatic spot follow by themselves (see layout).
- For the other four diagrams it only does `replaceAtPath`, exactly as today.
- `DiagramBoxEditor.moveDrag` uses it for a **move** drag. The drag starts from the settings at
  pointer-down (kept in the drag state), so each pointer move applies the total move once, not again on
  top of the last one. Resize drags don't change.
- Everything else stays: `keepInPlace` keeps the rest of the slide still when the drawing area changes,
  the question/option/side box edge stop works, one whole drag is one undo step.

## "+" and × (`diagramBoxActions`)

New `factorTree` case, the only place these rules live:

- Box with no children, tree under its limits (adding 2 boxes keeps ≤ 31 boxes, and the new level ≤ 8):
  one add, edge `bottom`, title "Split into two", settings with `children: [{ ...look, text: "?" }, { ...look, text: "?" }]`.
- Any box but the top: remove, title "Remove this pair", settings with the parent's `children` taken out.
- The top box: no ×.

## Settings panel (`MathToolPanels.tsx`)

`FactorTreeControls`: **Tidy up** and **Reset**, the same buttons and resize handling
(`useResizeForViewBox`) as the other diagram panels.

## Claude (JSON import / MCP)

`importPresentation.ts` accepts `factorTree: { root: { text, children? } }` on the `factor-tree` picture
(boxes as `{ "text": … }` only, automatic layout, same level/box limits), and the prompt text lists
`factor-tree` with the other ready-made diagrams ("use it for prime factorization").

## Where the code changes

- `src/lib/constants.ts`: `FACTOR_TREE_LEVELS`, `FACTOR_TREE_BOXES`, `DIAGRAM_SHAPES`.
- `src/lib/schema.ts`: `shape` on `diagramBoxSchema`; `factorNodeSchema`; `factorTree` setting.
- `src/lib/svgLibrary.tsx`: `DiagramKey` + `"factorTree"`; default shape per diagram; `DiagramBox` draws
  ovals; `fitDiagramText` and `boxEdge` shape-aware; `factorTreeBoxes`, `renderFactorTree`,
  `getFactorTreeViewBox`, `DEFAULT_FACTOR_TREE`; `getDiagramBoxes`, `diagramBoxActions`,
  `diagramBoxLook` updated; `moveDiagramBox`; the `factor-tree` asset; `"factorTree"` in the math tool list.
- `src/components/editor/DiagramBoxEditor.tsx`: move drag uses `moveDiagramBox`; typing area uses the
  circle's narrower room.
- `src/components/editor/SelectedElementToolbar.tsx`: Shape choice in the box style group.
- `src/components/editor/MathToolPanels.tsx`: `FactorTreeControls`.
- `src/lib/importPresentation.ts`: Claude's `factorTree`.
- `docs/superpowers/specs/2026-10-06-diagram-box-drag-design.md` and the Diagrams section of `CLAUDE.md`:
  the Factor Tree, shapes and the "children follow" rule.

No new packages. No database changes (the element JSON is saved as before, checked by zod first).

## Not included

- The app doesn't work out factors; the teacher types them.
- No Factor Tree panel list of boxes (adding and removing is on the slide).
- Shapes other than circle and rounded.
