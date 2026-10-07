# Factor Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 5th diagram, the Factor Tree. When a box moves, every box under it moves too. Also add a Circle / Rounded box shape to every diagram.

**Architecture:** Everything stays in the existing diagram system. Layouts, drawing, "+"/× rules and the new `moveDiagramBox` live in `src/lib/svgLibrary.tsx`. Data is checked by zod in `src/lib/schema.ts`. The editor (`DiagramBoxEditor.tsx`) asks `moveDiagramBox` for the new settings on a move drag. A child's automatic spot is measured from its parent's drawn box, so children in their automatic spot follow their parent for free. Children placed by hand get the same move added during the drag.

**Tech Stack:** Next.js 16, React 19, TypeScript, zod 4 (`z.lazy` for the nested tree), lucide-react icons. No new packages.

**Spec:** `docs/superpowers/specs/2026-10-07-factor-tree-design.md`. Read it first, together with `docs/superpowers/specs/2026-10-06-diagram-box-drag-design.md` (how the diagrams work today).

## Global Constraints

- Validate with zod before saving: every new saved field (`shape`, `factorTree`) goes into `svgElementSchema` in `src/lib/schema.ts`, with its limits from `src/lib/constants.ts`.
- Use the design system: Tailwind tokens only (`text-text-primary`, `hover:bg-bg-page`, `rounded-dropdown`, …), and Lucide icons with `size`. No hand-drawn UI icons and no hard-coded UI colors. (Slide drawing colors are the teacher's own work and are exempt.)
- One layout for both drawing and editor: `factorTreeLayout` places every box; `getDiagramBoxes` returns those same boxes. Never place boxes a second way.
- `boxes` lists every parent before its children. `withDiagramBoxStyle` and `moveDiagramBox` rely on this order.
- Limits: `FACTOR_TREE_LEVELS = 8`, `FACTOR_TREE_BOXES = 31`. Automatic box `{ width: 44, height: 34 }`, gap between the two sides 12, gap from a parent's bottom to its children's tops 22.
- Missing `shape` = circle for the Factor Tree and rounded for the other four, so diagrams already made don't change.
- No new packages. Code stays simple and matches the comment style of the files around it.
- **Do not commit.** `svgLibrary.tsx`, `schema.ts`, `constants.ts`, `DiagramBoxEditor.tsx`, `SelectedElementToolbar.tsx`, `MathToolPanels.tsx`, `importPresentation.ts` and `CLAUDE.md` already hold the user's uncommitted diagram work, and a commit would sweep it in. Leave every change unstaged and tell the user at the end.
- The project has no test runner, and the user does all live testing in the browser. Each task is checked with `npx tsc --noEmit`, `npm run lint`, and a throwaway check script in the scratchpad (never added to the repo).

## Review Focus

1. A box placed by hand under a dragged parent moves by exactly the same amount, and boxes on the other side of the tree don't move. Check script, Task 3.
2. Changing the style of all boxes (nothing picked) keeps every split. A parent written after its children would wipe them out. Check script, Task 2.
3. "+" disappears at 31 boxes or at 8 levels, and saved data with more is refused by zod. Check script, Task 2.
4. Diagrams already made, with no `shape` saved, still draw rounded boxes with the same text room and arrows. Check script, Task 1.
5. Tidy up on the Factor Tree keeps every number's text, look and splits, and only clears `x, y, width, height`. Check script, Task 2.

## Check-script setup (used by every task)

The repo's `tsconfig.json` keeps JSX as is (`"jsx": "preserve"`), so `tsx` needs its own config for the scratch scripts. Create it once:

File: `C:\Users\ACER\AppData\Local\Temp\claude\c--Users-ACER-Documents-Personal-Projects-quizBuilder\7f0b05d6-964f-4d18-b4e1-e88070b15ce8\scratchpad\tsconfig.json`

```json
{
  "extends": "C:/Users/ACER/Documents/Personal Projects/quizBuilder/tsconfig.json",
  "compilerOptions": { "jsx": "react-jsx" }
}
```

Run a check like this (`SCRATCH` = the scratchpad folder above):

```bash
npx -y tsx --tsconfig "$SCRATCH/tsconfig.json" "$SCRATCH/check-task1.ts"
```

The scripts import the repo files by absolute path (`C:/Users/ACER/Documents/Personal Projects/quizBuilder/src/lib/svgLibrary.tsx`). If `tsx` can't load a file, read the error and fix the import path in the script. Don't change repo files to suit the script.

---

### Task 1: Box shape (Circle / Rounded) for every diagram

**Files:**
- Modify: `src/lib/constants.ts` (after `DIAGRAM_BORDER_WIDTH`, ~line 95)
- Modify: `src/lib/schema.ts:166-194` (`diagramBoxSchema`)
- Modify: `src/lib/svgLibrary.tsx` (diagram section, ~lines 540-1110: `PlacedDiagramBox`, `placeBox`, `fitDiagramText`, `DiagramBox`, `boxEdge`, `DiagramBoxStyle`, `diagramBoxLook`)
- Modify: `src/components/editor/DiagramBoxEditor.tsx` (typing area side padding)
- Modify: `src/components/editor/SelectedElementToolbar.tsx:262-296` (box style group)
- Test: `$SCRATCH/check-task1.ts` (throwaway)

**Interfaces:**
- Produces: `DIAGRAM_SHAPES`, `type DiagramShape` (constants); `shape?: DiagramShape` on every diagram box; `PlacedDiagramBox.shape: DiagramShape` (always set); `placeBox(item, path, center, auto, defaultShape = "rounded")`; `export function diagramTextRoom(box: PlacedDiagramBox): { width: number; height: number }`; `"shape"` in `DiagramBoxStyle` and in `diagramBoxLook`.

- [ ] **Step 1: Write the check script (fails now)**

`$SCRATCH/check-task1.ts`:

```ts
import assert from "node:assert/strict";
import { getDiagramBoxes, diagramTextRoom, fitDiagramText } from "C:/Users/ACER/Documents/Personal Projects/quizBuilder/src/lib/svgLibrary.tsx";
import { svgElementSchema } from "C:/Users/ACER/Documents/Personal Projects/quizBuilder/src/lib/schema.ts";

// Existing diagrams with no shape saved stay rounded, with the old text room (box minus padding 4/3).
const cycle = getDiagramBoxes("cycle", {})!;
assert.equal(cycle.boxes[0].shape, "rounded");
assert.deepEqual(diagramTextRoom(cycle.boxes[0]), { width: 64 - 8, height: 36 - 6 });

// A circle's text room is the inner rectangle of the oval (÷ √2) minus padding.
const round = getDiagramBoxes("cycle", { cycle: { steps: [{ text: "A", shape: "circle" }, { text: "B" }, { text: "C" }] } })!;
assert.equal(round.boxes[0].shape, "circle");
const room = diagramTextRoom(round.boxes[0]);
assert.ok(Math.abs(room.width - (64 * Math.SQRT1_2 - 8)) < 1e-9);
assert.ok(fitDiagramText(round.boxes[0], false).fontSize > 0);

// zod takes "rounded" / "circle" and refuses anything else.
// If this first check fails, the plain element is missing a required field or uses a wrong id/color
// format: fix `base` (see svgElementSchema), not the app code.
const base = { id: "e1", assetId: "cycle", x: 0, y: 0, width: 10, height: 10, color: "#000000", containerId: null };
assert.ok(svgElementSchema.safeParse(base).success, "fix the base element in this script");
assert.ok(svgElementSchema.safeParse({ ...base, cycle: { steps: [{ text: "A", shape: "circle" }, { text: "B" }, { text: "C" }] } }).success);
assert.ok(!svgElementSchema.safeParse({ ...base, cycle: { steps: [{ text: "A", shape: "star" }, { text: "B" }, { text: "C" }] } }).success);
console.log("task 1 ok");
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx -y tsx --tsconfig "$SCRATCH/tsconfig.json" "$SCRATCH/check-task1.ts"`
Expected: FAIL (`diagramTextRoom` is not exported / `shape` is undefined).

- [ ] **Step 3: Add the shape list to `constants.ts`**

After `export const DIAGRAM_BORDER_WIDTH = …`:

```ts
// A diagram box's shape: a rounded box, or a circle (an oval filling the box). Missing = the diagram's
// own default: circle for the Factor Tree, rounded for the others.
export const DIAGRAM_SHAPES = ["rounded", "circle"] as const;
export type DiagramShape = (typeof DIAGRAM_SHAPES)[number];
```

- [ ] **Step 4: Add `shape` to `diagramBoxSchema` in `schema.ts`**

Add `DIAGRAM_SHAPES` to the constants import. In the box object, after `fontSize: …`:

```ts
    shape: z.enum(DIAGRAM_SHAPES).optional(),
```

Update the comment above the schema: "Its own look is optional too: background and border …, text size, and shape (rounded box or circle). Missing = …, the diagram's own shape."

- [ ] **Step 5: Give each placed box its shape (`svgLibrary.tsx`)**

Add `type DiagramShape` to the import from `./constants`.

In `PlacedDiagramBox` add:

```ts
  // Its shape: the box's own, else the diagram's default.
  shape: DiagramShape;
```

Replace `placeBox` with:

```ts
function placeBox(
  item: DiagramBoxItem,
  path: DiagramBoxPath,
  center: { x: number; y: number },
  auto: DiagramSize,
  defaultShape: DiagramShape = "rounded",
): PlacedDiagramBox {
  const shape = item.shape ?? defaultShape;
  if (item.x !== undefined && item.y !== undefined && item.width !== undefined && item.height !== undefined) {
    return { x: item.x, y: item.y, width: item.width, height: item.height, shape, item, path };
  }
  return { x: center.x - auto.width / 2, y: center.y - auto.height / 2, ...auto, shape, item, path };
}
```

- [ ] **Step 6: Text room depends on the shape**

Add above `fitDiagramText`:

```ts
// Where a box's text goes: the box minus padding, or for a circle the biggest rectangle inside the oval
// (the box's width and height ÷ √2) minus padding. The typing area on the slide uses the same room.
export function diagramTextRoom(box: PlacedDiagramBox) {
  const inner = box.shape === "circle" ? Math.SQRT1_2 : 1;
  return {
    width: box.width * inner - DIAGRAM_TEXT_PADDING.x * 2,
    height: box.height * inner - DIAGRAM_TEXT_PADDING.y * 2,
  };
}
```

In `fitDiagramText`, replace the `const room = { … };` line with `const room = diagramTextRoom(box);`.

- [ ] **Step 7: Draw circles in `DiagramBox`**

Add above `DiagramBox`:

```tsx
// A box's outline in `paint`: a rounded rectangle, or an oval filling the box.
function boxOutline(box: PlacedDiagramBox, paint: { fill: string; fillOpacity?: number; stroke?: string; strokeWidth?: number }) {
  const { x, y, width, height } = box;
  return box.shape === "circle" ? (
    <ellipse cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} {...paint} />
  ) : (
    <rect x={x} y={y} width={width} height={height} rx="8" {...paint} />
  );
}
```

In `DiagramBox`, delete `const { x, y, width, height } = box;` and replace the background and border JSX with:

```tsx
      {/* Background: the box's own color, none, or (unset) white with a tint of the element color. */}
      {fill === undefined ? (
        <>
          {boxOutline(box, { fill: "#FFFFFF" })}
          {boxOutline(box, { fill: color, fillOpacity: strong ? 0.5 : 0.2 })}
        </>
      ) : (
        fill !== DIAGRAM_NONE && boxOutline(box, { fill })
      )}
      {border !== DIAGRAM_NONE &&
        boxOutline(box, { fill: "none", stroke: border ?? color, strokeWidth: borderWidth ?? DIAGRAM_BORDER_WIDTH.default })}
```

Update the comment at the top of the Diagrams section ("Rounded boxes …") to "Rounded boxes or circles …".

- [ ] **Step 8: Lines and arrows stop at the oval's edge (`boxEdge`)**

Replace the `const t = …` line in `boxEdge` with:

```ts
  // How far from the middle the edge is: for an oval with half-sizes a, b it's 1 / √((ux/a)² + (uy/b)²).
  const edge =
    box.shape === "circle"
      ? 1 / Math.hypot(ux / (box.width / 2), uy / (box.height / 2))
      : Math.min(ux ? box.width / 2 / Math.abs(ux) : Infinity, uy ? box.height / 2 / Math.abs(uy) : Infinity);
  const t = edge + gap;
```

- [ ] **Step 9: Shape is a box style (copied by "+", set by the toolbar)**

```ts
export type DiagramBoxStyle = Partial<Pick<DiagramBoxItem, "fill" | "border" | "borderWidth" | "textColor" | "fontSize" | "shape">>;

export function diagramBoxLook(box: DiagramBoxItem | undefined): DiagramBoxStyle {
  return {
    fill: box?.fill,
    border: box?.border,
    borderWidth: box?.borderWidth,
    textColor: box?.textColor,
    fontSize: box?.fontSize,
    shape: box?.shape,
  };
}
```

- [ ] **Step 10: Typing area uses the shape's text room (`DiagramBoxEditor.tsx`)**

Import `diagramTextRoom` from `@/lib/svgLibrary`, and remove `DIAGRAM_TEXT_PADDING` from that import if nothing else uses it. In the `<DiagramTextArea …>` props:

```tsx
          sidePaddingPx={((box.width - diagramTextRoom(box).width) / 2) * frame.scale}
```

- [ ] **Step 11: Shape button in the toolbar (`SelectedElementToolbar.tsx`)**

Add `CircleIcon, SquareIcon` to the lucide import. Next to `const firstBox = styleTargets[0]?.item;` add:

```ts
  const boxShape = styleTargets[0]?.shape;
```

Right after the `<FontSizePicker … />` in the box style group:

```tsx
          <button
            type="button"
            title={boxShape === "circle" ? "Box shape: circle (click for rounded)" : "Box shape: rounded (click for circle)"}
            onClick={() => setBoxStyle({ shape: boxShape === "circle" ? "rounded" : "circle" })}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
          >
            {boxShape === "circle" ? <CircleIcon size={16} /> : <SquareIcon size={16} />}
          </button>
```

- [ ] **Step 12: Run the check script, tsc and lint**

Run: `npx -y tsx --tsconfig "$SCRATCH/tsconfig.json" "$SCRATCH/check-task1.ts"` → Expected: `task 1 ok`
Run: `npx tsc --noEmit` → Expected: no errors
Run: `npm run lint` → Expected: no errors in the changed files

---

### Task 2: Factor Tree data, layout, drawing, "+"/× and panel

**Files:**
- Modify: `src/lib/constants.ts` (after `TREE_LEAVES_MAX`)
- Modify: `src/lib/schema.ts` (`diagramBoxSchema` split, `FactorNode`, `factorTreeSize`, `factorTree` field after `tree`)
- Modify: `src/lib/svgLibrary.tsx` (`RenderSettings`, `mathTool` union, `DiagramKey`, the factor tree layout and render after `renderTree`, `DiagramBoxes`, `getDiagramBoxes`, `diagramBoxActions`, the `factor-tree` asset after `tree-diagram`)
- Modify: `src/components/editor/MathToolPanels.tsx` (switch at ~line 104, `FactorTreeControls` after `TreeControls`)
- Test: `$SCRATCH/check-task2.ts` (throwaway)

**Interfaces:**
- Consumes (Task 1): `placeBox(…, defaultShape)`, `PlacedDiagramBox.shape`, `diagramBoxLook` (with `shape`), `boxEdge`.
- Produces: `FACTOR_TREE_LEVELS`, `FACTOR_TREE_BOXES` (constants); `export type FactorNode`, `export function factorTreeSize(node: Splits): { boxes: number; levels: number }` (schema.ts); `SvgElement["factorTree"]`; `type FactorTreeSettings`, `DEFAULT_FACTOR_TREE`, `getFactorTreeViewBox(settings?)`, `DiagramKey` including `"factorTree"`, `getDiagramBoxes` case `"factorTree"` (svgLibrary.tsx). Asset id `factor-tree`, `mathTool: "factorTree"`. Box paths: `["root"]`, `["root", "children", 0]`, …

- [ ] **Step 1: Write the check script (fails now)**

`$SCRATCH/check-task2.ts`:

```ts
import assert from "node:assert/strict";
import {
  DEFAULT_FACTOR_TREE,
  diagramBoxActions,
  getDiagramBoxes,
  withDiagramBoxStyle,
  type FactorTreeSettings,
} from "C:/Users/ACER/Documents/Personal Projects/quizBuilder/src/lib/svgLibrary.tsx";
import { factorTreeSize, svgElementSchema, type FactorNode } from "C:/Users/ACER/Documents/Personal Projects/quizBuilder/src/lib/schema.ts";

const tree = getDiagramBoxes("factor-tree", {})!;
assert.equal(tree.key, "factorTree");
// 48, 6, 2, 3, 8, 2, 4, 2, 2: parents before children.
assert.deepEqual(tree.boxes.map((b) => b.item.text), ["48", "6", "2", "3", "8", "2", "4", "2", "2"]);
assert.ok(tree.boxes.every((b) => b.shape === "circle"));
// No two boxes overlap.
for (const a of tree.boxes) for (const b of tree.boxes) {
  if (a === b) continue;
  const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
  assert.ok(apart, `${a.path.join(".")} overlaps ${b.path.join(".")}`);
}

// Style for all boxes keeps every split (Review Focus 2).
const styled = withDiagramBoxStyle(tree, tree.boxes, { fill: "#FF0000" }).factorTree!;
assert.equal(factorTreeSize(styled.root).boxes, 9);
assert.equal(styled.root.children![1].children![1].children![0].fill, "#FF0000");

// "+" on a prime splits it into ? and ?; × removes the pair.
const three = tree.boxes.find((b) => b.path.join(".") === "root.children.0.children.1")!;
const actions = diagramBoxActions(tree, three);
const split = actions.adds[0].settings as FactorTreeSettings;
assert.deepEqual(split.root.children![0].children![1].children!.map((c) => c.text), ["?", "?"]);
assert.equal((actions.remove!.settings as FactorTreeSettings).root.children![0].children, undefined);
assert.equal(diagramBoxActions(tree, tree.boxes[0]).remove, null);

// "+" hides at the level limit (Review Focus 3): a chain 8 levels deep.
let deep: FactorNode = { text: "2" };
for (let i = 0; i < 7; i++) deep = { text: "x", children: [{ text: "2" }, deep] };
const deepTree = getDiagramBoxes("factor-tree", { factorTree: { root: deep } })!;
const bottom = deepTree.boxes.at(-1)!;
assert.equal(bottom.path.length, 15); // level 8
assert.equal(diagramBoxActions(deepTree, bottom).adds.length, 0);

// zod: 2 children only; at most 8 levels and 31 boxes.
const base = { id: "e1", assetId: "factor-tree", x: 0, y: 0, width: 10, height: 10, color: "#000000", containerId: null };
assert.ok(svgElementSchema.safeParse(base).success, "fix the base element in this script (same as task 1)");
assert.ok(svgElementSchema.safeParse({ ...base, factorTree: DEFAULT_FACTOR_TREE }).success);
assert.ok(svgElementSchema.safeParse({ ...base, factorTree: { root: deep } }).success);
assert.ok(!svgElementSchema.safeParse({ ...base, factorTree: { root: { text: "9", children: [deep, { text: "1" }] } } }).success);
assert.ok(!svgElementSchema.safeParse({ ...base, factorTree: { root: { text: "6", children: [{ text: "2" }] } } }).success);
assert.ok(!svgElementSchema.safeParse({ ...base, factorTree: { root: { text: "6", x: 1 } } }).success);
console.log("task 2 ok");
```

(The Tidy-up check for Review Focus 5 is a small function inside the panel component, so it's checked by reading the code in Step 9 and by the user in the browser.)

- [ ] **Step 2: Run it and see it fail**

Run: `npx -y tsx --tsconfig "$SCRATCH/tsconfig.json" "$SCRATCH/check-task2.ts"`
Expected: FAIL (`DEFAULT_FACTOR_TREE` / `factorTreeSize` not exported).

- [ ] **Step 3: Limits in `constants.ts`**

After `TREE_LEAVES_MAX`:

```ts
// Factor Tree: each number splits into exactly 2 or none; at most this many levels (the top box = 1)
// and boxes in all. 2⁶ = 64 broken down fully is 7 levels and 13 boxes.
export const FACTOR_TREE_LEVELS = 8;
export const FACTOR_TREE_BOXES = 31;
```

Update the comment "Limits for the Diagrams (flowchart, cycle, mind map, tree)" to include the factor tree.

- [ ] **Step 4: Nested zod schema in `schema.ts`**

Add `FACTOR_TREE_BOXES, FACTOR_TREE_LEVELS` to the constants import. Replace `const diagramBoxSchema = z.object({…}).refine(…)` with the same fields split from the rule, so the factor tree can add `children` (zod 4 can't `.extend` a refined object):

```ts
const diagramBoxFields = z.object({
  // …the same fields as before, including shape…
});

// A box's place and size are saved together or not at all.
const placeSavedTogether = (box: { x?: number; y?: number; width?: number; height?: number }) =>
  [box.x, box.y, box.width, box.height].every((value) => value === undefined) ||
  [box.x, box.y, box.width, box.height].every((value) => value !== undefined);
const PLACE_MESSAGE = "A diagram box's place and size are saved together.";

const diagramBoxSchema = diagramBoxFields.refine(placeSavedTogether, PLACE_MESSAGE);

// One number of a factor tree: a diagram box, and the two numbers it splits into (missing = none).
export type FactorNode = z.infer<typeof diagramBoxFields> & { children?: [FactorNode, FactorNode] };
const factorNodeSchema: z.ZodType<FactorNode> = z.lazy(() =>
  diagramBoxFields
    .extend({ children: z.tuple([factorNodeSchema, factorNodeSchema]).optional() })
    .refine(placeSavedTogether, PLACE_MESSAGE),
);

// Anything shaped like a factor tree (the app's or Claude's).
interface Splits {
  children?: [Splits, Splits];
}

/** How many boxes a factor tree has, and how many levels deep it goes (the top box alone = 1). */
export function factorTreeSize(node: Splits): { boxes: number; levels: number } {
  if (!node.children) return { boxes: 1, levels: 1 };
  const a = factorTreeSize(node.children[0]);
  const b = factorTreeSize(node.children[1]);
  return { boxes: 1 + a.boxes + b.boxes, levels: 1 + Math.max(a.levels, b.levels) };
}

// A factor tree within its limits (levels and boxes). Claude's import checks the same.
export const factorTreeFits = ({ root }: { root: Splits }) => {
  const { boxes, levels } = factorTreeSize(root);
  return boxes <= FACTOR_TREE_BOXES && levels <= FACTOR_TREE_LEVELS;
};
export const FACTOR_TREE_LIMIT_MESSAGE = `A factor tree has at most ${FACTOR_TREE_LEVELS} levels and ${FACTOR_TREE_BOXES} boxes.`;
```

In `svgElementSchema`, after `tree: …optional(),`:

```ts
  // Only used by the factor tree: the top number; each number splits into two (children) or none.
  factorTree: z.object({ root: factorNodeSchema }).refine(factorTreeFits, FACTOR_TREE_LIMIT_MESSAGE).optional(),
```

(Task 4 imports `factorTreeFits` and `FACTOR_TREE_LIMIT_MESSAGE`.)

- [ ] **Step 5: Register the diagram in `svgLibrary.tsx`**

- Change the schema import to `import { factorTreeSize, type FactorNode, type SvgElement } from "./schema";`.
- Add `FACTOR_TREE_BOXES, FACTOR_TREE_LEVELS` to the constants import.
- `RenderSettings` Pick: add `| "factorTree"` after `| "tree"`.
- `mathTool` union: add `| "factorTree"`, and change the comment to "The Diagrams (flowchart, cycle, mind map, tree, factor tree) …".
- `export type DiagramKey = "flowchart" | "cycle" | "mindMap" | "tree" | "factorTree";`
- `DiagramBoxes.settings`: add `| FactorTreeSettings`.

- [ ] **Step 6: Layout and drawing (after `renderTree`)**

```tsx
export type FactorTreeSettings = NonNullable<SvgElement["factorTree"]>;
export const DEFAULT_FACTOR_TREE: FactorTreeSettings = {
  root: {
    text: "48",
    children: [
      { text: "6", children: [{ text: "2" }, { text: "3" }] },
      { text: "8", children: [{ text: "2" }, { text: "4", children: [{ text: "2" }, { text: "2" }] }] },
    ],
  },
};
const FACTOR_BOX = { width: 44, height: 34 };
const FACTOR_GAP = 12; // between the two sides of a split
const FACTOR_LEVEL_GAP = 22; // from a box's bottom to its children's tops

// How wide a number and everything under it are in the automatic layout.
function factorWidth(node: FactorNode): number {
  const own = node.width ?? FACTOR_BOX.width;
  if (!node.children) return own;
  return Math.max(own, factorWidth(node.children[0]) + FACTOR_GAP + factorWidth(node.children[1]));
}

// Every box (each parent before its children) and each parent–child pair. The top box has a fixed
// automatic spot; a child's automatic spot is just under its parent's drawn box, left or right by half the
// room its side needs. So children in their automatic spot follow their parent when it moves.
function factorTreeLayout({ root }: FactorTreeSettings) {
  const boxes: PlacedDiagramBox[] = [];
  const links: [PlacedDiagramBox, PlacedDiagramBox][] = [];
  const place = (node: FactorNode, path: DiagramBoxPath, center: { x: number; y: number }): PlacedDiagramBox => {
    const box = placeBox(node, path, center, FACTOR_BOX, "circle");
    boxes.push(box);
    if (node.children) {
      const [left, right] = node.children;
      const leftWidth = factorWidth(left);
      const rightWidth = factorWidth(right);
      const middle = boxCenter(box).x;
      const span = leftWidth + FACTOR_GAP + rightWidth;
      const y = box.y + box.height + FACTOR_LEVEL_GAP + FACTOR_BOX.height / 2;
      links.push([box, place(left, [...path, "children", 0], { x: middle - span / 2 + leftWidth / 2, y })]);
      links.push([box, place(right, [...path, "children", 1], { x: middle + span / 2 - rightWidth / 2, y })]);
    }
    return box;
  };
  place(root, ["root"], { x: DIAGRAM_MARGIN + FACTOR_BOX.width / 2, y: DIAGRAM_MARGIN + FACTOR_BOX.height / 2 });
  return { boxes, links };
}

export function getFactorTreeViewBox(settings: FactorTreeSettings = DEFAULT_FACTOR_TREE) {
  return viewBoxAround(factorTreeLayout(settings).boxes);
}

// Lines in the element color from each parent's edge to each child's edge (so they never run behind a
// number, even with no background), then the boxes.
function renderFactorTree(color: string, settings: FactorTreeSettings = DEFAULT_FACTOR_TREE, text: DiagramTextOptions = {}) {
  const { boxes, links } = factorTreeLayout(settings);
  return (
    <>
      {links.map(([parent, child]) => {
        const from = boxEdge(parent, boxCenter(child), 2);
        const to = boxEdge(child, boxCenter(parent), 2);
        return <line key={child.path.join(".")} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={color} strokeWidth="2" />;
      })}
      {boxes.map((box) => (
        <DiagramBox key={box.path.join(".")} box={box} color={color} text={text} />
      ))}
    </>
  );
}
```

The top box sits at a fixed spot, so splitting a number never moves the top box. Its own side spreads out to make room, and `keepInPlace` keeps the top box still on the slide.

- [ ] **Step 7: `getDiagramBoxes` and `diagramBoxActions`**

In `getDiagramBoxes`, after the `tree` case:

```ts
    case "factorTree": {
      const factorTree = settings.factorTree ?? DEFAULT_FACTOR_TREE;
      return { key: "factorTree", settings: factorTree, boxes: factorTreeLayout(factorTree).boxes };
    }
```

In `diagramBoxActions`, after the `tree` case:

```ts
    case "factorTree": {
      const settings = diagram.settings as FactorTreeSettings;
      const node = box.item as FactorNode;
      // The top box is level 1; each split adds ["children", n] to the path.
      const level = (box.path.length + 1) / 2;
      const adds: DiagramBoxAdd[] = [];
      if (!node.children && factorTreeSize(settings.root).boxes + 2 <= FACTOR_TREE_BOXES && level < FACTOR_TREE_LEVELS) {
        const child = { ...look, text: "?" };
        adds.push({
          edge: "bottom",
          title: "Split into two",
          settings: replaceAtPath(settings, box.path, { ...node, children: [child, { ...child }] }),
        });
      }
      if (key === "root") return { adds, remove: null };
      // × takes away this number, its partner and everything under both: the parent has no split again.
      const parentPath = box.path.slice(0, -2);
      const parent = diagram.boxes.find((b) => sameDiagramPath(b.path, parentPath));
      const remove = parent
        ? { title: "Remove this pair", settings: replaceAtPath(settings, parentPath, { ...parent.item, children: undefined }) }
        : null;
      return { adds, remove };
    }
```

Also update the doc comment of `diagramBoxActions` ("A new box goes next to this one …") to say that the factor tree adds a pair under the box.

- [ ] **Step 8: The asset (after `tree-diagram`)**

```tsx
  {
    id: "factor-tree",
    category: "diagram",
    label: "Factor Tree",
    defaultColor: "#22C55E",
    mathTool: "factorTree",
    viewBox: ({ factorTree }) => getFactorTreeViewBox(factorTree),
    defaultSize: diagramDefaultSize(getFactorTreeViewBox()),
    render: (color, { factorTree, editingDiagramBox, fontsReady }) =>
      renderFactorTree(color, factorTree, { editingDiagramBox, fontsReady }),
  },
```

Update the section comment "Diagrams: flowchart, cycle, mind map and tree" to include the factor tree. Check that the editor passes `factorTree` to `render` and `getAssetViewBox`: run `grep -n "mindMap" src/components/editor/*.tsx src/lib/*.ts`. Any place that copies the diagram settings one by one needs `factorTree` added the same way. (The Task 2 exploration found none outside the files listed here.)

- [ ] **Step 9: Settings panel (`MathToolPanels.tsx`)**

In the switch, after `case "tree":`:

```tsx
    case "factorTree":
      return <FactorTreeControls key={element.id} element={element} box={box} update={update} />;
```

Add `DEFAULT_FACTOR_TREE`, `getFactorTreeViewBox`, `type FactorTreeSettings` to the svgLibrary import, `type FactorNode` from `@/lib/schema`, and `GitForkIcon` to the lucide import. After `TreeControls`:

```tsx
function FactorTreeControls({ element, box, update }: { element: SvgElement; box: BoxLayout; update: Update }) {
  const factorTree = element.factorTree ?? DEFAULT_FACTOR_TREE;
  const resize = useResizeForViewBox(element, box);
  const set = (next: FactorTreeSettings) =>
    update({ factorTree: next, ...resize(getFactorTreeViewBox(factorTree), getFactorTreeViewBox(next)) });
  // Every number back in its automatic spot and size, keeping its text, look and split.
  const tidy = (node: FactorNode): FactorNode => ({
    ...autoPlaced(node),
    ...(node.children && { children: [tidy(node.children[0]), tidy(node.children[1])] }),
  });

  return (
    <ToolPanelButton title="Edit factor tree" icon={<GitForkIcon size={16} />} wide>
      <p className="text-xs text-text-secondary">Click a number, then use + to split it or × to remove a pair.</p>
      <DiagramButtons onTidy={() => set({ root: tidy(factorTree.root) })} onReset={() => set(DEFAULT_FACTOR_TREE)} />
    </ToolPanelButton>
  );
}
```

Update the section comment "Diagrams (flowchart, cycle, mind map, tree): how many boxes" to mention the factor tree.

- [ ] **Step 10: Run the check script, tsc and lint**

Run: `npx -y tsx --tsconfig "$SCRATCH/tsconfig.json" "$SCRATCH/check-task2.ts"` → Expected: `task 2 ok`
Run: `npx -y tsx --tsconfig "$SCRATCH/tsconfig.json" "$SCRATCH/check-task1.ts"` → Expected: `task 1 ok`
Run: `npx tsc --noEmit` → Expected: no errors (the `switch` in `diagramBoxActions` must cover `factorTree`)
Run: `npm run lint` → Expected: no errors in the changed files

---

### Task 3: When a box moves, the boxes under it move too

**Files:**
- Modify: `src/lib/svgLibrary.tsx` (new `moveDiagramBox` after `withDiagramBoxStyle`)
- Modify: `src/components/editor/DiagramBoxEditor.tsx` (`drag` ref, `startDrag`, `moveDrag`)
- Test: `$SCRATCH/check-task3.ts` (throwaway)

**Interfaces:**
- Consumes (Task 2): `getDiagramBoxes` for `factor-tree`, box paths, `DIAGRAM_BOX_POSITION_MAX`.
- Produces: `export function moveDiagramBox(diagram: DiagramBoxes, box: PlacedDiagramBox, next: { x: number; y: number; width: number; height: number }): DiagramBoxes["settings"]`.

- [ ] **Step 1: Write the check script (fails now)**

`$SCRATCH/check-task3.ts`:

```ts
import assert from "node:assert/strict";
import {
  getDiagramBoxes,
  moveDiagramBox,
  type FactorTreeSettings,
} from "C:/Users/ACER/Documents/Personal Projects/quizBuilder/src/lib/svgLibrary.tsx";

const at = (settings: object, path: string) =>
  getDiagramBoxes("factor-tree", { factorTree: settings as FactorTreeSettings })!.boxes.find((b) => b.path.join(".") === path)!;

// The "8" box's right child "4" was placed by hand; the "6" side was not.
const start = getDiagramBoxes("factor-tree", {})!;
const four = at(start.settings, "root.children.1.children.1");
const placed = moveDiagramBox(start, four, { x: four.x + 30, y: four.y + 5, width: four.width, height: four.height });
const tree = getDiagramBoxes("factor-tree", { factorTree: placed as FactorTreeSettings })!;

// Drag "8" by (+40, +20).
const eight = at(tree.settings, "root.children.1");
const moved = moveDiagramBox(tree, eight, { x: eight.x + 40, y: eight.y + 20, width: eight.width, height: eight.height });

const before = (path: string) => at(tree.settings, path);
const after = (path: string) => at(moved, path);
for (const path of ["root.children.1", "root.children.1.children.0", "root.children.1.children.1", "root.children.1.children.1.children.0"]) {
  assert.equal(after(path).x - before(path).x, 40, path); // hand-placed "4", its auto children and "2" all follow
  assert.equal(after(path).y - before(path).y, 20, path);
}
for (const path of ["root", "root.children.0", "root.children.0.children.1"]) {
  assert.equal(after(path).x, before(path).x, path); // top box and the other side stay still
  assert.equal(after(path).y, before(path).y, path);
}

// Other diagrams: only the dragged box changes.
const cycle = getDiagramBoxes("cycle", {})!;
const first = cycle.boxes[0];
const cycleMoved = moveDiagramBox(cycle, first, { x: first.x + 10, y: first.y, width: first.width, height: first.height });
assert.deepEqual((cycleMoved as { steps: object[] }).steps.slice(1), (cycle.settings as { steps: object[] }).steps.slice(1));
console.log("task 3 ok");
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx -y tsx --tsconfig "$SCRATCH/tsconfig.json" "$SCRATCH/check-task3.ts"`
Expected: FAIL (`moveDiagramBox` is not exported).

- [ ] **Step 3: `moveDiagramBox` in `svgLibrary.tsx` (after `withDiagramBoxStyle`)**

```ts
/**
 * The diagram's setting with `box` at `next` (its own place and size). In the Factor Tree, every box
 * under it that has its own place moves by the same amount; the ones in their automatic spot follow
 * by themselves (their spot is measured from their parent).
 */
export function moveDiagramBox(
  diagram: DiagramBoxes,
  box: PlacedDiagramBox,
  next: { x: number; y: number; width: number; height: number },
): DiagramBoxes["settings"] {
  let settings = replaceAtPath(diagram.settings, box.path, { ...box.item, ...next });
  if (diagram.key !== "factorTree") return settings;
  const dx = next.x - box.x;
  const dy = next.y - box.y;
  const keep = (value: number) => Math.min(DIAGRAM_BOX_POSITION_MAX, Math.max(-DIAGRAM_BOX_POSITION_MAX, value));
  // Parents come before their children in `boxes`, so each box is written before the boxes under it.
  for (const under of diagram.boxes) {
    const isUnder = under.path.length > box.path.length && sameDiagramPath(box.path, under.path.slice(0, box.path.length));
    if (!isUnder || under.item.x === undefined || under.item.y === undefined) continue;
    settings = replaceAtPath(settings, under.path, { ...under.item, x: keep(under.item.x + dx), y: keep(under.item.y + dy) });
  }
  return settings;
}
```

- [ ] **Step 4: The editor uses it for a move drag (`DiagramBoxEditor.tsx`)**

Import `moveDiagramBox` and `type DiagramBoxes` from `@/lib/svgLibrary`. Keep the diagram and box as they were at pointer-down, so each pointer move applies the whole move once, from the start:

```ts
  // Where the drag started: pointer, the diagram and box then, and what the drag does.
  const drag = useRef<{
    pointerX: number;
    pointerY: number;
    start: UnitBox;
    action: BoxDrag;
    scale: number;
    diagram: DiagramBoxes;
    box: PlacedDiagramBox;
  } | null>(null);
```

In `startDrag`, add `diagram, box,` to the object saved in `drag.current`.

In `moveDrag`, replace the `const settings = replaceAtPath(…)` line (and its comment) with:

```ts
    // From the diagram as it was when the drag started (its setting, or the default when nothing is saved
    // yet). A move also takes the boxes under this one along (Factor Tree).
    const settings =
      state.action.kind === "move"
        ? moveDiagramBox(state.diagram, state.box, next)
        : replaceAtPath(state.diagram.settings, state.box.path, { ...state.box.item, ...next });
```

Update the component's doc comment: "Each drag writes the box's own place and size (and in the Factor Tree moves the boxes under it too); …".

- [ ] **Step 5: Run the checks, tsc and lint**

Run: `npx -y tsx --tsconfig "$SCRATCH/tsconfig.json" "$SCRATCH/check-task3.ts"` → Expected: `task 3 ok`
Run the Task 1 and Task 2 scripts again → Expected: `task 1 ok`, `task 2 ok`
Run: `npx tsc --noEmit` → no errors. Run: `npm run lint` → no errors in the changed files.

---

### Task 4: Claude can add a Factor Tree (JSON import / MCP)

**Files:**
- Modify: `src/lib/importPresentation.ts` (`diagramBox` ~line 140, recipe field after `tree` ~line 261, prompt text ~lines 701-721, `MATH_SETTINGS` ~line 1588, `buildSettings` ~line 1655)
- Test: `$SCRATCH/check-task4.ts` (throwaway)

**Interfaces:**
- Consumes (Task 2): `factorTreeFits`, `FACTOR_TREE_LIMIT_MESSAGE` from `./schema`; `FACTOR_TREE_LEVELS`, `FACTOR_TREE_BOXES` from `./constants`.
- Produces: the `factorTree` recipe field on `factor-tree` elements.

- [ ] **Step 1: Write the check script (fails now)**

`$SCRATCH/check-task4.ts`:

```ts
import assert from "node:assert/strict";
import { getClaudeFormat } from "C:/Users/ACER/Documents/Personal Projects/quizBuilder/src/lib/importPresentation.ts";

const format = getClaudeFormat(); // throws if the nested schema can't become JSON Schema
assert.ok(format.includes("factorTree"));
assert.ok(format.includes("Only for factor-tree"));
assert.ok(format.includes('"factor-tree"'));
console.log("task 4 ok");
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx -y tsx --tsconfig "$SCRATCH/tsconfig.json" "$SCRATCH/check-task4.ts"`
Expected: FAIL on `format.includes("factorTree")`.

- [ ] **Step 3: The recipe field**

Add `FACTOR_TREE_BOXES, FACTOR_TREE_LEVELS` to the constants import, and `factorTreeFits, FACTOR_TREE_LIMIT_MESSAGE` to the `./schema` import (add the import if the file only imports types from it). After `const diagramBox = …`:

```ts
// One number of Claude's factor tree: its text, and the two numbers it splits into (left out for a prime).
type ClaudeFactorNode = { text: string; children?: [ClaudeFactorNode, ClaudeFactorNode] };
const claudeFactorNode: z.ZodType<ClaudeFactorNode> = z.lazy(() =>
  z.object({
    text: z.string().max(DIAGRAM_TEXT_MAX),
    children: z
      .tuple([claudeFactorNode, claudeFactorNode])
      .optional()
      .describe("The two numbers it splits into. Leave out when it doesn't split (a prime)."),
  }),
);
```

After the `tree: …describe("Only for tree-diagram."),` field:

```ts
  factorTree: z
    .object({
      root: claudeFactorNode.describe(
        'The top number, e.g. { "text": "12", "children": [{ "text": "3" }, { "text": "4", "children": [{ "text": "2" }, { "text": "2" }] }] }.',
      ),
    })
    .refine(factorTreeFits, FACTOR_TREE_LIMIT_MESSAGE)
    .optional()
    .describe(`Only for factor-tree. At most ${FACTOR_TREE_LEVELS} levels and ${FACTOR_TREE_BOXES} numbers.`),
```

- [ ] **Step 4: Settings and prompt text**

- `MATH_SETTINGS`: add `"factorTree",` after `"tree",`.
- `buildSettings`: after `if (el.tree) settings.tree = el.tree;` add `if (el.factorTree) settings.factorTree = el.factorTree;`.
- Line ~701: add `"factorTree"` to the list of settings that only work on their own pictures (`… "mindMap", "tree" and "factorTree" …`).
- Line ~702: after "… e.g. a classification)", add `and factor-tree (a number split into two factors, each split again until only primes are left, for prime factorization)`.
- Line ~721: `"flowchart", "cycle", "mind-map", "tree-diagram" and "factor-tree"`.

- [ ] **Step 5: Run the checks, tsc and lint**

Run: `npx -y tsx --tsconfig "$SCRATCH/tsconfig.json" "$SCRATCH/check-task4.ts"` → Expected: `task 4 ok`
Run: `npx tsc --noEmit` → no errors. Run: `npm run lint` → no errors in the changed files.

---

### Task 5: Docs and the final check

**Files:**
- Modify: `docs/superpowers/specs/2026-10-06-diagram-box-drag-design.md`
- Modify: `CLAUDE.md` ("# Diagrams (Flowchart, Cycle, Mind Map, Tree)" section)
- Modify: `docs/superpowers/specs/2026-10-07-factor-tree-design.md` (one line in "Dragging")

- [ ] **Step 1: The diagram doc**

In `2026-10-06-diagram-box-drag-design.md`:
- Title and first line: five pictures, including the Factor Tree.
- Table: add `| Factor Tree | factor-tree | factorTree | a top box; each box splits into exactly 2 or none; up to 8 levels and 31 boxes; circles joined by lines edge to edge |`.
- "What the teacher does": "Drag the box itself: move it. … In the Factor Tree, every box under it moves with it." Under "+" / ×, add: "Factor Tree: + = Split into two, × = Remove this pair."
- "Saved data": add `shape?` to the box fields and `children?` (Factor Tree only), and the limits.
- "Settings panel": "Factor Tree: only Tidy up and Reset."
- "Where the code lives": `factorTreeLayout`, `moveDiagramBox`, `diagramTextRoom`.
- "History": "7. Factor Tree, and box shape (circle / rounded) for every diagram (spec: `2026-10-07-factor-tree-design.md`)."
- "Known gaps": "Factor Tree: splitting a number widens its side, so the boxes beside it spread apart (the top box stays still)."

- [ ] **Step 2: CLAUDE.md**

Rename the section heading to `# Diagrams (Flowchart, Cycle, Mind Map, Tree, Factor Tree)` and add these bullets:

```markdown
- **Factor Tree: children move with their parent.** A child's automatic spot is measured from its parent's drawn box, and `moveDiagramBox` adds a dragged box's move to every box under it that has its own place. Keep `boxes` parents-first: `moveDiagramBox` and `withDiagramBoxStyle` rely on it. Spec: `docs/superpowers/specs/2026-10-07-factor-tree-design.md`.
- **Box shape:** `shape` (`rounded` / `circle`) is a box style like the others; missing = circle for the Factor Tree, rounded for the rest. Text room and line ends follow the shape (`diagramTextRoom`, `boxEdge`).
```

In the "Claude" bullet, add the factor tree: `{ "text": … , "children"?: [two nodes] }`.

- [ ] **Step 3: Spec wording**

In `2026-10-07-factor-tree-design.md`, "Dragging", the editor bullet should say the drag keeps the diagram and box from pointer-down (`state.diagram`, `state.box`) and passes them to `moveDiagramBox`. That is what Task 3 built.

- [ ] **Step 4: Final check (CLAUDE.md checking step)**

Run: `npx tsc --noEmit` → no errors
Run: `npm run lint` → no errors in the changed files
Run all four check scripts → `task 1 ok` … `task 4 ok`
Run: `git diff` and read it next to the spec. Confirm that every spec part is built and nothing extra was added: zod before saving, design system tokens and Lucide icons, no new packages, one layout, no commits.

- [ ] **Step 5: Tell the user**

Report what was checked and what passed. Say that nothing was committed, because these files also hold their earlier uncommitted diagram work. List what to try in the browser:
1. Add a Factor Tree: 48 → 6, 8 → 2, 3, 2, 4 → 2, 2, all circles.
2. Drag 8: 2, 4 and the 2s under it follow, and 6's side stays still.
3. Drag 4 somewhere by hand, then drag 8: 4 still follows.
4. "+" on 3 splits it into ? and ?; × on a 2 under 4 removes that pair.
5. Shape button on a flowchart box: circle and back. Arrows touch the oval.
6. Tidy up and Reset in the panel.
7. Ask Claude for a factor tree of 36.
