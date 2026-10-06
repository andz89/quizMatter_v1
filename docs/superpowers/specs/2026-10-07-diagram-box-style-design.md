# Diagram boxes: background, border, text color and text size

Date: 2026-10-07

Builds on `2026-10-06-diagram-box-drag-design.md` (boxes already work like text boxes: own size,
shrink-to-fit text, handles, typing on the slide).

## What it is

The teacher can change four things on diagram boxes (Flowchart, Cycle, Mind Map, Tree):

| Thing | Choices |
|---|---|
| Background | Solid colors, or **None** (see-through) |
| Border | Solid colors, or **None** |
| Text color | Solid colors |
| Text size | 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36 (drawing units; 12 = today's size) |

No gradients: boxes, borders and text are solid colors only.

## Which boxes change

- **Whole diagram selected** (no box picked): a change goes to **every box** of the diagram.
- **One box picked** (click a box inside the selected diagram): a change goes to **that box only**.
- A short label in the toolbar says which: **"All boxes"** or **"This box"**.
- When the boxes differ, the swatches and the size show the **first box's** look (like the text toolbar).

## Text size, like a text box

The chosen size is the **biggest** the text gets. When the text doesn't fit the box at that size, it
still shrinks to fit (down to 1), exactly like today with 12. A bigger box doesn't make the text bigger.

## The toolbar

When a diagram is selected, `SelectedElementToolbar` shows a **box style** group:

- **"All boxes" / "This box"** label
- **Background** swatch (shows "none" pattern when see-through)
- **Border** swatch (a ring in the border color, or "none")
- **Text color** swatch
- **Text size** `− size +` with its list: the text box's `FontSizePicker`, reused

The three swatches open the existing `ColorPanel`, which then paints the picked box, or all boxes.
Its title says "Box background", "Box border" or "Box text". Background and Border get the **None**
swatch; Text color doesn't.

The diagram's main **Color** button stays as it is. It is the default for any box with no color of its
own (light tint fill, Color border), and it still colors the mind map and tree lines. The flowchart and
cycle arrows stay dark (`DIAGRAM_TEXT_COLOR`).

## How a box is drawn

`DiagramBox` in `svgLibrary.tsx`:

- **Background:** the box's `fill` if set (`"none"` = no fill at all), else today's white + tint of the
  element Color (stronger for the mind map's main idea and the tree's top box).
- **Border:** the box's `border` if set (`"none"` = no border), else the element Color. Width stays 2.
- **Text:** the box's `textColor` if set, else `DIAGRAM_TEXT_COLOR`.
- **Size:** `fitDiagramText` starts from the box's `fontSize` (else 12) instead of the fixed 12.

The typing area (`DiagramTextArea` in `DiagramBoxEditor.tsx`) uses the same text color and fitted
size, so typing looks like the drawing.

## Saved data

Each box gains four optional fields:

```
{ text, x?, y?, width?, height?, fill?, border?, textColor?, fontSize? }
```

- Missing = today's look (see "How a box is drawn").
- `fill` and `border`: a `#RRGGBB` color or `"none"`. `textColor`: a `#RRGGBB` color.
- `fontSize`: a number in `DIAGRAM_FONT_SIZE` (`{ min: 6, max: 36 }`), in `constants.ts`.
- The size list (`DIAGRAM_FONT_SIZES`) also lives in `constants.ts`.
- Checked by `diagramBoxSchema` (zod) in `schema.ts` before saving, like every other field.
- No database migration: diagram settings are saved inside the element's JSON.

## Other behavior

- **Adding a box** (the box-count slider, or the Tree's + Add box / + Add branch): the new box copies
  `fill`, `border`, `textColor` and `fontSize` from the box before it (not its place or size), so a
  styled diagram stays matching.
- **Tidy up:** resets place and size only; colors and size are kept.
- **Reset:** everything back to the start, colors and size included.
- **Undo:** each change is one undo step (it goes through `updateElements`, like the Color button).
- **Claude (JSON import / MCP):** unchanged. Claude adds `{ "text": … }` boxes only and doesn't send
  the new fields.

## Where the code changes

| File | Change |
|---|---|
| `src/lib/constants.ts` | `DIAGRAM_FONT_SIZE`, `DIAGRAM_FONT_SIZES` |
| `src/lib/schema.ts` | the four new fields on `diagramBoxSchema` |
| `src/lib/svgLibrary.tsx` | `DiagramBox` and `fitDiagramText` use the box's look; `DIAGRAM_FONT.normal` becomes the default only |
| `src/lib/store.ts` | `colorPanelTarget` gains `"boxFill" \| "boxBorder" \| "boxText"`; one action that writes style fields to the picked box or all boxes |
| `src/components/editor/ColorPanel.tsx` | paints the box targets (None for background/border, solid only) |
| `src/components/editor/SelectedElementToolbar.tsx` | the box style group |
| `src/components/editor/TextFormatToolbar.tsx` | `FontSizePicker` takes `size`, `sizes` and `onChoose`, so the diagram can reuse it |
| `src/components/editor/DiagramBoxEditor.tsx` | typing area uses the box's text color and size |
| `src/components/editor/MathToolPanels.tsx` | new boxes copy the look; Tidy up keeps it |

No new packages. Everything uses the design system classes and Lucide icons.

## Not in scope

- Gradients for boxes, borders or text
- Bold / italic / alignment inside boxes
- Border thickness
- Coloring the flowchart and cycle arrows
- Claude setting box styles
