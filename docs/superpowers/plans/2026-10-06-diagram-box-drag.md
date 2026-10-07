# Diagram Box Drag Implementation Plan

> **Done, and partly replaced since.** This plan built picking, moving and corner-resizing diagram boxes. Later changes (typing on the slide, then text-box behavior: no growing, shrink-to-fit text, corner + side handles, measured letter widths) are described in the spec, `docs/superpowers/specs/2026-10-06-diagram-box-drag-design.md`, which is the current reference.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a teacher pick one box inside a selected diagram (Flowchart, Cycle, Mind Map, Tree) and freely resize it (corner handles) or move it, right on the slide. This replaces the S | M | L size buttons.

**Architecture:** The diagram layouts in `svgLibrary.tsx` place every box (automatic spot, or the box's own saved `x, y, width, height`) and share that list through `getDiagramBoxes`. The editor store keeps which box is picked (`pickedDiagramBox`), because each element is drawn twice (picture layer + selection layer) and both need to know. A click on a selected diagram picks the box under the pointer (`SvgElementItem`). A new `DiagramBoxEditor` in the selection layer draws the picked box's outline and handles, and turns drags into new box values. When the drawing area changes, it also moves and resizes the element so nothing already drawn moves on the slide.

**Tech Stack:** Next.js (this repo's version), React, TypeScript, zustand (editor store), zod 4, Tailwind with the QuizMatter design tokens, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-06-diagram-box-drag-design.md`

## Global Constraints

- Box limits (drawing units): width 24–400, height 16–300, x/y −2000…2000. The four numbers are saved together or not at all.
- Missing `x, y, width, height` = the box's automatic spot and size.
- Text font max = 12 × √(box area ÷ automatic box area), kept between 9 and 24.
- Drawing area = all boxes together plus a 4-unit margin (may start below 0).
- Validate with zod before saving (the save path already parses `presentationSchema`; the limits go in the schema).
- Design system: violet `--accent` outline and handles, `rounded-dropdown`, `text-accent` text buttons; no hard-coded colors in UI chrome. No new packages.
- No test runner exists in this repo and live testing is the user's job (CLAUDE.md). Each task is checked with `npx tsc --noEmit` and `npx eslint <changed files>` (the full `npm run lint` runs out of memory on this machine). Browser checks are listed for the user at the end.
- Don't commit code unless the user asks; the plan ends by asking.

## Review Focus

1. **Rotated or flipped diagram:** dragging a box or a corner must follow the pointer on screen (not move the other way), and handles must sit on the right box. → Task 3 Step 4 self-check of `screenToUnits` / `boxToPx` / `keepInPlace` with flips and 90°.
2. **Box dragged past the top or left edge:** the drawing area starts below 0; the rest of the diagram must not jump on the slide. → Task 3 Step 4 (keepInPlace with a negative new min).
3. **Picked box removed from the panel** (Steps slider lowered, branch/box removed): no crash, the outline just disappears. → Task 3 Step 2 (`if (!box) return null`).
4. **Diagram inside a question, option or side box reaching its edge:** the drag stops; the element never leaves its box. → Task 3 Step 2 (`overflowAmount` check).
5. **Undo right after a box drag:** one undo restores both the box and the element's size/position. → Task 3 Step 2 (one `updateElement` call per move with both parts; the store merges a drag).

---

### Task 1: Box places and sizes in the data and the drawings

Removes the S/M/L sizes and gives every diagram box an optional saved place and size. Also adds Tidy up.

**Files:**
- Modify: `src/lib/constants.ts` (the diagram limits block)
- Modify: `src/lib/schema.ts` (`diagramBoxSchema`)
- Modify: `src/lib/importPresentation.ts` (`diagramBox`, imports, Claude note)
- Modify: `src/lib/svgLibrary.tsx` (the whole "Diagrams" block, from `// Diagrams: flowchart` to `diagramDefaultSize`)
- Modify: `src/components/editor/MathToolPanels.tsx` (diagram panels: drop S/M/L, add Tidy up)

**Interfaces:**
- Produces (from `svgLibrary.tsx`):
  - `type DiagramBoxItem` = one box from the schema `{ text: string; x?: number; y?: number; width?: number; height?: number }`
  - `type DiagramBoxPath = (string | number)[]` (e.g. `["steps", 2]`, `["branches", 1, "leaves", 0]`)
  - `type DiagramKey = "flowchart" | "cycle" | "mindMap" | "tree"`
  - `interface PlacedDiagramBox { x; y; width; height; item: DiagramBoxItem; path: DiagramBoxPath; auto: { width; height } }` (x, y = top-left, drawing units)
  - `getDiagramBoxes(assetId: string, settings: RenderSettings): DiagramBoxes | null` where `interface DiagramBoxes { key: DiagramKey; settings: FlowchartSettings | CycleSettings | MindMapSettings | TreeSettings; boxes: PlacedDiagramBox[] }` (`settings` = the element's setting, or the default when it has none yet)
  - `replaceAtPath<T>(value: T, path: DiagramBoxPath, next: unknown): T`
- Produces (from `constants.ts`): `DIAGRAM_BOX_WIDTH = { min: 24, max: 400 }`, `DIAGRAM_BOX_HEIGHT = { min: 16, max: 300 }`, `DIAGRAM_BOX_POSITION_MAX = 2000`

- [ ] **Step 1: Limits in `constants.ts`**

Replace these two lines:

```ts
// The sizes one diagram box can have (missing = medium).
export const DIAGRAM_BOX_SIZES = ["small", "medium", "large"] as const;
```

with:

```ts
// A diagram box the teacher resized or moved (on the slide): its size limits, and how far from the
// diagram's start it can go. All in drawing units.
export const DIAGRAM_BOX_WIDTH = { min: 24, max: 400 };
export const DIAGRAM_BOX_HEIGHT = { min: 16, max: 300 };
export const DIAGRAM_BOX_POSITION_MAX = 2000;
```

- [ ] **Step 2: Schema in `schema.ts`**

In the constants import, replace `DIAGRAM_BOX_SIZES,` with:

```ts
  DIAGRAM_BOX_HEIGHT,
  DIAGRAM_BOX_POSITION_MAX,
  DIAGRAM_BOX_WIDTH,
```

Replace the `diagramBoxSchema` line (and its comment) with:

```ts
const diagramBoxPosition = z.number().min(-DIAGRAM_BOX_POSITION_MAX).max(DIAGRAM_BOX_POSITION_MAX);

// One box of a diagram (flowchart, cycle, mind map, tree): its text and, once the teacher resized or
// moved it on the slide, its own place (top-left) and size in drawing units. The four are saved
// together or not at all; missing = the box's automatic spot and size.
const diagramBoxSchema = z
  .object({
    text: z.string().max(DIAGRAM_TEXT_MAX),
    x: diagramBoxPosition.optional(),
    y: diagramBoxPosition.optional(),
    width: z.number().min(DIAGRAM_BOX_WIDTH.min).max(DIAGRAM_BOX_WIDTH.max).optional(),
    height: z.number().min(DIAGRAM_BOX_HEIGHT.min).max(DIAGRAM_BOX_HEIGHT.max).optional(),
  })
  .refine(
    (box) => [box.x, box.y, box.width, box.height].every((value) => value === undefined) ||
      [box.x, box.y, box.width, box.height].every((value) => value !== undefined),
    "A diagram box's place and size are saved together.",
  );
```

- [ ] **Step 3: Claude's boxes in `importPresentation.ts`**

Remove `DIAGRAM_BOX_SIZES,` from the constants import. Replace the `diagramBox` definition with:

```ts
// One box of a diagram: its text. Longer text wraps onto up to 3 lines and shrinks to fit. Claude
// always uses the automatic layout; teachers can move and resize boxes in the editor.
const diagramBox = z.object({ text: z.string().max(DIAGRAM_TEXT_MAX) });
```

In `CLAUDE_NOTES`, delete the sentence ` Each box can be "small", "medium" (the default) or "large".` (keep the sentence before it).

- [ ] **Step 4: Replace the Diagrams block in `svgLibrary.tsx`**

Replace everything from the line `// Diagrams: flowchart, cycle, mind map and tree.` block header (the `// ----` line above it) down to and including `function diagramDefaultSize` with:

```tsx
// ---------------------------------------------------------------------------------------------
// Diagrams: flowchart, cycle, mind map and tree. Rounded boxes with a light tint of the element
// color and dark text, joined by dark arrows (flowchart, cycle) or colored lines (mind map, tree).
// Each box sits in its automatic spot unless the teacher moved or resized it on the slide; then it
// keeps its own place and size, and its arrows or lines follow it.
// ---------------------------------------------------------------------------------------------

const DIAGRAM_TEXT_COLOR = "#1F1F1F";
const DIAGRAM_LINE_HEIGHT = 1.2;
// Biggest text in a box of its automatic size; resized boxes scale it, within min–max.
const DIAGRAM_FONT = { normal: 12, min: 9, max: 24 };
// Empty space around the boxes, in drawing units.
const DIAGRAM_MARGIN = 4;

// One box of a diagram: its text, and its own place and size once moved or resized.
export type DiagramBoxItem = NonNullable<SvgElement["cycle"]>["steps"][number];
// Which box: the keys and list positions leading to it inside the diagram's setting,
// e.g. ["steps", 2] or ["branches", 1, "leaves", 0].
export type DiagramBoxPath = (string | number)[];
// The element setting each diagram keeps its boxes in.
export type DiagramKey = "flowchart" | "cycle" | "mindMap" | "tree";

interface DiagramSize {
  width: number;
  height: number;
}

// A box where it's drawn: top-left (x, y) and size in drawing units, plus its automatic size (for the text).
export interface PlacedDiagramBox extends DiagramSize {
  x: number;
  y: number;
  item: DiagramBoxItem;
  path: DiagramBoxPath;
  auto: DiagramSize;
}

// The box's own place and size if the teacher set one, else its automatic spot (centered on `center`).
function placeBox(item: DiagramBoxItem, path: DiagramBoxPath, center: { x: number; y: number }, auto: DiagramSize): PlacedDiagramBox {
  if (item.x !== undefined && item.y !== undefined && item.width !== undefined && item.height !== undefined) {
    return { x: item.x, y: item.y, width: item.width, height: item.height, item, path, auto };
  }
  return { x: center.x - auto.width / 2, y: center.y - auto.height / 2, ...auto, item, path, auto };
}

function boxCenter(box: PlacedDiagramBox) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Drawing area around all the boxes plus a margin. It can start below 0 when a box was moved up or left.
function viewBoxAround(boxes: PlacedDiagramBox[]) {
  const minX = Math.min(...boxes.map((box) => box.x)) - DIAGRAM_MARGIN;
  const minY = Math.min(...boxes.map((box) => box.y)) - DIAGRAM_MARGIN;
  const maxX = Math.max(...boxes.map((box) => box.x + box.width)) + DIAGRAM_MARGIN;
  const maxY = Math.max(...boxes.map((box) => box.y + box.height)) + DIAGRAM_MARGIN;
  return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
}

// `value` with the part at `path` replaced by `next`. Copies only what's on the way; nothing is changed in place.
export function replaceAtPath<T>(value: T, path: DiagramBoxPath, next: unknown): T {
  if (path.length === 0) return next as T;
  const [key, ...rest] = path;
  if (Array.isArray(value)) return value.map((item, i) => (i === key ? replaceAtPath(item, rest, next) : item)) as T;
  const record = value as Record<string, unknown>;
  return { ...record, [key]: replaceAtPath(record[key as string], rest, next) } as T;
}

// Splits text into lines of at most `maxChars` letters, breaking between words (and inside a word
// only when the word alone is too long).
function wrapWords(text: string, maxChars: number) {
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && last.length + 1 + word.length <= maxChars) {
      lines[lines.length - 1] = `${last} ${word}`;
      continue;
    }
    for (let i = 0; i < word.length; i += maxChars) lines.push(word.slice(i, i + maxChars));
  }
  return lines;
}

// The biggest font size (up to `fontMax`) at which the text fits the box in at most 3 lines.
function fitDiagramText(text: string, width: number, height: number, fontMax: number) {
  for (let fontSize = fontMax; fontSize > 4; fontSize -= 0.5) {
    const lines = wrapWords(text, Math.max(1, Math.floor(width / (fontSize * 0.58))));
    if (lines.length <= 3 && lines.length * fontSize * DIAGRAM_LINE_HEIGHT <= height) return { fontSize, lines };
  }
  return { fontSize: 4, lines: wrapWords(text, Math.max(1, Math.floor(width / 2.3))).slice(0, 3) };
}

// A rounded box with its text wrapped and shrunk to fit inside. A bigger box than usual allows bigger
// text. `strong` = a stronger tint, for the mind map's main idea and the tree's top box.
function DiagramBox({ box, color, strong = false }: { box: PlacedDiagramBox; color: string; strong?: boolean }) {
  const { x, y, width, height } = box;
  const growth = Math.sqrt((width * height) / (box.auto.width * box.auto.height));
  const fontMax = Math.min(DIAGRAM_FONT.max, Math.max(DIAGRAM_FONT.min, DIAGRAM_FONT.normal * growth));
  const { fontSize, lines } = fitDiagramText(box.item.text, width - 8, height - 6, fontMax);
  const center = boxCenter(box);
  return (
    <>
      <rect x={x} y={y} width={width} height={height} rx="8" fill="#FFFFFF" />
      <rect x={x} y={y} width={width} height={height} rx="8" fill={color} fillOpacity={strong ? 0.5 : 0.2} stroke={color} strokeWidth="2" />
      <text textAnchor="middle" dominantBaseline="central" fontSize={fontSize} fontWeight="600" fill={DIAGRAM_TEXT_COLOR}>
        {lines.map((line, i) => (
          <tspan key={i} x={center.x} y={center.y + (i - (lines.length - 1) / 2) * fontSize * DIAGRAM_LINE_HEIGHT}>
            {line}
          </tspan>
        ))}
      </text>
    </>
  );
}

// Where a line from the middle of `box`, going toward `to`, leaves the box (plus a small gap).
function boxEdge(box: PlacedDiagramBox, to: { x: number; y: number }, gap = 3) {
  const from = boxCenter(box);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const t = Math.min(ux ? box.width / 2 / Math.abs(ux) : Infinity, uy ? box.height / 2 / Math.abs(uy) : Infinity) + gap;
  return { x: from.x + ux * t, y: from.y + uy * t };
}

// A dark arrow from box `from` to box `to`, edge to edge, with a filled arrowhead at `to`.
function DiagramArrow({ from: fromBox, to: toBox }: { from: PlacedDiagramBox; to: PlacedDiagramBox }) {
  const HEAD = 7;
  const from = boxEdge(fromBox, boxCenter(toBox));
  const to = boxEdge(toBox, boxCenter(fromBox));
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const corner = (turn: number) => `${to.x - HEAD * Math.cos(angle + turn)},${to.y - HEAD * Math.sin(angle + turn)}`;
  return (
    <>
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x - (HEAD - 1) * Math.cos(angle)}
        y2={to.y - (HEAD - 1) * Math.sin(angle)}
        stroke={DIAGRAM_TEXT_COLOR}
        strokeWidth="1.8"
      />
      <polygon points={`${to.x},${to.y} ${corner(0.45)} ${corner(-0.45)}`} fill={DIAGRAM_TEXT_COLOR} />
    </>
  );
}

// A colored joining line between the middles of two boxes (drawn before the boxes, so it hides behind them).
function DiagramLine({ from, to, color }: { from: PlacedDiagramBox; to: PlacedDiagramBox; color: string }) {
  const a = boxCenter(from);
  const b = boxCenter(to);
  return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth="2" />;
}

// Points evenly around a circle, the first at `startDeg` (0 = right, 90 = down), going clockwise.
function ringCenters(count: number, center: { x: number; y: number }, radius: number, startDeg: number) {
  return Array.from({ length: count }, (_, i) => {
    const rad = ((startDeg + (i * 360) / count) * Math.PI) / 180;
    return { x: center.x + radius * Math.cos(rad), y: center.y + radius * Math.sin(rad) };
  });
}

// Smallest ring radius (at least `min`) that keeps `count` boxes about `spacing` units apart.
function ringRadius(count: number, spacing: number, min: number) {
  return Math.max(min, spacing / 2 / Math.sin(Math.PI / count));
}

export type FlowchartSettings = NonNullable<SvgElement["flowchart"]>;
export const DEFAULT_FLOWCHART: FlowchartSettings = { steps: [{ text: "First" }, { text: "Next" }, { text: "Last" }] };
const FLOW_ACROSS = { width: 64, height: 44 };
const FLOW_DOWN = { width: 110, height: 36 };
const FLOW_GAP = 22; // room for the arrow between two steps

// Across = a row, left to right; down = a column, top to bottom.
function flowchartBoxes({ steps, vertical }: FlowchartSettings) {
  const auto = vertical ? FLOW_DOWN : FLOW_ACROSS;
  const length = vertical ? auto.height : auto.width;
  const thickness = vertical ? auto.width : auto.height;
  return steps.map((item, i) => {
    const along = DIAGRAM_MARGIN + length / 2 + i * (length + FLOW_GAP);
    const across = DIAGRAM_MARGIN + thickness / 2;
    return placeBox(item, ["steps", i], vertical ? { x: across, y: along } : { x: along, y: across }, auto);
  });
}

export function getFlowchartViewBox(settings: FlowchartSettings = DEFAULT_FLOWCHART) {
  return viewBoxAround(flowchartBoxes(settings));
}

function renderFlowchart(color: string, settings: FlowchartSettings = DEFAULT_FLOWCHART) {
  const boxes = flowchartBoxes(settings);
  return (
    <>
      {boxes.slice(1).map((to, i) => (
        <DiagramArrow key={`a${i}`} from={boxes[i]} to={to} />
      ))}
      {boxes.map((box, i) => (
        <DiagramBox key={i} box={box} color={color} />
      ))}
    </>
  );
}

export type CycleSettings = NonNullable<SvgElement["cycle"]>;
export const DEFAULT_CYCLE: CycleSettings = {
  steps: [{ text: "Egg" }, { text: "Caterpillar" }, { text: "Pupa" }, { text: "Butterfly" }],
};
const CYCLE_BOX = { width: 64, height: 36 };

// The steps sit on a ring, the first at the top, going clockwise.
function cycleBoxes({ steps }: CycleSettings) {
  const radius = ringRadius(steps.length, CYCLE_BOX.width + 24, 55);
  const center = { x: radius + CYCLE_BOX.width / 2 + DIAGRAM_MARGIN, y: radius + CYCLE_BOX.height / 2 + DIAGRAM_MARGIN };
  return ringCenters(steps.length, center, radius, -90).map((spot, i) => placeBox(steps[i], ["steps", i], spot, CYCLE_BOX));
}

export function getCycleViewBox(settings: CycleSettings = DEFAULT_CYCLE) {
  return viewBoxAround(cycleBoxes(settings));
}

function renderCycle(color: string, settings: CycleSettings = DEFAULT_CYCLE) {
  const boxes = cycleBoxes(settings);
  return (
    <>
      {boxes.map((from, i) => (
        <DiagramArrow key={`a${i}`} from={from} to={boxes[(i + 1) % boxes.length]} />
      ))}
      {boxes.map((box, i) => (
        <DiagramBox key={i} box={box} color={color} />
      ))}
    </>
  );
}

export type MindMapSettings = NonNullable<SvgElement["mindMap"]>;
export const DEFAULT_MIND_MAP: MindMapSettings = {
  center: { text: "Topic" },
  ideas: [{ text: "Idea 1" }, { text: "Idea 2" }, { text: "Idea 3" }, { text: "Idea 4" }],
};
const MIND_CENTER_BOX = { width: 80, height: 44 };
const MIND_IDEA_BOX = { width: 64, height: 36 };

// The main idea first, then the ideas on a ring around it (turned so 2 ideas go left and right).
function mindMapBoxes({ center, ideas }: MindMapSettings) {
  const radius = ringRadius(ideas.length, MIND_IDEA_BOX.width + 24, 90);
  const middle = { x: radius + MIND_IDEA_BOX.width / 2 + DIAGRAM_MARGIN, y: radius + MIND_IDEA_BOX.height / 2 + DIAGRAM_MARGIN };
  return [
    placeBox(center, ["center"], middle, MIND_CENTER_BOX),
    ...ringCenters(ideas.length, middle, radius, -90 + 180 / ideas.length).map((spot, i) =>
      placeBox(ideas[i], ["ideas", i], spot, MIND_IDEA_BOX),
    ),
  ];
}

export function getMindMapViewBox(settings: MindMapSettings = DEFAULT_MIND_MAP) {
  return viewBoxAround(mindMapBoxes(settings));
}

function renderMindMap(color: string, settings: MindMapSettings = DEFAULT_MIND_MAP) {
  const [centerBox, ...ideaBoxes] = mindMapBoxes(settings);
  return (
    <>
      {ideaBoxes.map((box, i) => (
        <DiagramLine key={`l${i}`} from={centerBox} to={box} color={color} />
      ))}
      <DiagramBox box={centerBox} color={color} strong />
      {ideaBoxes.map((box, i) => (
        <DiagramBox key={i} box={box} color={color} />
      ))}
    </>
  );
}

export type TreeSettings = NonNullable<SvgElement["tree"]>;
export const DEFAULT_TREE: TreeSettings = {
  root: { text: "Animals" },
  branches: [
    { label: { text: "Mammals" }, leaves: [{ text: "Dog" }, { text: "Cat" }] },
    { label: { text: "Birds" }, leaves: [{ text: "Eagle" }] },
  ],
};
const TREE_ROOT_BOX = { width: 90, height: 36 };
const TREE_BOX = { width: 64, height: 32 };
const TREE_COLUMN = 76; // width of each branch's column
const TREE_ROW_GAP = 14; // from the top box's bottom to the branches' tops
const TREE_LEAF_STEP = 42; // from one box's middle to the next one down

// The top box is centered over a row of branches; each branch's leaves stack in a column under it.
function treeBoxes({ root, branches }: TreeSettings) {
  const width = Math.max(branches.length * TREE_COLUMN, TREE_ROOT_BOX.width) + 2 * DIAGRAM_MARGIN;
  const left = (width - branches.length * TREE_COLUMN) / 2;
  const branchY = DIAGRAM_MARGIN + TREE_ROOT_BOX.height + TREE_ROW_GAP + TREE_BOX.height / 2;
  const rootBox = placeBox(root, ["root"], { x: width / 2, y: DIAGRAM_MARGIN + TREE_ROOT_BOX.height / 2 }, TREE_ROOT_BOX);
  const branchBoxes = branches.map((branch, i) => {
    const x = left + (i + 0.5) * TREE_COLUMN;
    return {
      label: placeBox(branch.label, ["branches", i, "label"], { x, y: branchY }, TREE_BOX),
      leaves: branch.leaves.map((leaf, j) =>
        placeBox(leaf, ["branches", i, "leaves", j], { x, y: branchY + (j + 1) * TREE_LEAF_STEP }, TREE_BOX),
      ),
    };
  });
  return { rootBox, branchBoxes };
}

function allTreeBoxes(settings: TreeSettings) {
  const { rootBox, branchBoxes } = treeBoxes(settings);
  return [rootBox, ...branchBoxes.flatMap((branch) => [branch.label, ...branch.leaves])];
}

export function getTreeViewBox(settings: TreeSettings = DEFAULT_TREE) {
  return viewBoxAround(allTreeBoxes(settings));
}

function renderTree(color: string, settings: TreeSettings = DEFAULT_TREE) {
  const { rootBox, branchBoxes } = treeBoxes(settings);
  const rootMiddle = boxCenter(rootBox);
  const rootBottom = rootBox.y + rootBox.height;
  return (
    <>
      {/* An elbow line from the top box down into each branch. */}
      {branchBoxes.map(({ label }, i) => {
        const middleY = (rootBottom + label.y) / 2;
        return (
          <path
            key={`e${i}`}
            d={`M${rootMiddle.x} ${rootBottom}V${middleY}H${boxCenter(label).x}V${label.y}`}
            fill="none"
            stroke={color}
            strokeWidth="2"
          />
        );
      })}
      {/* A line from each branch to each of its leaves (stacked leaves make one straight line). */}
      {branchBoxes.flatMap(({ label, leaves }, i) =>
        leaves.map((leaf, j) => <DiagramLine key={`l${i}-${j}`} from={label} to={leaf} color={color} />),
      )}
      <DiagramBox box={rootBox} color={color} strong />
      {branchBoxes.map(({ label, leaves }, i) => (
        <g key={i}>
          <DiagramBox box={label} color={color} />
          {leaves.map((leaf, j) => (
            <DiagramBox key={j} box={leaf} color={color} />
          ))}
        </g>
      ))}
    </>
  );
}

export interface DiagramBoxes {
  key: DiagramKey;
  // The element's setting, or the default when it has none yet (a diagram nobody edited yet).
  settings: FlowchartSettings | CycleSettings | MindMapSettings | TreeSettings;
  boxes: PlacedDiagramBox[];
}

/**
 * Every box of a diagram element, where it's drawn (drawing units), and the setting they live in.
 * Null for anything that isn't a diagram. The editor uses this to pick, move and resize single boxes.
 */
export function getDiagramBoxes(assetId: string, settings: RenderSettings): DiagramBoxes | null {
  switch (getElementAsset(assetId)?.mathTool) {
    case "flowchart": {
      const flowchart = settings.flowchart ?? DEFAULT_FLOWCHART;
      return { key: "flowchart", settings: flowchart, boxes: flowchartBoxes(flowchart) };
    }
    case "cycle": {
      const cycle = settings.cycle ?? DEFAULT_CYCLE;
      return { key: "cycle", settings: cycle, boxes: cycleBoxes(cycle) };
    }
    case "mindMap": {
      const mindMap = settings.mindMap ?? DEFAULT_MIND_MAP;
      return { key: "mindMap", settings: mindMap, boxes: mindMapBoxes(mindMap) };
    }
    case "tree": {
      const tree = settings.tree ?? DEFAULT_TREE;
      return { key: "tree", settings: tree, boxes: allTreeBoxes(tree) };
    }
    default:
      return null;
  }
}

// A diagram's starting size: its default drawing area at 1.5 px per unit.
function diagramDefaultSize(viewBox: string) {
  const [, , width, height] = viewBox.split(" ").map(Number);
  return { width: Math.round(width * 1.5), height: Math.round(height * 1.5) };
}
```

Delete the now-unused `DiagramBoxSize` export (it was in the replaced block). The library entries (`id: "flowchart"` … `"tree-diagram"`) stay as they are.

- [ ] **Step 5: Panels in `MathToolPanels.tsx`**

In the `@/lib/svgLibrary` import, remove `type DiagramBoxSize,` (keep `type DiagramBoxItem,`).

Replace `BOX_SIZE_CHIPS` and `DiagramBoxInput` with:

```tsx
// One diagram box's text. Its place and size (set by dragging on the slide) are kept as they are.
function DiagramBoxInput({ value, onChange }: { value: DiagramBoxItem; onChange: (value: DiagramBoxItem) => void }) {
  return (
    <input
      type="text"
      value={value.text}
      maxLength={DIAGRAM_TEXT_MAX}
      onChange={(e) => onChange({ ...value, text: e.target.value })}
      className="w-full min-w-0 rounded-input border border-border-default px-2 py-1 text-sm text-text-primary"
    />
  );
}

// A box back in its automatic spot and size, keeping its text.
const autoPlaced = (box: DiagramBoxItem): DiagramBoxItem => ({ text: box.text });

// "Tidy up" (every box back in its own spot and size, text kept) and Reset (everything back to the start).
function DiagramButtons({ onTidy, onReset }: { onTidy: () => void; onReset: () => void }) {
  return (
    <div className="flex justify-end gap-4">
      <button
        type="button"
        onClick={onTidy}
        title="Put every box back in its own spot and size"
        className="text-xs font-semibold text-accent hover:opacity-80"
      >
        Tidy up
      </button>
      <ResetButton onClick={onReset} />
    </div>
  );
}
```

In the four panels, replace each `<ResetButton onClick={…} />` with `DiagramButtons`:

```tsx
// FlowchartControls
<DiagramButtons onTidy={() => set({ steps: flowchart.steps.map(autoPlaced) })} onReset={() => set(DEFAULT_FLOWCHART)} />

// CycleControls
<DiagramButtons onTidy={() => setSteps(cycle.steps.map(autoPlaced))} onReset={() => setSteps(DEFAULT_CYCLE.steps)} />

// MindMapControls
<DiagramButtons
  onTidy={() => set({ center: autoPlaced(mindMap.center), ideas: mindMap.ideas.map(autoPlaced) })}
  onReset={() => set(DEFAULT_MIND_MAP)}
/>

// TreeControls
<DiagramButtons
  onTidy={() =>
    set({
      root: autoPlaced(tree.root),
      branches: tree.branches.map((branch) => ({ label: autoPlaced(branch.label), leaves: branch.leaves.map(autoPlaced) })),
    })
  }
  onReset={() => set(DEFAULT_TREE)}
/>
```

(`useResizeForViewBox` only reads the drawing area's width and height, so it keeps working when the area starts below 0.)

- [ ] **Step 6: Check**

Run: `npx tsc --noEmit`
Expected: no output (exit 0).

Run: `npx eslint src/lib/constants.ts src/lib/schema.ts src/lib/importPresentation.ts src/lib/svgLibrary.tsx src/components/editor/MathToolPanels.tsx`
Expected: no output (exit 0).

Run: `git diff --stat` and confirm only these five files changed in this task.

---

### Task 2: Picking a box (store + click)

**Files:**
- Modify: `src/lib/store.ts` (new UI state next to `croppingElementId`)
- Modify: `src/lib/useEditorShortcuts.ts` (Esc un-picks)
- Modify: `src/lib/geometry.ts` (move `overflowAmount` here, exported)
- Modify: `src/components/editor/SvgElementItem.tsx` (click picks; clear the pick when deselected; use `overflowAmount` from geometry)
- Create: `src/components/editor/DiagramBoxEditor.tsx` (only `findDiagramBoxAt` and the shared helpers in this task; the component comes in Task 3)

**Interfaces:**
- Consumes: `getDiagramBoxes`, `DiagramBoxPath`, `getAssetViewBox`, `getElementAsset` (Task 1 / existing).
- Produces:
  - store: `pickedDiagramBox: { elementId: string; path: DiagramBoxPath } | null`, `setPickedDiagramBox(pick: { elementId: string; path: DiagramBoxPath } | null): void`
  - geometry: `export function overflowAmount(box: Rect, angle: number, bounds: { width: number; height: number }): number`
  - DiagramBoxEditor.tsx: `export function findDiagramBoxAt(element: SvgElement, clientX: number, clientY: number, boxEl: HTMLElement, zoom: number): DiagramBoxPath | null`, plus file-local helpers `getFrame`, `boxToPx`, `screenToUnits`, `keepInPlace` used by Task 3.

- [ ] **Step 1: Store state**

In `src/lib/store.ts`, change the svgLibrary import to also bring `type DiagramBoxPath`:

```ts
import { DEFAULT_ELEMENT_COLOR, DEFAULT_ELEMENT_SIZE, getElementAsset, type DiagramBoxPath, type ElementCategory, type RenderSettings } from "./svgLibrary";
```

In the state interface, right after `setCroppingElementId: …;`, add:

```ts
  // One box picked inside the selected diagram (its own outline and handles show, so it can be moved
  // or resized on its own), or null. Only while that diagram is the one selected element.
  pickedDiagramBox: { elementId: string; path: DiagramBoxPath } | null;
  setPickedDiagramBox: (pick: { elementId: string; path: DiagramBoxPath } | null) => void;
```

In the store body, right after `setCroppingElementId: (elementId) => set({ croppingElementId: elementId }),`, add:

```ts
  pickedDiagramBox: null,
  setPickedDiagramBox: (pick) => set({ pickedDiagramBox: pick }),
```

- [ ] **Step 2: Esc un-picks**

In `src/lib/useEditorShortcuts.ts`, right after the cropping `else if (…) { … state.setCroppingElementId(null); }` branch, add:

```ts
      } else if (
        // A picked diagram box: Escape goes back to the whole diagram (it stays selected).
        state.pickedDiagramBox &&
        selectedElementIds.length === 1 &&
        selectedElementIds[0] === state.pickedDiagramBox.elementId &&
        e.key === "Escape"
      ) {
        e.preventDefault();
        state.setPickedDiagramBox(null);
```

(It slots in as one more `else if` before `} else if (selectedElementIds.length > 0 && e.key === "Delete") {`.)

- [ ] **Step 3: Move `overflowAmount` to geometry**

Cut the `overflowAmount` function (with its comment) from `SvgElementItem.tsx` and paste it into `src/lib/geometry.ts` as `export function overflowAmount(...)` (body unchanged; `Rect` is already defined there). In `SvgElementItem.tsx`, add `overflowAmount,` to the `@/lib/geometry` import.

- [ ] **Step 4: Shared helpers + `findDiagramBoxAt` in the new file**

Create `src/components/editor/DiagramBoxEditor.tsx`:

```tsx
"use client";

import { getAssetViewBox, getDiagramBoxes, getElementAsset, type DiagramBoxPath } from "@/lib/svgLibrary";
import type { SvgElement } from "@/lib/schema";

// How a diagram's drawing sits in its element: like the <svg> ("meet"), scaled to fit and centered.
// minX/minY = the drawing area's start (can be below 0), scale = px per drawing unit.
interface DiagramFrame {
  minX: number;
  minY: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

function getFrame(element: SvgElement, viewBox: string): DiagramFrame {
  const [minX, minY, width, height] = viewBox.split(" ").map(Number);
  const scale = Math.min(element.width / width, element.height / height);
  return { minX, minY, scale, offsetX: (element.width - width * scale) / 2, offsetY: (element.height - height * scale) / 2 };
}

// The element's angle as cos/sin.
function turn(element: SvgElement) {
  const rad = ((element.rotation ?? 0) * Math.PI) / 180;
  return { cos: Math.cos(rad), sin: Math.sin(rad) };
}

/** Which box of a diagram is under the pointer, or null (also for anything that isn't a diagram). */
export function findDiagramBoxAt(
  element: SvgElement,
  clientX: number,
  clientY: number,
  boxEl: HTMLElement,
  zoom: number,
): DiagramBoxPath | null {
  const diagram = getDiagramBoxes(element.assetId, element);
  const asset = getElementAsset(element.assetId);
  if (!diagram || !asset) return null;
  // The element's outline on screen is a turned box; its middle is the element's middle.
  const rect = boxEl.getBoundingClientRect();
  const dx = clientX - (rect.left + rect.width / 2);
  const dy = clientY - (rect.top + rect.height / 2);
  // Turn the pointer back by the element's angle, into the element's own px (0,0 = its top-left).
  const { cos, sin } = turn(element);
  const localX = (dx * cos + dy * sin) / zoom + element.width / 2;
  const localY = (-dx * sin + dy * cos) / zoom + element.height / 2;
  // The picture is mirrored inside the element when flipped.
  const x = element.flipX ? element.width - localX : localX;
  const y = element.flipY ? element.height - localY : localY;
  const frame = getFrame(element, getAssetViewBox(asset, element));
  const unitX = frame.minX + (x - frame.offsetX) / frame.scale;
  const unitY = frame.minY + (y - frame.offsetY) / frame.scale;
  // Later boxes are drawn on top, so they win.
  const hit = [...diagram.boxes]
    .reverse()
    .find((box) => unitX >= box.x && unitX <= box.x + box.width && unitY >= box.y && unitY <= box.y + box.height);
  return hit?.path ?? null;
}
```

- [ ] **Step 5: Click picks, deselect clears (`SvgElementItem.tsx`)**

Add imports:

```ts
import { canCrop, getDiagramBoxes, getElementAsset } from "@/lib/svgLibrary";
import { findDiagramBoxAt } from "./DiagramBoxEditor";
```

Add to `DragState`:

```ts
  /** A click (no drag) on an already selected diagram picks the box under the pointer. */
  pickOnClick: boolean;
```

Next to the cropping store reads (after `const isCropping = …;`), add:

```ts
  const setPickedDiagramBox = useEditorStore((s) => s.setPickedDiagramBox);
  const isPickTarget = useEditorStore((s) => s.pickedDiagramBox?.elementId === element.id);
```

After the cropping `useEffect`, add:

```ts
  // A picked diagram box is let go once this isn't the one selected element anymore.
  useEffect(() => {
    if (isPickTarget && !isOnlySelected) setPickedDiagramBox(null);
  }, [isPickTarget, isOnlySelected, setPickedDiagramBox]);
```

In `handleBodyPointerDown`, in the `dragState.current = { … }` object, add (it reads `isOnlySelected` from before this click, so the first click only selects):

```ts
      pickOnClick: isOnlySelected && !!getDiagramBoxes(element.assetId, element),
```

In `stopDrag`, right after `if (!state) return;`, add:

```ts
    // A click without dragging on an already selected diagram picks the box under the pointer
    // (or lets go of the picked one when it's not on a box).
    if (e.type === "pointerup" && state.pickOnClick && state.dx === 0 && state.dy === 0 && boxRef.current) {
      const path = findDiagramBoxAt(element, e.clientX, e.clientY, boxRef.current, zoom);
      setPickedDiagramBox(path ? { elementId: element.id, path } : null);
    }
```

- [ ] **Step 6: Check**

Run: `npx tsc --noEmit` → no output.
Run: `npx eslint src/lib/store.ts src/lib/useEditorShortcuts.ts src/lib/geometry.ts src/components/editor/SvgElementItem.tsx src/components/editor/DiagramBoxEditor.tsx` → no output.

---

### Task 3: Move and resize the picked box (`DiagramBoxEditor`)

**Files:**
- Modify: `src/components/editor/DiagramBoxEditor.tsx` (add helpers + the component)
- Modify: `src/components/editor/SvgElementItem.tsx` (render it in the selection part)

**Interfaces:**
- Consumes: `pickedDiagramBox` (Task 2), `getDiagramBoxes`, `replaceAtPath`, `PlacedDiagramBox`, `DiagramBoxPath` (Task 1), `overflowAmount`, `clamp` (geometry), `DIAGRAM_BOX_WIDTH`, `DIAGRAM_BOX_HEIGHT`, `DIAGRAM_BOX_POSITION_MAX` (constants).
- Produces: `export function DiagramBoxEditor(props: { slideId: string; element: SvgElement; bounds: { width: number; height: number }; overhang: number }): JSX.Element | null`

- [ ] **Step 1: Helpers**

Change the top imports of `DiagramBoxEditor.tsx` to:

```tsx
"use client";

import { useRef } from "react";
import { useEditorStore } from "@/lib/store";
import {
  getAssetViewBox,
  getDiagramBoxes,
  getElementAsset,
  replaceAtPath,
  type DiagramBoxPath,
  type PlacedDiagramBox,
} from "@/lib/svgLibrary";
import { DIAGRAM_BOX_HEIGHT, DIAGRAM_BOX_POSITION_MAX, DIAGRAM_BOX_WIDTH } from "@/lib/constants";
import { clamp, overflowAmount } from "@/lib/geometry";
import type { SvgElement } from "@/lib/schema";
```

Add below `findDiagramBoxAt`:

```tsx
interface UnitBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function samePath(a: DiagramBoxPath, b: DiagramBoxPath) {
  return a.length === b.length && a.every((part, i) => part === b[i]);
}

// A box's spot inside the element, in px, mirrored like the picture when flipped.
function boxToPx(box: UnitBox, frame: DiagramFrame, element: SvgElement) {
  const width = box.width * frame.scale;
  const height = box.height * frame.scale;
  const left = frame.offsetX + (box.x - frame.minX) * frame.scale;
  const top = frame.offsetY + (box.y - frame.minY) * frame.scale;
  return {
    width,
    height,
    left: element.flipX ? element.width - left - width : left,
    top: element.flipY ? element.height - top - height : top,
  };
}

// A pointer move on screen (px) as a move in drawing units: turned back by the element's angle,
// mirrored when flipped, and scaled.
function screenToUnits(dx: number, dy: number, element: SvgElement, zoom: number, scale: number) {
  const { cos, sin } = turn(element);
  const localX = (dx * cos + dy * sin) / zoom;
  const localY = (-dx * sin + dy * cos) / zoom;
  return { x: (element.flipX ? -localX : localX) / scale, y: (element.flipY ? -localY : localY) / scale };
}

/**
 * The element's new place and size when its drawing area changes from `oldViewBox` to `newViewBox`
 * (a box moved past the edge, or back in): px per drawing unit stays the same, and everything already
 * drawn stays in the same spot on the slide — also when the element is turned or flipped.
 */
function keepInPlace(element: SvgElement, oldViewBox: string, newViewBox: string) {
  const frame = getFrame(element, oldViewBox);
  const [minX, minY, unitWidth, unitHeight] = newViewBox.split(" ").map(Number);
  // The new drawing area as a box inside the old element (px), mirrored like the picture.
  const area = boxToPx({ x: minX, y: minY, width: unitWidth, height: unitHeight }, frame, element);
  // Its middle, measured from the old element's middle, turned by the element's angle.
  const moveX = area.left + area.width / 2 - element.width / 2;
  const moveY = area.top + area.height / 2 - element.height / 2;
  const { cos, sin } = turn(element);
  const centerX = element.x + element.width / 2 + moveX * cos - moveY * sin;
  const centerY = element.y + element.height / 2 + moveX * sin + moveY * cos;
  return { x: centerX - area.width / 2, y: centerY - area.height / 2, width: area.width, height: area.height };
}

// Corner handles of the picked box. sx/sy = which way is outward on screen (+1 = right/down).
const BOX_CORNERS: { sx: 1 | -1; sy: 1 | -1; className: string }[] = [
  { sx: -1, sy: -1, className: "-top-1.5 -left-1.5 cursor-nwse-resize" },
  { sx: 1, sy: -1, className: "-top-1.5 -right-1.5 cursor-nesw-resize" },
  { sx: -1, sy: 1, className: "-bottom-1.5 -left-1.5 cursor-nesw-resize" },
  { sx: 1, sy: 1, className: "-bottom-1.5 -right-1.5 cursor-nwse-resize" },
];

// The box after dragging a corner by `d` drawing units: the opposite corner stays put. `ux`/`uy` =
// which way is outward in drawing units (the screen direction, mirrored when the picture is flipped).
function resizeBox(start: UnitBox, d: { x: number; y: number }, ux: 1 | -1, uy: 1 | -1): UnitBox {
  const width = clamp(start.width + d.x * ux, DIAGRAM_BOX_WIDTH.min, DIAGRAM_BOX_WIDTH.max);
  const height = clamp(start.height + d.y * uy, DIAGRAM_BOX_HEIGHT.min, DIAGRAM_BOX_HEIGHT.max);
  return {
    x: ux === 1 ? start.x : start.x + start.width - width,
    y: uy === 1 ? start.y : start.y + start.height - height,
    width,
    height,
  };
}
```

- [ ] **Step 2: The component**

Add at the end of `DiagramBoxEditor.tsx`:

```tsx
interface DiagramBoxEditorProps {
  slideId: string;
  element: SvgElement;
  // The box the element sits in (canvas, question, option or side box), and how far it may stick out.
  bounds: { width: number; height: number };
  overhang: number;
}

/**
 * The picked box of the selected diagram: a violet outline to drag it by, and corner handles to resize it.
 * Each drag writes the box's own place and size; if the drawing area changes, the element is moved and
 * resized too so nothing else moves on the slide. Nothing shows when no box of this diagram is picked.
 */
export function DiagramBoxEditor({ slideId, element, bounds, overhang }: DiagramBoxEditorProps) {
  const zoom = useEditorStore((s) => s.zoom);
  const picked = useEditorStore((s) => s.pickedDiagramBox);
  const updateElement = useEditorStore((s) => s.updateElement);
  // Where the drag started: pointer, the box then, and the corner (null = moving the whole box).
  const drag = useRef<{ pointerX: number; pointerY: number; start: UnitBox; corner: (typeof BOX_CORNERS)[number] | null; scale: number } | null>(null);

  const diagram = getDiagramBoxes(element.assetId, element);
  const asset = getElementAsset(element.assetId);
  if (!diagram || !asset || picked?.elementId !== element.id) return null;
  // The picked box may be gone (e.g. the panel removed it).
  const box: PlacedDiagramBox | undefined = diagram.boxes.find((b) => samePath(b.path, picked.path));
  if (!box) return null;
  const viewBox = getAssetViewBox(asset, element);
  const frame = getFrame(element, viewBox);
  const px = boxToPx(box, frame, element);

  const startDrag = (e: React.PointerEvent<HTMLDivElement>, corner: (typeof BOX_CORNERS)[number] | null) => {
    e.stopPropagation();
    drag.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      start: { x: box.x, y: box.y, width: box.width, height: box.height },
      corner,
      scale: frame.scale,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    // A corner's move would also reach the outline it sits in; handle it once.
    e.stopPropagation();
    const d = screenToUnits(e.clientX - state.pointerX, e.clientY - state.pointerY, element, zoom, state.scale);
    const next = state.corner
      ? resizeBox(state.start, d, element.flipX ? (-state.corner.sx as 1 | -1) : state.corner.sx, element.flipY ? (-state.corner.sy as 1 | -1) : state.corner.sy)
      : { ...state.start, x: state.start.x + d.x, y: state.start.y + d.y };
    next.x = clamp(next.x, -DIAGRAM_BOX_POSITION_MAX, DIAGRAM_BOX_POSITION_MAX);
    next.y = clamp(next.y, -DIAGRAM_BOX_POSITION_MAX, DIAGRAM_BOX_POSITION_MAX);
    // Start from diagram.settings, not element[diagram.key]: a diagram nobody edited yet has no setting saved.
    const settings = replaceAtPath(diagram.settings, box.path, { text: box.item.text, ...next });
    const patch = { [diagram.key]: settings } as Partial<SvgElement>;
    const place = keepInPlace(element, viewBox, getAssetViewBox(asset, patch));
    // Inside a question, option or side box the diagram can't grow past its edge: the drag stops there.
    // On the slide itself elements may already stick out past the edge (overhang), so there it may grow.
    if (!overhang && overflowAmount(place, element.rotation ?? 0, bounds) > 0.5) return;
    // One change with both parts, so one undo puts back the box and the element together.
    updateElement(slideId, element.id, { ...patch, ...place });
  };

  const stopDrag = () => {
    drag.current = null;
  };

  return (
    <div
      onPointerDown={(e) => startDrag(e, null)}
      onPointerMove={moveDrag}
      onPointerUp={stopDrag}
      onPointerLeave={stopDrag}
      onClick={(e) => e.stopPropagation()}
      title="Drag to move this box"
      className="pointer-events-auto absolute cursor-move rounded-dropdown"
      style={{ left: px.left, top: px.top, width: px.width, height: px.height, outline: "1.5px solid var(--accent)", outlineOffset: 1 }}
    >
      {BOX_CORNERS.map((corner) => (
        <div
          key={corner.className}
          onPointerDown={(e) => startDrag(e, corner)}
          onPointerMove={moveDrag}
          onPointerUp={stopDrag}
          onPointerLeave={stopDrag}
          title="Resize this box"
          className={`absolute h-3 w-3 rounded-full border-2 border-white shadow-sm ${corner.className}`}
          style={{ background: "var(--accent)" }}
        />
      ))}
    </div>
  );
}
```

(Hooks are all called before the early returns, so they run every render.)

- [ ] **Step 3: Render it (`SvgElementItem.tsx`)**

Change the import to `import { DiagramBoxEditor, findDiagramBoxAt } from "./DiagramBoxEditor";`.

Just before the rotate handle block (`{showSelection && isOnlySelected && canRotate && !isCropping && (`), add:

```tsx
      {/* A picked diagram box: its own outline and handles (under the element's own handles). */}
      {showSelection && isOnlySelected && !isCropping && (
        <DiagramBoxEditor slideId={slideId} element={element} bounds={bounds} overhang={overhang} />
      )}
```

- [ ] **Step 4: Self-check the math by reading (Review Focus 1, 2)**

Walk through these by hand against the code above and fix anything that doesn't hold:

1. No turn, no flip, box dragged right by 10 screen px at zoom 1, scale 1.5 → `screenToUnits` gives x ≈ 6.67 units → box moves right. 
2. `flipX` on → the same drag gives x ≈ −6.67 units; the picture is mirrored, so on screen the box still moves right. `boxToPx` puts its outline at `element.width − left − width`, matching the mirrored picture.
3. Rotation 90°: dragging down on screen (dy = 10) → localX = dy·sin = 10 → moves along the element's own x, which points down on screen at 90°. Correct.
4. A box dragged 20 units past the left edge: new viewBox minX = old minX − 20; `keepInPlace` gives `area.left = offsetX − 20·scale`, so the element's x moves left by 20·scale (no turn) and its width grows by 20·scale. Everything else keeps its screen spot.
5. Right-bottom corner dragged with `flipX`: on screen outward is right; in units it's left (−1), so `resizeBox` keeps the box's right edge in units, which is its left edge on screen. The opposite corner on screen stays put.

- [ ] **Step 5: Check**

Run: `npx tsc --noEmit` → no output.
Run: `npx eslint src/components/editor/DiagramBoxEditor.tsx src/components/editor/SvgElementItem.tsx` → no output.

---

### Task 4: Final check against the spec

- [ ] **Step 1:** Run `npx tsc --noEmit` and `npx eslint` on every file changed in Tasks 1–3. Expected: no output.
- [ ] **Step 2:** Read `git diff` next to the spec, section by section: picking, move, resize, text re-fit, area grows, container edge, undo, Tidy up, Reset, saved data + zod limits, Claude `{ text }` only, S/M/L gone. Note anything missing or extra and fix it.
- [ ] **Step 3:** Tell the user what passed, and give them this browser checklist (live testing is theirs):
  1. Add each diagram; click it, then click a box: violet outline + 4 handles.
  2. Drag a box; drag a corner. Arrows/lines follow; other boxes stay.
  3. Make a box much bigger and much smaller: text grows/shrinks and stays inside.
  4. Drag a box past the top-left: the diagram grows, nothing else moves on the slide.
  5. Rotate the diagram 45° and flip it; repeat 2.
  6. Put a diagram in a choice option; drag a box toward the edge: it stops.
  7. Ctrl+Z after a drag: box and diagram go back together. Esc lets go of the box.
  8. Lower the Steps slider while the last box is picked: outline disappears, no error.
  9. Tidy up: boxes go back, text stays. Save and reload: the moved boxes stay moved.
- [ ] **Step 4:** Ask the user whether to commit (CLAUDE.md: commit only when asked).
