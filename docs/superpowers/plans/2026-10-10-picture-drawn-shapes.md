# Picture Drawn Shapes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pictures from Claude's import get a box that fits their real drawing, so words, callouts and the report match what the teacher sees.

**Architecture:** A development-only page measures every trimmable library drawing with the editor's own `ElementSvg` `onMeasure` and downloads `src/lib/assetShapes.json` (asset id → `[width, height]`). `importPresentation.ts` reads that table: it fits each picture's box to its drawing (same math as the editor's `fitBoxToDrawing`), works out callouts from the fitted box, and starts app-placed pictures from the drawing's shape.

**Tech Stack:** Next.js 16 app router, React 19, TypeScript. No new package.

**Spec:** `docs/superpowers/specs/2026-10-10-picture-drawn-shapes-design.md`

## Global Constraints

- No new package.
- The page works only when `process.env.NODE_ENV === "development"`; otherwise `notFound()`.
- Waiting shows the one `Spinner` (`src/components/Spinner.tsx`); the button uses the design system's main button classes.
- Fit math is identical to `fitBoxToDrawing` in `SvgElementItem.tsx`, with `TRIM_PADDING` (2px) on every side.
- An asset missing from the table, a cropped picture, a photo or a custom `svg` drawing works as today.
- The project has no test runner: each task is checked with `npx tsc --noEmit` (with `NODE_OPTIONS=--max-old-space-size=8192`) and `npx eslint` on the changed files.

## Review Focus

- Text-drawn pictures (numbers, letters) measured before the fonts load: the page must wait for `document.fonts.ready` before drawing.
- People art (School Boy, students) loads separately: the page must wait for `loadPeopleArt()` before drawing them.
- A drawing so thin that fitting would go under `MIN_ELEMENT_SIZE`: keep the unfitted box, as the editor does.
- `assetShapes.json` empty (`{}`) before the page is first run: the import must behave exactly as before.
- A flipped or rotated picture: fitting doesn't depend on flip/rotation (same as the editor).

---

### Task 1: The measuring page and an empty table

**Files:**
- Create: `src/lib/assetShapes.json` (`{}` until the page is run)
- Create: `src/app/dev/asset-shapes/page.tsx` (server: dev-only gate)
- Create: `src/app/dev/asset-shapes/AssetShapes.tsx` (client: measures and downloads)

**Interfaces:**
- Produces: `src/lib/assetShapes.json` — `Record<string, [number, number]>`, drawing units, 1 decimal.

- [ ] **Step 1:** Create `src/lib/assetShapes.json` with `{}`.
- [ ] **Step 2:** `page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { AssetShapes } from "./AssetShapes";

/** Development only: measures every library drawing's real shape for Claude's import (see assetShapes.json). */
export default function AssetShapesPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <AssetShapes />;
}
```

- [ ] **Step 3:** `AssetShapes.tsx`: wait for `document.fonts.ready` and `loadPeopleArt()`, then draw every asset whose drawing the editor trims (same rule as `canTrim` in `ElementSvg.tsx`) in a 120×120 box with `onMeasure` storing `[round1(w), round1(h)]` by id. Show `Spinner` + "n of total measured" until all are in, then a main button that downloads the JSON (keys sorted) as `assetShapes.json`.
- [ ] **Step 4:** tsc + eslint on the new files.
- [ ] **Step 5:** Commit.

### Task 2: The import uses the table

**Files:**
- Modify: `src/lib/importPresentation.ts` (position pictures ~line 1044, app-placed pictures ~line 1060 and ~1103, `startSize` ~line 1690, instructions ~line 750)

**Interfaces:**
- Consumes: `assetShapes.json`, `TRIM_PADDING` (move to `src/lib/constants.ts` so the server code doesn't import a client component; `ElementSvg.tsx` re-imports it from there).
- Produces: `drawnShape(assetId: string, settings: Partial<SvgElement>): Size | null` and `fitToDrawing(rect: Rect, shape: Size | null): Rect`.

- [ ] **Step 1:** Move `TRIM_PADDING` to `constants.ts`; update its imports.
- [ ] **Step 2:** Add the helpers:

```ts
import ASSET_SHAPES from "./assetShapes.json";

/** The drawing's real shape (measured ahead of time, see /dev/asset-shapes), or null to keep the box as given. */
function drawnShape(assetId: string, settings: Partial<SvgElement>): Size | null {
  if (settings.crop || settings.image || settings.svg) return null;
  const shape = (ASSET_SHAPES as Record<string, [number, number]>)[assetId];
  return shape ? { width: shape[0], height: shape[1] } : null;
}

/** The box shrunk to the drawing's shape, centered, with the editor's 2px gap — like fitBoxToDrawing. */
function fitToDrawing(rect: Rect, shape: Size | null): Rect {
  if (!shape) return rect;
  const pad = TRIM_PADDING * 2;
  const scale = Math.min((rect.width - pad) / shape.width, (rect.height - pad) / shape.height);
  const width = shape.width * scale + pad;
  const height = shape.height * scale + pad;
  if (width < MIN_ELEMENT_SIZE || height < MIN_ELEMENT_SIZE) return rect;
  return { x: rect.x + (rect.width - width) / 2, y: rect.y + (rect.height - height) / 2, width, height };
}
```

- [ ] **Step 3:** Position pictures: `const picture = fitToDrawing(fitInBox(...), drawnShape(el.asset, settings))`; when it differs from what Claude asked by more than 2px, the note says it was fitted to its drawing's shape and gives the new box ("Place its words and labels by that.").
- [ ] **Step 4:** App-placed pictures: `startSize` takes `drawnShape(asset.id, settings)` before `defaultSize`/square; the placed `picture` goes through `fitToDrawing` before callouts are made. Update the `MIN_SIZE_BASE` comment.
- [ ] **Step 5:** One sentence in the instructions' "Pictures" part about fitting and the report's real box.
- [ ] **Step 6:** tsc + eslint; commit.

### Task 3: Note in CLAUDE.md, run the page, commit the table

- [ ] **Step 1:** A short "Picture shapes" note in `CLAUDE.md`: rerun `/dev/asset-shapes` after adding or changing library art, and commit the file.
- [ ] **Step 2:** The user runs the page once on `npm run dev` and puts the downloaded file in `src/lib/` (live testing is theirs).
- [ ] **Step 3:** Commit.
