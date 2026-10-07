# Diagram Box Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the teacher change a diagram box's background, border, text color and text size: for the picked box only, or for every box when the whole diagram is selected.

**Architecture:** Each diagram box saves four optional fields (`fill`, `border`, `textColor`, `fontSize`) next to its text. `DiagramBox` in `svgLibrary.tsx` draws them (missing = today's look). Two small helpers in `svgLibrary.tsx` decide which boxes a change goes to and write the change; the toolbar and the Color panel both use them through `updateElement` (so each change is one undo step).

**Tech Stack:** Next.js (App Router), React, TypeScript, Zustand store (`src/lib/store.ts`), zod, Tailwind with the QuizMatter design system, `lucide-react`. No new packages.

**Spec:** `docs/superpowers/specs/2026-10-07-diagram-box-style-design.md`

## Global Constraints

- Every saved value is checked by zod (`diagramBoxSchema` in `src/lib/schema.ts`); limits live in `src/lib/constants.ts`.
- Design system classes only (`bg-bg-surface`, `border-border-default`, `rounded-dropdown`, `text-text-secondary`, …); no hard-coded UI colors except the existing swatch constants (`NONE_SWATCH`, `MIXED_COLOR_SWATCH`).
- Lucide icons only, always with `size`.
- Text size list (drawing units): `6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36`; default `12`; the size is the biggest the text gets, it still shrinks to fit.
- `fill` / `border`: `#RRGGBB` or `"none"`. `textColor`: `#RRGGBB`. Solid colors only, no gradients.
- Claude's import schema (`src/lib/importPresentation.ts`) is NOT changed.
- No new packages.
- **Do not commit.** The branch already has uncommitted diagram work in the same files (`svgLibrary.tsx`, `schema.ts`, `MathToolPanels.tsx`, …). Committing a task would commit that work too. The user commits.
- This project has no unit test runner. Each task's check is `npx tsc --noEmit` and `npx eslint <changed files>`; live testing is done by the user.

## Review Focus

1. **Moving or resizing a styled box** must keep its colors and size. Today the drag writes `{ text, ...place }` and would drop them; Task 2 fixes it.
2. **A picked box that no longer exists** (the panel removed it): style changes go to all boxes, and the label says "All boxes", rather than nothing happening (Task 1 `diagramStyleTargets` falls back).
3. **Background "None"**: the box is see-through but can still be clicked, picked and dragged (picking uses box geometry, not the drawing, so no change is needed; check it live).
4. **The Color panel left open while the selection changes** (e.g. opened on "Box background", then a shape box or another element is selected): it must not paint the wrong thing. Task 3 only treats `"fill"` / `"border"` as shape-box targets and only uses box targets when exactly one diagram is selected.
5. **A diagram whose main Color is a gradient**: the default border swatch must still draw (Task 4 `borderSwatch` falls back to a filled circle).

---

### Task 1: Save and draw a box's own look

**Files:**
- Modify: `src/lib/constants.ts` (after `DIAGRAM_BOX_POSITION_MAX`, ~line 85)
- Modify: `src/lib/schema.ts:163-182` (`diagramBoxSchema`)
- Modify: `src/lib/svgLibrary.tsx:531-545` (constants), `:670-692` (`fitDiagramText`), `:698-730` (`DiagramBox`), after `getDiagramBoxes` (~line 1003)

**Interfaces:**
- Produces (constants): `DIAGRAM_FONT_SIZE = { min: 6, max: 36, default: 12 }`, `DIAGRAM_FONT_SIZES: number[]`, `DIAGRAM_NONE = "none"`.
- Produces (svgLibrary):
  - `type DiagramBoxStyle = Partial<Pick<DiagramBoxItem, "fill" | "border" | "textColor" | "fontSize">>`
  - `diagramStyleTargets(diagram: DiagramBoxes, pickedPath: DiagramBoxPath | undefined): PlacedDiagramBox[]`
  - `withDiagramBoxStyle(diagram: DiagramBoxes, targets: PlacedDiagramBox[], style: DiagramBoxStyle): Partial<SvgElement>`

- [ ] **Step 1: Add the limits to `src/lib/constants.ts`** right after `DIAGRAM_BOX_POSITION_MAX`:

```ts
// A diagram box's own text size (drawing units): the biggest its text gets; like a text box, it still
// shrinks to fit. `default` is the size of a box with none chosen.
export const DIAGRAM_FONT_SIZE = { min: 6, max: 36, default: 12 };
// Sizes offered in the diagram's size list; − and + step between them.
export const DIAGRAM_FONT_SIZES = [6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36];
// A box background or border set to this is left out (see-through box / no border).
// `as const` so zod's z.literal gives the type "none".
export const DIAGRAM_NONE = "none" as const;
```

- [ ] **Step 2: Add the four fields to `diagramBoxSchema` in `src/lib/schema.ts`.** Add `DIAGRAM_FONT_SIZE` and `DIAGRAM_NONE` to the `./constants` import, then above `diagramBoxSchema`:

```ts
// A diagram box's own color: a plain #RRGGBB (the Color panel's solid colors).
const diagramBoxColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
```

and change the object to:

```ts
// One box of a diagram (flowchart, cycle, mind map, tree): its text and, once the teacher resized or
// moved it on the slide, its own place (top-left) and size in drawing units. The four are saved
// together or not at all; missing = the box's automatic spot and size.
// Its own look is optional too: background and border (a color or "none"), text color and the
// biggest text size. Missing = the diagram's Color tint, a Color border, dark text, size 12.
const diagramBoxSchema = z
  .object({
    text: z.string().max(DIAGRAM_TEXT_MAX),
    x: diagramBoxPosition.optional(),
    y: diagramBoxPosition.optional(),
    width: z.number().min(DIAGRAM_BOX_WIDTH.min).max(DIAGRAM_BOX_WIDTH.max).optional(),
    height: z.number().min(DIAGRAM_BOX_HEIGHT.min).max(DIAGRAM_BOX_HEIGHT.max).optional(),
    fill: z.union([diagramBoxColor, z.literal(DIAGRAM_NONE)]).optional(),
    border: z.union([diagramBoxColor, z.literal(DIAGRAM_NONE)]).optional(),
    textColor: diagramBoxColor.optional(),
    fontSize: z.number().min(DIAGRAM_FONT_SIZE.min).max(DIAGRAM_FONT_SIZE.max).optional(),
  })
  .refine(
```

(the `.refine(...)` part stays as it is).

- [ ] **Step 3: Font size in `svgLibrary.tsx`.** Change the `./constants` import to:

```ts
import { BORDER_WIDTH_DEFAULT, DIAGRAM_FONT_SIZE, DIAGRAM_NONE } from "./constants";
```

Replace

```ts
// Like a text box: the text is this size, and shrinks (down to `smallest`) when it doesn't fit its box.
// A bigger box doesn't make the text bigger.
const DIAGRAM_FONT = { normal: 12, smallest: 1 };
```

with

```ts
// Like a text box: the text is the box's own size (else DIAGRAM_FONT_SIZE.default), and shrinks down to
// this when it doesn't fit its box. A bigger box doesn't make the text bigger.
const DIAGRAM_SMALLEST_FONT = 1;
```

and replace `fitDiagramText` with:

```ts
/**
 * A box's text as drawn, like a text box: the box's size if it fits, else the biggest size (down to 1)
 * at which all of it fits inside the box, and its lines.
 */
export function fitDiagramText(box: PlacedDiagramBox, measured: boolean) {
  const largest = box.item.fontSize ?? DIAGRAM_FONT_SIZE.default;
  const room = { width: box.width - DIAGRAM_TEXT_PADDING.x * 2, height: box.height - DIAGRAM_TEXT_PADDING.y * 2 };
  const linesAt = (fontSize: number) => wrapLines(box.item.text, room.width, fontSize, measured);
  const fits = (lines: string[], fontSize: number) => lines.length * fontSize * DIAGRAM_LINE_HEIGHT <= room.height;
  const full = linesAt(largest);
  if (fits(full, largest)) return { fontSize: largest, lines: full };
  // Bigger text needs more lines, so the biggest size that fits is found by halving (in 0.5 steps).
  let low = 0;
  let high = (largest - DIAGRAM_SMALLEST_FONT) * 2;
  let best: { fontSize: number; lines: string[] } | null = null;
  while (low <= high) {
    const step = Math.floor((low + high) / 2);
    const fontSize = DIAGRAM_SMALLEST_FONT + step / 2;
    const lines = linesAt(fontSize);
    if (fits(lines, fontSize)) {
      best = { fontSize, lines };
      low = step + 1;
    } else {
      high = step - 1;
    }
  }
  return best ?? { fontSize: DIAGRAM_SMALLEST_FONT, lines: linesAt(DIAGRAM_SMALLEST_FONT) };
}
```

Then run `grep -n "DIAGRAM_FONT\b\|DIAGRAM_FONT\." src/lib/svgLibrary.tsx` and expect no matches (other than `DIAGRAM_FONT_SIZE`).

- [ ] **Step 4: Draw the box's look in `DiagramBox`.** Update the comment above the section (line ~531) to:

```ts
// Diagrams: flowchart, cycle, mind map and tree. Rounded boxes with a light tint of the element
// color and dark text (unless the teacher gave a box its own background, border, text color or size),
// joined by dark arrows (flowchart, cycle) or colored lines (mind map, tree).
```

and replace the body of `DiagramBox` (keep the props) with:

```tsx
  const { x, y, width, height } = box;
  const { fill, border, textColor } = box.item;
  const { fontSize, lines } = fitDiagramText(box, !!text.fontsReady);
  const center = boxCenter(box);
  return (
    <>
      {/* Background: the box's own color, none, or (unset) white with a tint of the element color. */}
      {fill === undefined ? (
        <>
          <rect x={x} y={y} width={width} height={height} rx="8" fill="#FFFFFF" />
          <rect x={x} y={y} width={width} height={height} rx="8" fill={color} fillOpacity={strong ? 0.5 : 0.2} />
        </>
      ) : (
        fill !== DIAGRAM_NONE && <rect x={x} y={y} width={width} height={height} rx="8" fill={fill} />
      )}
      {border !== DIAGRAM_NONE && (
        <rect x={x} y={y} width={width} height={height} rx="8" fill="none" stroke={border ?? color} strokeWidth="2" />
      )}
      {!sameDiagramPath(box.path, text.editingDiagramBox) && (
        <text textAnchor="middle" dominantBaseline="central" fontSize={fontSize} fontWeight="600" fill={textColor ?? DIAGRAM_TEXT_COLOR}>
          {lines.map((line, i) => (
            <tspan key={i} x={center.x} y={center.y + (i - (lines.length - 1) / 2) * fontSize * DIAGRAM_LINE_HEIGHT}>
              {line}
            </tspan>
          ))}
        </text>
      )}
    </>
  );
```

- [ ] **Step 5: Add the two style helpers** right after `getDiagramBoxes` in `svgLibrary.tsx`:

```ts
// A box's own look (the fields a style change writes).
export type DiagramBoxStyle = Partial<Pick<DiagramBoxItem, "fill" | "border" | "textColor" | "fontSize">>;

// The boxes a style change goes to: the picked box, or every box when none is picked (or the picked one is gone).
export function diagramStyleTargets(diagram: DiagramBoxes, pickedPath: DiagramBoxPath | undefined) {
  const picked = pickedPath && diagram.boxes.find((box) => sameDiagramPath(box.path, pickedPath));
  return picked ? [picked] : diagram.boxes;
}

// The element change that writes `style` into each of `targets` (their text, place and size kept).
export function withDiagramBoxStyle(diagram: DiagramBoxes, targets: PlacedDiagramBox[], style: DiagramBoxStyle) {
  const settings = targets.reduce((next, box) => replaceAtPath(next, box.path, { ...box.item, ...style }), diagram.settings);
  return { [diagram.key]: settings } as Partial<SvgElement>;
}
```

- [ ] **Step 6: Check**

Run: `npx tsc --noEmit` — Expected: no errors.
Run: `npx eslint src/lib/constants.ts src/lib/schema.ts src/lib/svgLibrary.tsx` — Expected: no errors.

---

### Task 2: Keep a box's look when it's moved, tidied or copied

**Files:**
- Modify: `src/components/editor/DiagramBoxEditor.tsx:221` (typing area color), `:283` (drag write)
- Modify: `src/components/editor/MathToolPanels.tsx:454-455` (`autoPlaced`), `:475-498` (`DiagramBoxCount`), `:644-654` (Tree add buttons)

**Interfaces:**
- Consumes: `DiagramBoxItem` (now with `fill?`, `border?`, `textColor?`, `fontSize?`) and `fitDiagramText` (now uses the box's size) from Task 1.

- [ ] **Step 1: Typing area uses the box's text color.** In `DiagramTextArea`'s props add `color: string`, and in its `style` replace `color: DIAGRAM_TEXT_COLOR,` with `color,`. Where `DiagramBoxEditor` renders it, pass:

```tsx
          color={box.item.textColor ?? DIAGRAM_TEXT_COLOR}
```

(`fontPx` already comes from `fitDiagramText`, which now uses the box's size; nothing else to change for size.)

- [ ] **Step 2: Dragging keeps the look.** In `moveDrag`, replace

```ts
    const settings = replaceAtPath(diagram.settings, box.path, { text: box.item.text, ...next });
```

with

```ts
    const settings = replaceAtPath(diagram.settings, box.path, { ...box.item, ...next });
```

- [ ] **Step 3: Tidy up keeps the look.** In `MathToolPanels.tsx` replace

```ts
// A box back in its automatic spot and size, keeping its text.
const autoPlaced = (box: DiagramBoxItem): DiagramBoxItem => ({ text: box.text });
```

with

```ts
// A box's look only (no text, place or size), so a new box can match the one before it.
const lookOf = (box: DiagramBoxItem | undefined): DiagramBoxStyle => ({
  fill: box?.fill,
  border: box?.border,
  textColor: box?.textColor,
  fontSize: box?.fontSize,
});

// A box back in its automatic spot and size, keeping its text and look.
const autoPlaced = (box: DiagramBoxItem): DiagramBoxItem => ({ ...lookOf(box), text: box.text });
```

Add `type DiagramBoxStyle` to the existing `@/lib/svgLibrary` import. (Fields left `undefined` are fine: zod's `.optional()` accepts them and they drop out when saved as JSON. Writing the fields out avoids unused destructured names, which this project's eslint config flags.)

- [ ] **Step 4: New boxes copy the box before them.** In `DiagramBoxCount`, change the comment and `onChange`:

```tsx
// How many boxes. Adding boxes keeps the old ones; new ones are named by `newText` and look like the last box.
```

```tsx
      onChange={(count) =>
        onChange(Array.from({ length: count }, (_, i) => items[i] ?? { ...lookOf(items[items.length - 1]), text: newText(i) }))
      }
```

In `TreeControls`, the Add box button:

```tsx
                <TreeAddButton
                  label="Add box"
                  onClick={() => setBranch(i, { leaves: [...branch.leaves, { ...lookOf(branch.leaves.at(-1) ?? branch.label), text: "Item" }] })}
                />
```

and the Add branch button:

```tsx
            onClick={() =>
              set({ branches: [...tree.branches, { label: { ...lookOf(tree.branches.at(-1)?.label), text: "Group" }, leaves: [] }] })
            }
```

(Reset buttons are unchanged: they already put the defaults back, which have no look.)

- [ ] **Step 5: Check**

Run: `npx tsc --noEmit` — Expected: no errors.
Run: `npx eslint src/components/editor/DiagramBoxEditor.tsx src/components/editor/MathToolPanels.tsx` — Expected: no errors.

---

### Task 3: The Color panel paints box background, border and text

**Files:**
- Modify: `src/lib/store.ts:446-449` (type), `:1393`, `:1403-1404` (no change needed to logic, only types)
- Modify: `src/components/editor/ColorPanel.tsx:1-12` (imports), `:71-145` (logic), `:150` (title)

**Interfaces:**
- Consumes: `getDiagramBoxes`, `diagramStyleTargets`, `withDiagramBoxStyle`, `DIAGRAM_NONE` (Task 1).
- Produces: `export type ColorPanelTarget = "fill" | "border" | "boxFill" | "boxBorder" | "boxText"` in `store.ts`; `openColorPanelOn(target: ColorPanelTarget)`.

- [ ] **Step 1: Widen the target type in `store.ts`.** Above the store's state interface (near the other exported types at the top of the file) add:

```ts
// Which part the Color panel paints: an element's fill (or a shape box's), a border (shape box or
// squares/rectangles), or a diagram box's background, border or text (the picked box, or every box).
export type ColorPanelTarget = "fill" | "border" | "boxFill" | "boxBorder" | "boxText";
```

and change the two declarations to:

```ts
  // Which part the Color panel paints (see ColorPanelTarget).
  colorPanelTarget: ColorPanelTarget;
  // Opens the Color panel on that part; clicking the same one again closes it.
  openColorPanelOn: (target: ColorPanelTarget) => void;
```

- [ ] **Step 2: Box targets in `ColorPanel.tsx`.** Imports:

```ts
import { diagramStyleTargets, getDiagramBoxes, getElementAsset, withDiagramBoxStyle } from "@/lib/svgLibrary";
import { BORDER_WIDTH_DEFAULT, BORDER_WIDTH_MAX, DIAGRAM_NONE, GRADIENT_PREFIX, SIDE_CONTAINER_ID } from "@/lib/constants";
```

Above `export function ColorPanel()`:

```ts
// The diagram box field each box target paints, and the panel's title for it.
const BOX_STYLE = {
  boxFill: { key: "fill", title: "Box background" },
  boxBorder: { key: "border", title: "Box border" },
  boxText: { key: "textColor", title: "Box text" },
} as const;
```

Inside the component, add with the other store reads:

```ts
  const updateElement = useEditorStore((s) => s.updateElement);
  const pickedDiagramBox = useEditorStore((s) => s.pickedDiagramBox);
```

Replace the `boxTarget` line with (only "fill" / "border" paint the shape box):

```ts
  const boxTarget =
    !textEditor &&
    elements.length === 0 &&
    selectedContainerId === SIDE_CONTAINER_ID &&
    (colorPanelTarget === "fill" || colorPanelTarget === "border")
      ? colorPanelTarget
      : null;
```

Right after `boxColor`, add:

```ts
  // One diagram selected and the panel opened on a box swatch: it paints the picked box, or every box.
  const diagramElement = !textEditor && elements.length === 1 ? elements[0] : null;
  const diagram = diagramElement ? getDiagramBoxes(diagramElement.assetId, diagramElement) : null;
  const boxStyle = diagram && colorPanelTarget in BOX_STYLE ? BOX_STYLE[colorPanelTarget as keyof typeof BOX_STYLE] : null;
  const styleTargets =
    diagram && diagramElement
      ? diagramStyleTargets(diagram, pickedDiagramBox?.elementId === diagramElement.id ? pickedDiagramBox.path : undefined)
      : [];
  const boxStyleColor = boxStyle ? styleTargets[0]?.item[boxStyle.key] : undefined;
```

Change `hasNone` and `noneSelected`:

```ts
  // Box text has no "none": text always needs a color.
  const hasNone = !!boxTarget || isShapeBorder || (!!boxStyle && boxStyle.key !== "textColor");
  const noneSelected = boxStyle
    ? boxStyleColor === DIAGRAM_NONE
    : isShapeBorder
      ? shapeBorderColor === undefined
      : boxColor === undefined;
```

In `commonColor`, add a branch right after the `textEditor` one:

```ts
    : boxStyle
      ? boxStyleColor && boxStyleColor !== DIAGRAM_NONE ? boxStyleColor : null
```

(so the chain reads `textEditor ? … : boxStyle ? … : boxTarget ? … : isShapeBorder ? … : …`).

In `handleColor`, add right after the `textEditor` line:

```ts
    else if (boxStyle && diagram && diagramElement)
      updateElement(selectedSlideId, diagramElement.id, withDiagramBoxStyle(diagram, styleTargets, { [boxStyle.key]: color ?? DIAGRAM_NONE }));
```

Change `allowGradients` so boxes are solid only:

```ts
  const allowGradients =
    boxTarget === "fill" ||
    (!boxTarget && !boxStyle && !isShapeBorder && !textEditor && !elements.some((el) => getElementAsset(el.assetId)?.isTextBox));
```

and the title:

```tsx
          {boxStyle ? boxStyle.title : boxTarget === "fill" ? "Box fill" : boxTarget === "border" ? "Box border" : isShapeBorder ? "Border" : "Color"}
```

- [ ] **Step 3: Check**

Run: `npx tsc --noEmit` — Expected: no errors (if `updateElement` was already read in this component, don't add it twice).
Run: `npx eslint src/lib/store.ts src/components/editor/ColorPanel.tsx` — Expected: no errors.

---

### Task 4: Box style group on the toolbar

**Files:**
- Modify: `src/components/editor/TextFormatToolbar.tsx:18-60` (use the new picker props), `:150-205` (`FontSizePicker`)
- Modify: `src/components/editor/SelectedElementToolbar.tsx` (imports, hooks, logic, JSX after the Color block ~line 222)

**Interfaces:**
- Consumes: `getDiagramBoxes`, `diagramStyleTargets`, `withDiagramBoxStyle`, `DiagramBoxStyle`, `DIAGRAM_TEXT_COLOR` (svgLibrary); `DIAGRAM_FONT_SIZE`, `DIAGRAM_FONT_SIZES`, `DIAGRAM_NONE` (constants); `openColorPanelOn("boxFill" | "boxBorder" | "boxText")` (Task 3).
- Produces: `export function FontSizePicker({ size, sizes, onChoose }: { size: number; sizes: number[]; onChoose: (size: number) => void })` in `TextFormatToolbar.tsx`.

- [ ] **Step 1: Make `FontSizePicker` reusable.** In `TextFormatToolbar.tsx`, replace the `FontSizePicker` comment, signature and first lines with:

```tsx
/**
 * − / size / + with a list of `sizes`. The size is the largest the text gets: it still shrinks to fit
 * its box when it's too long. Used by the text toolbar and by diagram boxes.
 */
export function FontSizePicker({ size, sizes, onChoose }: { size: number; sizes: number[]; onChoose: (size: number) => void }) {
  const [isListOpen, setIsListOpen] = useState(false);

  const smaller = sizes.findLast((option) => option < size);
  const bigger = sizes.find((option) => option > size);
  const choose = (next: number | undefined) => {
    if (next !== undefined) onChoose(next);
    setIsListOpen(false);
  };
```

and in its list replace `{FONT_SIZES.map((option) => (` with `{sizes.map((option) => (`. Keep the rest of its JSX.

In `TextFormatToolbar`, add next to the other store reads:

```ts
  const targets = texts.map((text) => text.target);
  // The texts all get the same size, stepping from the first one's.
  const fontSize = useEditorStore((s) => chosenFontSize(s.presentation, targets[0]));
  const setTextFontSizes = useEditorStore((s) => s.setTextFontSizes);
```

and replace `<FontSizePicker targets={texts.map((text) => text.target)} />` with:

```tsx
      {fontSize !== null && <FontSizePicker size={fontSize} sizes={FONT_SIZES} onChoose={(size) => setTextFontSizes(targets, size)} />}
```

- [ ] **Step 2: Toolbar logic in `SelectedElementToolbar.tsx`.** Imports:

```ts
import { canCrop, getElementAsset, DEFAULT_CLOCK_TIME, DIAGRAM_TEXT_COLOR, diagramStyleTargets, getDiagramBoxes, withDiagramBoxStyle, type DiagramBoxStyle } from "@/lib/svgLibrary";
import { CORNER_RADIUS_MAX, DIAGRAM_FONT_SIZE, DIAGRAM_FONT_SIZES, DIAGRAM_NONE, getContainerBounds, GRADIENT_PREFIX, OPACITY_MIN } from "@/lib/constants";
import { FontSizePicker } from "./TextFormatToolbar";
```

Widen the `outline` helper's parameter type to `ColorPanelTarget` (import `type ColorPanelTarget` from `@/lib/store`).

Add with the other store reads (before the `if (elements.length === 0) return null;`):

```ts
  const pickedDiagramBox = useEditorStore((s) => s.pickedDiagramBox);
```

After the clock block, add:

```ts
  // Box style is offered when exactly one diagram is selected: for its picked box, or every box.
  const diagramElement = elements.length === 1 ? elements[0] : null;
  const diagram = diagramElement ? getDiagramBoxes(diagramElement.assetId, diagramElement) : null;
  const styleTargets =
    diagram && diagramElement
      ? diagramStyleTargets(diagram, pickedDiagramBox?.elementId === diagramElement.id ? pickedDiagramBox.path : undefined)
      : [];
  const firstBox = styleTargets[0]?.item;
  const setBoxStyle = (style: DiagramBoxStyle) =>
    diagram && diagramElement && updateElement(selectedSlideId, diagramElement.id, withDiagramBoxStyle(diagram, styleTargets, style));
```

Above the component (next to `MIXED_COLOR_SWATCH`), add:

```ts
// A diagram box border swatch: "none", a ring in its color, or (unset) the diagram's Color it uses.
// A gradient Color can't be a ring, so it shows as a filled circle.
function borderSwatch(border: string | undefined, diagramColor: string): React.CSSProperties {
  if (border === DIAGRAM_NONE) return { background: NONE_SWATCH, border: "1px solid var(--border-default)" };
  const color = border ?? diagramColor;
  return color.startsWith(GRADIENT_PREFIX) ? { background: toCssBackground(color) } : { border: `4px solid ${color}` };
}
```

- [ ] **Step 3: Toolbar JSX.** Right after the closing `)}` of the `{showColor && !elements.every((el) => el.image) && ( … )}` block, add:

```tsx
      {/* A diagram's box look: the picked box, or all boxes when none is picked. */}
      {diagramElement && firstBox && (
        <>
          <span className="text-xs font-medium text-text-secondary">{styleTargets.length === 1 ? "This box" : "All boxes"}</span>
          <button
            type="button"
            title="Box background"
            onClick={() => openColorPanelOn("boxFill")}
            className="h-6 w-6 shrink-0 rounded-full border border-border-default"
            style={{
              background:
                firstBox.fill === DIAGRAM_NONE ? NONE_SWATCH : firstBox.fill ?? toCssBackground(diagramElement.color),
              ...outline("boxFill"),
            }}
          />
          <button
            type="button"
            title="Box border"
            onClick={() => openColorPanelOn("boxBorder")}
            className="h-6 w-6 shrink-0 rounded-full"
            style={{ ...borderSwatch(firstBox.border, diagramElement.color), ...outline("boxBorder") }}
          />
          <button
            type="button"
            title="Box text color"
            onClick={() => openColorPanelOn("boxText")}
            className="h-6 w-6 shrink-0 rounded-full border border-border-default"
            style={{ background: firstBox.textColor ?? DIAGRAM_TEXT_COLOR, ...outline("boxText") }}
          />
          <FontSizePicker
            size={firstBox.fontSize ?? DIAGRAM_FONT_SIZE.default}
            sizes={DIAGRAM_FONT_SIZES}
            onChoose={(fontSize) => setBoxStyle({ fontSize })}
          />
          <div className="mx-1 h-5 w-px bg-border-default" />
        </>
      )}
```

- [ ] **Step 4: Check**

Run: `npx tsc --noEmit` — Expected: no errors.
Run: `npx eslint src/components/editor/TextFormatToolbar.tsx src/components/editor/SelectedElementToolbar.tsx` — Expected: no errors.

---

### Task 5: Docs and the final check

**Files:**
- Modify: `CLAUDE.md` (the "Diagrams" section)
- Modify: `docs/superpowers/specs/2026-10-06-diagram-box-drag-design.md` ("Saved data" and "History")
- Modify: `docs/superpowers/specs/2026-10-07-diagram-box-style-design.md` (the `store.ts` row of the code table)

- [ ] **Step 1: `CLAUDE.md`.** In "# Diagrams", after the "A box's own place and size" bullet, add:

```md
- **A box's own look** (`fill`, `border`, `textColor`, `fontSize`) is optional; missing = the diagram's Color tint and border, dark text, size 12. The toolbar's box style group and the Color panel (`boxFill` / `boxBorder` / `boxText`) change the picked box, or every box when none is picked, through `diagramStyleTargets` + `withDiagramBoxStyle`. Moving, Tidy up and new boxes keep or copy the look. Spec: `docs/superpowers/specs/2026-10-07-diagram-box-style-design.md`.
```

- [ ] **Step 2: Older diagram spec.** In "Saved data" change the box shape line to
`Each box is { text, x?, y?, width?, height?, fill?, border?, textColor?, fontSize? } in drawing units (the diagram's viewBox units):`
and add to "History":
`5. Box background, border, text color and text size (spec: 2026-10-07-diagram-box-style-design.md).`

- [ ] **Step 3: New spec's code table.** Replace the `src/lib/store.ts` row with:

```md
| `src/lib/store.ts` | `colorPanelTarget` gains `"boxFill" \| "boxBorder" \| "boxText"` (`ColorPanelTarget`) |
| `src/lib/svgLibrary.tsx` (helpers) | `diagramStyleTargets` (picked box or all) and `withDiagramBoxStyle` (the element change), used by the toolbar and the Color panel |
```

and add a row: ``| `src/components/editor/DiagramBoxEditor.tsx` | dragging keeps the box's look |`` (merge with the existing DiagramBoxEditor row).

- [ ] **Step 4: Final check (CLAUDE.md checking step)**

Run: `npx tsc --noEmit` — Expected: no errors.
Run: `npm run lint` — Expected: no errors in the changed files.
Run: `git diff` and read it next to this plan and the spec: every task done; nothing extra; zod checks the new fields; design system classes only; no new spinner, packages, or icons outside Lucide.

- [ ] **Step 5: Report** to the user what was checked and what passed or failed, and list the live checks for them (the five Review Focus items, plus: change each control with the whole diagram selected, then with one box picked; Undo after each; Tidy up; add a box; type in a box with a custom size and color).
