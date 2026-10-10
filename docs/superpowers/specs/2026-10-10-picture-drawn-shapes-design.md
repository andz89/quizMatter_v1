# Pictures from Claude fill the box they're given

## The problem

Every drawing in the element library sits inside its own drawing area (its viewBox), usually with empty
space around it. The editor trims that space: it measures the drawing in the browser and shrinks the
element's box to the drawing's real shape (`fitBoxToDrawing` in `SvgElementItem.tsx`, from `onMeasure` in
`ElementSvg.tsx`).

Claude's import (`importPresentation.ts`) runs on the server, where nothing can be measured. So when Claude
gives a picture a box ("position"), the drawing only fills part of it:

- A ribbon in a 600×300 box is drawn about 600×156 in its middle. Claude puts the words in a text box sized
  for the 600×300 box, so they can run past the ribbon's band.
- Callout arrows are aimed at the edges of the 600×300 box, so they stop far from the drawing.
- When the teacher opens the slide, the editor then shrinks the box to the drawing, so the layout Claude
  checked in its report is not the one the teacher sees.

## The idea

Measure every drawing's real shape once, ahead of time, and keep the results in a file in the code. The
import uses that file to give each picture a box that fits its drawing, just like the editor would.

## Parts

### 1. The shape table: `src/lib/assetShapes.json`

A JSON object: asset id → `[width, height]` of the drawing's real shape, in drawing units, lines included,
which is exactly what `onMeasure` reports. Only the shape (width to height) matters, because a fitted
drawing always sits in the middle of its box.

```json
{ "ribbon-banner": [196.4, 51.2], "fruit-apple": [80.1, 88.6] }
```

Only drawings the editor trims are in it (the ones where `ElementSvg` calls `onMeasure`). Drawings whose
shape changes with their settings (3D solids, clocks, number lines, math tools, diagrams) and the text box
are not trimmed in the editor either, so they are left out and work as they do today.

### 2. The measuring page: `src/app/dev/asset-shapes/page.tsx` (development only)

A page that works only on `npm run dev`. Anywhere else it shows "not found" (`notFound()` when
`process.env.NODE_ENV !== "development"`), so it never appears in the live app.

- It draws every library asset once with `<ElementSvg onMeasure={…}>`: the same component and the same
  measuring code as the editor, with the app's fonts loaded. Each drawing sits in a small square box
  (e.g. 120×120), hidden from view.
- While drawings are still being measured (the people art loads separately), it shows the one `Spinner`
  and how many are done.
- Then a main button, "Download assetShapes.json", saves the table (numbers rounded to 1 decimal). The
  file goes into `src/lib/`, replacing the old one.

**When to run it:** after adding or changing library art. Steps: `npm run dev`, open
`/dev/asset-shapes`, download, put the file in `src/lib/`, commit. A short note about this goes in
`CLAUDE.md`.

No new package is needed.

> **Change from what was discussed:** the first idea was a script using the `@resvg/resvg-js` package.
> The page does the same job with no new package, and it measures with the editor's own code and fonts,
> so number and letter pictures (drawn as text) come out right too. resvg would need the font files
> loaded on its own, and a second package to run the app's TSX files.

### 3. The import uses the table (`importPresentation.ts`)

One small helper, `drawnShape(asset, settings)`: the table's shape for this asset, or `null` when the
asset isn't in it, the picture is cropped, or it's a photo or a custom drawing (`svg`). `null` means "do
as today".

**a. Pictures Claude places itself ("position").** After `fitInBox`, the box is fitted to the drawing's
shape: as big as fits inside Claude's box, centered, with the editor's 2px gap (`TRIM_PADDING`) on each
side. It's the same math as `fitBoxToDrawing`, so the editor finds nothing left to change when the slide
opens. If the box changed by more than a few px, the report gets a note, e.g.:

> element 2 (ribbon-banner) was fitted to its drawing's shape: 0,72 600×156 instead of 0,0 600×300. Place
> its words and labels by that.

**b. Callouts** are worked out from the fitted box (they already use the picture's box; now it's the
real one), so the arrows end 6px from the drawing as intended.

**c. Pictures the app places itself.** `startSize` takes the drawing's shape from the table instead of
`defaultSize` or a square. The height still comes from the size (small/medium/large × box height), so a
"large" picture now really is about 85% of the box's height, where before its drawing was often smaller
than its box. Pictures may look a little bigger than before, and wide drawings take more width. The
existing shrink-to-fit in `placeInBox` still keeps everything inside the box. The comment on
`MIN_SIZE_BASE` (which mentions drawings only filling part of their square) is updated.

**d. Claude's instructions.** One sentence in the "Pictures" part: the app fits each picture to its
drawing's real shape, centered in the box Claude gives, and the report shows the real box, so Claude
should place words and callout labels by the report's numbers. The ribbon guidance (put the words in a text
box over the ribbon's middle) stays, and now lines up with the report.

## What doesn't change

- The editor, the presenting view and saved slides: nothing changes there. Slides made before this change
  stay as they are.
- Photos, cropped pictures, custom `svg` drawings and the shape-changing assets above: as today.
- No database or zod schema change: the fitted box is an ordinary `x, y, width, height`, already checked
  by the element schema before saving.

## Checking

- `npx tsc --noEmit` and `npm run lint` pass.
- The user tries it live: run the page once and commit the table, then ask Claude for a slide with a ribbon
  title and a picture with callouts. The words should sit on the band, the arrows should end next to the
  drawing, and opening the slide in the editor should not move or resize anything.
