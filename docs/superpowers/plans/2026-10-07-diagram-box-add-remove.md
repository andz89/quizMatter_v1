# Diagram Box Add/Remove and Border Width Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "+" and × buttons on every box of a selected diagram to add or remove a box right there, and a per-box border width set from the Color panel.

**Architecture:** One helper in `svgLibrary.tsx` (`diagramBoxActions`) holds the add/remove rules per diagram type and returns ready-made new settings. A new editor component (`DiagramBoxButtons.tsx`) draws the buttons on every box (placed with the same box positions as the drawing) and writes the chosen setting with `keepInPlace`, like a box drag. Border width is one more optional box field, drawn by `DiagramBox` and set by a Thickness slider in the Color panel through the existing `diagramStyleTargets` + `withDiagramBoxStyle`.

**Tech Stack:** Next.js, React, TypeScript, Zustand (`src/lib/store.ts`), zod, Tailwind (QuizMatter design system), `lucide-react`. No new packages.

**Spec:** `docs/superpowers/specs/2026-10-07-diagram-box-add-remove-design.md`

## Global Constraints

- zod checks every saved value (`diagramBoxSchema`); limits live in `src/lib/constants.ts`.
- Design system classes only; Lucide icons with `size`; coral (`danger`) only for remove.
- Border width: `DIAGRAM_BORDER_WIDTH = { min: 1, max: 8, default: 2 }` (drawing units).
- New box text: "Step N" (flowchart, cycle; N = its new place from 1), "Idea", "Group" (tree branch), "Item" (tree box). It copies the look (`fill`, `border`, `borderWidth`, `textColor`, `fontSize`) of the box whose "+" was clicked; never its place or size.
- Limits: `FLOWCHART_STEPS {2,8}`, `CYCLE_STEPS {3,8}`, `MIND_MAP_IDEAS {2,8}`, `TREE_BRANCHES {2,4}`, `TREE_LEAVES_MAX 4`.
- **Do not commit.** The branch has the user's uncommitted diagram work in the same files.
- No unit test runner: each task's gate is `npx tsc --noEmit` + `npx eslint <changed files>` (`npm run lint` runs out of memory on build output). Live testing is the user's.

## Plan rulings against the spec (record in the ledger, tell the user)

