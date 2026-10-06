# Diagram boxes: add and remove on the slide, and border width

Date: 2026-10-07

Builds on `2026-10-06-diagram-box-drag-design.md` (boxes work like text boxes) and
`2026-10-07-diagram-box-style-design.md` (each box's own background, border, text color and size).

## What it is

1. **"+" and × buttons on every box** while the diagram is selected, so the teacher adds a box exactly
   where they want it, or removes one, right on the slide.
2. **Border width** per box, set like the border color: for the picked box, or every box when none is
   picked.

## "+" buttons

Shown on **every box** whenever the diagram is selected (one element selected, and it's a diagram).
Each "+" sits on the box's edge, on the side where the new box goes:

| Diagram | Box | "+" (where) | Adds |
|---|---|---|---|
| Flowchart | each step | right edge (Across) / bottom edge (Down) | a step right after it |
| | first step only | also left edge (Across) / top edge (Down) | a step before it |
| Cycle | each step | right edge | the next step after it (clockwise) |
| Mind map | main idea | right edge | a new idea at the end of the list |
| | each idea | right edge | a new idea right after it |
| Tree | top box | bottom edge | a new branch at the end |
| | each branch | bottom edge | a box under it, at the end of its list |
| | | right edge | a new branch right after it |
| | each box under a branch | bottom edge | a box right after it, under the same branch |

- A "+" is hidden when the list it adds to is full (`FLOWCHART_STEPS.max`, `CYCLE_STEPS.max`,
  `MIND_MAP_IDEAS.max`, `TREE_BRANCHES.max`, `TREE_LEAVES_MAX`).
- **The new box:** text "Step N" (N = its new place, from 1) for flowchart and cycle, "Idea" for the
  mind map, "Group" for a tree branch, "Item" for a tree box. It copies the **look** (`fill`, `border`,
  `borderWidth`, `textColor`, `fontSize`) of the box whose "+" was clicked, never its place or size, so
  it sits in its automatic spot.

## × buttons

- On **every box**, at its top-right corner, except where removing isn't allowed:
  - the mind map's main idea and the tree's top box (never removable);
  - any box whose list is at its smallest (`FLOWCHART_STEPS.min`, `CYCLE_STEPS.min`,
    `MIND_MAP_IDEAS.min`, `TREE_BRANCHES.min`). Tree boxes under a branch can always be removed (min 0).
- Removing a tree **branch** removes the boxes under it too (as the panel's × does today).
- If the removed box was picked or being typed in, it is let go of (`pickedDiagramBox` and
  `editingDiagramBox` cleared). Otherwise, a picked box that shifts in its list keeps pointing at the
  same list place (known gap, same as the panel today).

## What happens to the other boxes

- Boxes in their **automatic spots** shift to make room or close the gap (e.g. inserting step 2 moves
  the later steps along). Boxes the teacher **moved** keep their own place.
- The diagram **stays in place on the slide**: when the drawing area changes, the element is moved and
  resized with `keepInPlace` (the same as dragging a box), so nothing already drawn jumps.
- Inside a question, option or side box, an add that would push the diagram past that box's edge is
  still allowed (unlike dragging): the diagram may stick out, and the teacher can fix it. (Adding is a
  single click with nothing to "stop at".)
- Each click is **one undo step**.

## Look and feel

- **"+"**: an 18px (on screen, any zoom) violet circle (`bg-accent`, `hover:bg-accent-hover`) with a
  white Lucide `PlusIcon` (size 12), centered on the box edge's middle. Title: "Add a step after",
  "Add a step before", "Add an idea", "Add a box under", "Add a branch", "Add a box after".
- **×**: an 18px white circle (`bg-bg-surface`, `border border-border-default`) with a Lucide `XIcon`
  (size 12, `text-text-secondary`), turning coral on hover (`hover:bg-danger-soft hover:text-danger-strong`).
  Title: "Remove this box" / "Remove this branch".
- Hidden while a box is being **dragged** or **typed in**. Clicking them never picks, moves or deselects
  anything.
- They are drawn by the editor only (never in present mode, thumbnails or the server).

## Border width

- When the Color panel is open on **Box border** (with a diagram selected), it shows the **Thickness**
  slider (the same `PanelSlider` shapes use), range **1–8** drawing units, step 1. It changes the
  picked box, or every box when none is picked (`diagramStyleTargets` + `withDiagramBoxStyle`).
- Greyed out when the first target's border is "none". Starts at the first target's width.
- Default (unset) = **2**, today's width.
- Saved as `borderWidth?` on each box. Limits `DIAGRAM_BORDER_WIDTH = { min: 1, max: 8, default: 2 }` in
  `constants.ts`, checked by `diagramBoxSchema` (zod).

## Saved data

Each box: `{ text, x?, y?, width?, height?, fill?, border?, borderWidth?, textColor?, fontSize? }`.
Adding and removing only change the lists that already exist (`steps`, `ideas`, `branches`, `leaves`).

## Where the rules live

One helper in `svgLibrary.tsx` holds the on-slide rules (which lists, where, the min/max, the new
text, copying the look):

- `diagramBoxActions(diagram, box)` → which "+" buttons the box has (each: edge side, title, and the
  new setting) and whether it has a × (and the setting after removing).
- The panel's count slider and the Tree panel's add/remove buttons keep working as they do today
  (they already copy the look with `lookOf`); they are not rewritten to use the helper.

## Where the code changes

| File | Change |
|---|---|
| `src/lib/constants.ts` | `DIAGRAM_BORDER_WIDTH` |
| `src/lib/schema.ts` | `borderWidth` on `diagramBoxSchema` |
| `src/lib/svgLibrary.tsx` | `DiagramBox` uses `borderWidth`; `DiagramBoxStyle` gains it; `diagramBoxActions` |
| `src/components/editor/DiagramBoxButtons.tsx` (new) | the "+" and × buttons on every box; writes the new setting with `keepInPlace` |
| `src/components/editor/DiagramBoxEditor.tsx` | export `keepInPlace`, `getFrame`, `boxToPx` for the buttons |
| `src/components/editor/SvgElementItem.tsx` | renders `DiagramBoxButtons` when the diagram is the only selected element |
| `src/components/editor/ColorPanel.tsx` | Thickness slider for Box border |
| `src/components/editor/MathToolPanels.tsx` | `lookOf` copies `borderWidth` too |

No new packages.

## Not in scope

- Reordering boxes (drag to change order)
- Delete key removing the picked box (it still removes the whole diagram)
- Adding a box before the first cycle step or mind map idea (a ring has no start; ideas are added after)