- **Buttons follow the box while it's dragged** instead of hiding: the box drag keeps no "dragging" state (it's a ref), and the buttons redraw from the element on every move anyway. They still hide while typing.
- **Buttons scale with zoom like the existing handles** (they live inside the element, as the handles do), instead of a fixed on-screen size.
- **Buttons sit just outside the box** ("+" 16px past the edge's middle; × 12px out from the top-right corner, diagonally) so they never cover the picked box's corner and side handles.
- **Any remove lets go of a picked box of that diagram** (not only when the removed box was picked), which also fixes the "picked box points at a neighbor" gap for this path.

## Review Focus

1. **Flipped or turned diagram:** a "+" on the "right" edge (in drawing units) must show on the side where the new box actually appears on screen, i.e. on the left when the diagram is flipped across. Task 3 swaps edges for `flipX` / `flipY`.
2. **Clicking a button must not pick a box, start a drag, deselect the diagram, or start typing** (pointerdown, click and double-click all stop there).
3. **At the limits:** no "+" when a list is full; no × when a list is at its smallest; the tree's leaves can go to 0; the mind map center and tree root never get ×.
4. **Adding a step before the first flowchart step, or anywhere, keeps the rest of the diagram still on the slide** (`keepInPlace`), including boxes the teacher moved.
5. **Border width when the border is None:** the slider is greyed out; a box with `borderWidth` but border "none" draws no border.

---

### Task 1: Border width, and one shared "look" helper

**Files:**
- Modify: `src/lib/constants.ts` (after `DIAGRAM_NONE`)
- Modify: `src/lib/schema.ts` (`diagramBoxSchema`, constants import)
- Modify: `src/lib/svgLibrary.tsx` (constants import, `DiagramBox`, `DiagramBoxStyle`, new `diagramBoxLook`)
- Modify: `src/components/editor/MathToolPanels.tsx` (`lookOf` → `diagramBoxLook`)
- Modify: `src/components/editor/ColorPanel.tsx` (Thickness slider for Box border)

**Interfaces:**
- Produces: `DIAGRAM_BORDER_WIDTH`; `borderWidth?: number` on a diagram box; `DiagramBoxStyle` includes `borderWidth`; `export function diagramBoxLook(box: DiagramBoxItem | undefined): DiagramBoxStyle`.

- [ ] **Step 1: Limit in `constants.ts`**, right after `DIAGRAM_NONE`:

```ts
// A diagram box's border width (drawing units). `default` is the width of a box with none chosen.
export const DIAGRAM_BORDER_WIDTH = { min: 1, max: 8, default: 2 };
```

- [ ] **Step 2: Schema.** Add `DIAGRAM_BORDER_WIDTH` to the `./constants` import in `schema.ts`, and in `diagramBoxSchema` after the `border` line:

```ts
    borderWidth: z.number().min(DIAGRAM_BORDER_WIDTH.min).max(DIAGRAM_BORDER_WIDTH.max).optional(),
```

Update the comment above the schema: "Its own look is optional too: background and border (a color or "none"), border width, text color and the biggest text size. Missing = the diagram's Color tint, a Color border 2 wide, dark text, size 12."

- [ ] **Step 3: Draw it.** In `svgLibrary.tsx` change the constants import to
`import { BORDER_WIDTH_DEFAULT, DIAGRAM_BORDER_WIDTH, DIAGRAM_FONT_SIZE, DIAGRAM_NONE } from "./constants";`
In `DiagramBox` change `const { fill, border, textColor } = box.item;` to
`const { fill, border, borderWidth, textColor } = box.item;` and the border rect's `strokeWidth="2"` to
`strokeWidth={borderWidth ?? DIAGRAM_BORDER_WIDTH.default}`.

- [ ] **Step 4: Style type + shared look helper.** Replace the `DiagramBoxStyle` line with:

```ts
// A box's own look (the fields a style change writes).
export type DiagramBoxStyle = Partial<Pick<DiagramBoxItem, "fill" | "border" | "borderWidth" | "textColor" | "fontSize">>;

// A box's look only (no text, place or size), so a new box can match the one it's added next to.
export function diagramBoxLook(box: DiagramBoxItem | undefined): DiagramBoxStyle {
  return { fill: box?.fill, border: box?.border, borderWidth: box?.borderWidth, textColor: box?.textColor, fontSize: box?.fontSize };
}
```

- [ ] **Step 5: Panel uses the shared helper.** In `MathToolPanels.tsx`, delete the local `lookOf` (its comment and body), add `diagramBoxLook` to the `@/lib/svgLibrary` import (and drop `type DiagramBoxStyle` from it if now unused), and replace every `lookOf(` with `diagramBoxLook(` (4 places: `autoPlaced`, `DiagramBoxCount`, Tree "Add box", Tree "Add branch").

- [ ] **Step 6: Thickness slider.** In `ColorPanel.tsx` add `DIAGRAM_BORDER_WIDTH` to the constants import. Right after the existing `{isShapeBorder && ( … )}` slider block, add:

```tsx
      {/* Diagram box border: greyed out while the border is "none". */}
      {boxStyle?.key === "border" && diagram && diagramElement && (
        <div className={`mb-6 ${boxStyleColor === DIAGRAM_NONE ? "pointer-events-none opacity-40" : ""}`}>
          <PanelSlider
            label="Thickness"
            unit=""
            value={styleTargets[0]?.item.borderWidth ?? DIAGRAM_BORDER_WIDTH.default}
            min={DIAGRAM_BORDER_WIDTH.min}
            max={DIAGRAM_BORDER_WIDTH.max}
            onChange={(width) =>
              updateElement(
                selectedSlideId,
                diagramElement.id,
                withDiagramBoxStyle(diagram, styleTargets, {
                  borderWidth: Math.min(DIAGRAM_BORDER_WIDTH.max, Math.max(DIAGRAM_BORDER_WIDTH.min, width)),
                }),
              )
            }
          />
        </div>
      )}
```

- [ ] **Step 7: Check**

Run: `npx tsc --noEmit` — Expected: exit 0.
Run: `npx eslint src/lib/constants.ts src/lib/schema.ts src/lib/svgLibrary.tsx src/components/editor/MathToolPanels.tsx src/components/editor/ColorPanel.tsx` — Expected: exit 0.

---

### Task 2: The add/remove rules (`diagramBoxActions`)

**Files:**
- Modify: `src/lib/svgLibrary.tsx` (constants import; new code right after `withDiagramBoxStyle`)

**Interfaces:**
- Consumes: `diagramBoxLook`, `DiagramBoxes`, `PlacedDiagramBox`, `FlowchartSettings`, `CycleSettings`, `MindMapSettings`, `TreeSettings` (all in `svgLibrary.tsx`).
- Produces:
  - `export type DiagramEdge = "left" | "right" | "top" | "bottom"`
  - `export interface DiagramBoxAdd { edge: DiagramEdge; title: string; settings: DiagramBoxes["settings"] }`
  - `export interface DiagramBoxActions { adds: DiagramBoxAdd[]; remove: { title: string; settings: DiagramBoxes["settings"] } | null }`
  - `export function diagramBoxActions(diagram: DiagramBoxes, box: PlacedDiagramBox): DiagramBoxActions`

- [ ] **Step 1: Import the limits.** Extend the `./constants` import:

```ts
import {
  BORDER_WIDTH_DEFAULT,
  CYCLE_STEPS,
  DIAGRAM_BORDER_WIDTH,
  DIAGRAM_FONT_SIZE,
  DIAGRAM_NONE,
  FLOWCHART_STEPS,
  MIND_MAP_IDEAS,
  TREE_BRANCHES,
  TREE_LEAVES_MAX,
} from "./constants";
```

(If any of these names is already defined or imported elsewhere in `svgLibrary.tsx`, keep one import and note it.)

- [ ] **Step 2: Add the rules** right after `withDiagramBoxStyle`:

```ts
// Which side of a box (in drawing units) a "+" sits on: where the new box will go.
export type DiagramEdge = "left" | "right" | "top" | "bottom";

// One "+" of a box: where it sits, its tooltip, and the diagram's setting once it's clicked.
export interface DiagramBoxAdd {
  edge: DiagramEdge;
  title: string;
  settings: DiagramBoxes["settings"];
}

// The "+" buttons of a box, and its × (null when it can't be removed).
export interface DiagramBoxActions {
  adds: DiagramBoxAdd[];
  remove: { title: string; settings: DiagramBoxes["settings"] } | null;
}

// `list` with `item` put in at `index`, or with the item at `index` taken out.
const insertAt = <T,>(list: T[], index: number, item: T) => [...list.slice(0, index), item, ...list.slice(index)];
const removeAt = <T,>(list: T[], index: number) => list.filter((_, i) => i !== index);

/**
 * What the "+" and × buttons on a box do. A new box goes next to this one, copies its look (not its
 * place or size), and sits in its automatic spot. Lists never go past their limits.
 */
export function diagramBoxActions(diagram: DiagramBoxes, box: PlacedDiagramBox): DiagramBoxActions {
  const look = diagramBoxLook(box.item);
  const [key, i, sub, j] = box.path as [string, number?, string?, number?];

  switch (diagram.key) {
    case "flowchart": {
      const settings = diagram.settings as FlowchartSettings;
      const index = i ?? 0;
      const step = (at: number) => ({ ...look, text: `Step ${at + 1}` });
      const adds: DiagramBoxAdd[] = [];
      if (settings.steps.length < FLOWCHART_STEPS.max) {
        adds.push({
          edge: settings.vertical ? "bottom" : "right",
          title: "Add a step after",
          settings: { ...settings, steps: insertAt(settings.steps, index + 1, step(index + 1)) },
        });
        if (index === 0) {
          adds.push({
            edge: settings.vertical ? "top" : "left",
            title: "Add a step before",
            settings: { ...settings, steps: insertAt(settings.steps, 0, step(0)) },
          });
        }
      }
      const remove =
        settings.steps.length > FLOWCHART_STEPS.min
          ? { title: "Remove this box", settings: { ...settings, steps: removeAt(settings.steps, index) } }
          : null;
      return { adds, remove };
    }
    case "cycle": {
      const settings = diagram.settings as CycleSettings;
      const index = i ?? 0;
      const adds: DiagramBoxAdd[] =
        settings.steps.length < CYCLE_STEPS.max
          ? [{ edge: "right", title: "Add the next step", settings: { steps: insertAt(settings.steps, index + 1, { ...look, text: `Step ${index + 2}` }) } }]
          : [];
      const remove =
        settings.steps.length > CYCLE_STEPS.min ? { title: "Remove this box", settings: { steps: removeAt(settings.steps, index) } } : null;
      return { adds, remove };
    }
    case "mindMap": {
      const settings = diagram.settings as MindMapSettings;
      // The main idea adds at the end; an idea adds right after itself.
      const at = key === "center" ? settings.ideas.length : (i ?? 0) + 1;
      const adds: DiagramBoxAdd[] =
        settings.ideas.length < MIND_MAP_IDEAS.max
          ? [{ edge: "right", title: "Add an idea", settings: { ...settings, ideas: insertAt(settings.ideas, at, { ...look, text: "Idea" }) } }]
          : [];
      const remove =
        key === "ideas" && settings.ideas.length > MIND_MAP_IDEAS.min
          ? { title: "Remove this box", settings: { ...settings, ideas: removeAt(settings.ideas, i ?? 0) } }
          : null;
      return { adds, remove };
    }
    case "tree": {
      const settings = diagram.settings as TreeSettings;
      const canAddBranch = settings.branches.length < TREE_BRANCHES.max;
      const newBranch = { label: { ...look, text: "Group" }, leaves: [] };
      if (key === "root") {
        return {
          adds: canAddBranch
            ? [{ edge: "bottom", title: "Add a branch", settings: { ...settings, branches: [...settings.branches, newBranch] } }]
            : [],
          remove: null,
        };
      }
      const b = i ?? 0;
      const branch = settings.branches[b];
      const withBranch = (next: typeof branch) => ({ ...settings, branches: settings.branches.map((old, k) => (k === b ? next : old)) });
      if (sub === "label") {
        const adds: DiagramBoxAdd[] = [];
        if (branch.leaves.length < TREE_LEAVES_MAX) {
          adds.push({ edge: "bottom", title: "Add a box under", settings: withBranch({ ...branch, leaves: [...branch.leaves, { ...look, text: "Item" }] }) });
        }
        if (canAddBranch) {
          adds.push({ edge: "right", title: "Add a branch", settings: { ...settings, branches: insertAt(settings.branches, b + 1, newBranch) } });
        }
        const remove =
          settings.branches.length > TREE_BRANCHES.min
            ? { title: "Remove this branch", settings: { ...settings, branches: removeAt(settings.branches, b) } }
            : null;
        return { adds, remove };
      }
      // A box under a branch.
      const leaf = j ?? 0;
      const adds: DiagramBoxAdd[] =
        branch.leaves.length < TREE_LEAVES_MAX
          ? [{ edge: "bottom", title: "Add a box after", settings: withBranch({ ...branch, leaves: insertAt(branch.leaves, leaf + 1, { ...look, text: "Item" }) }) }]
          : [];
      return { adds, remove: { title: "Remove this box", settings: withBranch({ ...branch, leaves: removeAt(branch.leaves, leaf) }) } };
    }
  }
}
```

Notes for the implementer:
- In a `.tsx` file a generic arrow needs `<T,>` (the comma), as written.
- `newBranch.leaves` is `[]`; if TypeScript infers `never[]` and complains, type it: `const newBranch: TreeSettings["branches"][number] = { … }`.
- If `CycleSettings` has more fields than `steps`, spread `...settings` into the cycle settings too (check its type).

- [ ] **Step 3: Check**

Run: `npx tsc --noEmit` — Expected: exit 0.
Run: `npx eslint src/lib/svgLibrary.tsx` — Expected: exit 0.

---

### Task 3: The buttons on the slide

**Files:**
- Modify: `src/components/editor/DiagramBoxEditor.tsx` (export `getFrame`, `boxToPx`, `keepInPlace`)
- Create: `src/components/editor/DiagramBoxButtons.tsx`
- Modify: `src/components/editor/SvgElementItem.tsx` (render it next to `DiagramBoxEditor`, ~line 682)

**Interfaces:**
- Consumes: `diagramBoxActions`, `DiagramEdge` (Task 2); `getDiagramBoxes`, `getElementAsset`, `getAssetViewBox` (svgLibrary).
- Produces: `export function DiagramBoxButtons({ slideId, element }: { slideId: string; element: SvgElement })`.

- [ ] **Step 1: Export the three helpers** in `DiagramBoxEditor.tsx`: change `function getFrame(`, `function boxToPx(` and `function keepInPlace(` to `export function …`. No other change.

- [ ] **Step 2: Create `src/components/editor/DiagramBoxButtons.tsx`:**

```tsx
"use client";

import { useEditorStore } from "@/lib/store";
import {
  diagramBoxActions,
  getAssetViewBox,
  getDiagramBoxes,
  getElementAsset,
  type DiagramBoxes,
  type DiagramEdge,
} from "@/lib/svgLibrary";
import type { SvgElement } from "@/lib/schema";
import { PlusIcon, XIcon } from "lucide-react";
import { boxToPx, getFrame, keepInPlace } from "./DiagramBoxEditor";

// How far past a box's edge a "+" sits, and how far out from its top-right corner the × sits (px), so
// they never cover the picked box's handles.
const PLUS_OUT = 16;
const REMOVE_OUT = 12;

// A drawing-units side as it shows on screen: mirrored like the picture when the diagram is flipped.
function screenEdge(edge: DiagramEdge, element: SvgElement): DiagramEdge {
  if (element.flipX && (edge === "left" || edge === "right")) return edge === "left" ? "right" : "left";
  if (element.flipY && (edge === "top" || edge === "bottom")) return edge === "top" ? "bottom" : "top";
  return edge;
}

// Stops a button's pointer and clicks from picking a box, starting a drag, deselecting or typing.
const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/**
 * "+" and × on every box of the selected diagram: "+" adds a box next to that one (on the side where it
 * goes), × removes it. Like a box drag, the element is moved and resized so nothing already drawn moves
 * on the slide. Hidden while a box is typed in.
 */
export function DiagramBoxButtons({ slideId, element }: { slideId: string; element: SvgElement }) {
  const updateElement = useEditorStore((s) => s.updateElement);
  const isTyping = useEditorStore((s) => s.editingDiagramBox?.elementId === element.id);
  const isPicked = useEditorStore((s) => s.pickedDiagramBox?.elementId === element.id);
  const setPickedDiagramBox = useEditorStore((s) => s.setPickedDiagramBox);

  const diagram = getDiagramBoxes(element.assetId, element);
  const asset = getElementAsset(element.assetId);
  if (!diagram || !asset || isTyping) return null;
  const viewBox = getAssetViewBox(asset, element);
  const frame = getFrame(element, viewBox);

  // One change with the new boxes and the element's new place, so one undo puts both back.
  const apply = (settings: DiagramBoxes["settings"], isRemove: boolean) => {
    const patch = { [diagram.key]: settings } as Partial<SvgElement>;
    updateElement(slideId, element.id, { ...patch, ...keepInPlace(element, viewBox, getAssetViewBox(asset, patch)) });
    // The boxes shift after a remove, so a picked box would point at the wrong one: let go of it.
    if (isRemove && isPicked) setPickedDiagramBox(null);
  };

  return (
    <>
      {diagram.boxes.map((box) => {
        const actions = diagramBoxActions(diagram, box);
        const px = boxToPx(box, frame, element);
        const middleX = px.left + px.width / 2;
        const middleY = px.top + px.height / 2;
        const spot: Record<DiagramEdge, { left: number; top: number }> = {
          left: { left: px.left - PLUS_OUT, top: middleY },
          right: { left: px.left + px.width + PLUS_OUT, top: middleY },
          top: { left: middleX, top: px.top - PLUS_OUT },
          bottom: { left: middleX, top: px.top + px.height + PLUS_OUT },
        };
        return (
          <div key={box.path.join(".")}>
            {actions.adds.map((add) => (
              <button
                key={add.title + add.edge}
                type="button"
                title={add.title}
                aria-label={add.title}
                onPointerDown={stop}
                onDoubleClick={stop}
                onClick={(e) => {
                  e.stopPropagation();
                  apply(add.settings, false);
                }}
                className="pointer-events-auto absolute flex h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-white hover:bg-accent-hover"
                style={spot[screenEdge(add.edge, element)]}
              >
                <PlusIcon size={12} />
              </button>
            ))}
            {actions.remove && (
              <button
                type="button"
                title={actions.remove.title}
                aria-label={actions.remove.title}
                onPointerDown={stop}
                onDoubleClick={stop}
                onClick={(e) => {
                  e.stopPropagation();
                  if (actions.remove) apply(actions.remove.settings, true);
                }}
                className="pointer-events-auto absolute flex h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border-default bg-bg-surface text-text-secondary hover:bg-danger-soft hover:text-danger-strong"
                style={{ left: px.left + px.width + REMOVE_OUT, top: px.top - REMOVE_OUT }}
              >
                <XIcon size={12} />
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}
```

- [ ] **Step 3: Render it** in `SvgElementItem.tsx`. Import `{ DiagramBoxButtons } from "./DiagramBoxButtons"`, and right after the `DiagramBoxEditor` block add (after it, so the buttons sit on top of the picked box's outline):

```tsx
      {/* "+" and × on every box of the selected diagram. */}
      {showSelection && isOnlySelected && !isCropping && <DiagramBoxButtons slideId={slideId} element={element} />}
```

- [ ] **Step 4: Check**

Run: `npx tsc --noEmit` — Expected: exit 0.
Run: `npx eslint src/components/editor/DiagramBoxEditor.tsx src/components/editor/DiagramBoxButtons.tsx src/components/editor/SvgElementItem.tsx` — Expected: exit 0.

---

### Task 4: Docs and the final check

**Files:**
- Modify: `CLAUDE.md` ("# Diagrams")
- Modify: `docs/superpowers/specs/2026-10-06-diagram-box-drag-design.md` ("What the teacher does", "Saved data", "History")
- Modify: `docs/superpowers/specs/2026-10-07-diagram-box-add-remove-design.md` ("Look and feel": the plan rulings)

- [ ] **Step 1: `CLAUDE.md`.** In "# Diagrams", change the "A box's own look" bullet's field list to `` (`fill`, `border`, `borderWidth`, `textColor`, `fontSize`) `` and add a bullet after it:

```md
- **"+" and × on every box** of a selected diagram (`DiagramBoxButtons.tsx`) add a box next to it or remove it. The rules per diagram (where, limits, new text, copying the look) live only in `diagramBoxActions` (`svgLibrary.tsx`); the element is kept in place with `keepInPlace`. Spec: `docs/superpowers/specs/2026-10-07-diagram-box-add-remove-design.md`.
```

and in the "The panels have no text boxes" bullet, nothing changes (the panel's count slider and Tree list stay).

- [ ] **Step 2: Older spec.** In "What the teacher does" add the bullet
`- **"+" / ×** on every box (diagram selected): add a box next to it, or remove it.`
In "Saved data" add `borderWidth?` after `border?`. In "History" add
`6. "+" / × on every box, and box border width (spec: 2026-10-07-diagram-box-add-remove-design.md).`

- [ ] **Step 3: This spec.** In "Look and feel", replace "an 18px (on screen, any zoom)" with "an 18px (grows and shrinks with zoom, like the handles)", and replace "Hidden while a box is being **dragged** or **typed in**." with "Hidden while a box is **typed in**; while a box is dragged they follow it. "+" sits 16px past the edge's middle and × 12px out from the top-right corner, so they never cover the picked box's handles." Under "× buttons", replace the last bullet with: "After any remove, a picked box of that diagram is let go of (the boxes shift, so it would point at the wrong one)."

- [ ] **Step 4: Final check**

Run: `npx tsc --noEmit` — Expected: exit 0.
Run: `npx eslint` on every changed source file — Expected: exit 0.
Run: `git diff` on the changed files and read it next to this plan and the spec: every task done, nothing extra, zod checks `borderWidth`, design-system classes only, Lucide icons with `size`.

- [ ] **Step 5: Report** to the user: what was checked and passed/failed, the plan rulings above, and the live checks (Review Focus items 1–5, plus: add/remove in each of the four diagrams; Undo after each; add next to a styled box and see the look copied; add to a diagram inside a question box).
