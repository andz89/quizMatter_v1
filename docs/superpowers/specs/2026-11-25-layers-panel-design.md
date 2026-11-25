# Layers panel (see every element on a slide, like Canva)

## Why

A teacher's slide gets crowded, and a small item can hide behind a big picture where it can't be clicked. They want
to see everything on the slide in one list, pick any item from it (even a hidden one), drag rows to change which item
is on top, and see which items are grouped.

## Goals

- A **Layers** button in the left icon bar opens a side panel (the same 320 px `side-panel` as the others; only one
  panel is open at a time). It lists the elements of the **selected slide**.
- Rows are split by box, because elements only overlap inside their own box (`containerId`), and `moveInLayers`
  already orders each box on its own: "On the slide" (free), "Question", "Answer A"–"D", "Shape box", "Answer"
  (a short-answer / custom slide's drawn answer). A box with no elements isn't shown. If the slide has no elements,
  the panel says so.
- Inside a box, the **top layer is first** (the last element in `slide.elements` = drawn on top).
- Each row: a small picture of the element (`ElementSvg`; a text box shows a text icon, a table a table icon, a
  photo its picture) and a name: the asset's `label`; a text box shows its first words; a photo "Photo"; a drawing
  "Drawing".
- **Groups** are one row ("Group · 3 items") with a ▸ to open it and see its members, indented under it.
- **Click** a row = select it on the slide (a group row selects the whole group, a member row only that member,
  like double-click on the slide). Shift / Ctrl / Cmd + click adds or removes it. Selected rows are violet
  (`bg-accent-soft`).
- **Hover** a row = a violet outline on that element on the slide, so the teacher sees which one it is.
- **Drag** a row (or a group row) up or down inside its box to change the order; one undo step, saved like any
  other edit (it only reorders `slide.elements`). A group member can be dragged only among its own group's members.
  Rows can't be dragged into another box (moving into a box changes its position too: that stays drag-on-slide).

## Non-goals

- No hide / lock per element (new saved fields; can come later).
- No renaming elements (no saved name field).
- Dragging a covered element's body on the slide stays as it is: once picked from the list, its handles (already
  drawn above everything), arrow keys, the toolbar and Arrange all work on it.
- Embed slides (video, deck, picture) have no elements: the panel says so.

## Approaches

1. **A side panel from the left icon bar (picked).** Always reachable, even with nothing selected, which is the
   point (finding hidden items). Fits the editor's existing panels and their open/close rules.
2. A "Layers" tab inside the Arrange drop-down (Canva's Position → Layers). Only opens when something is already
   selected, so it can't help find a hidden item. Dropped.
3. A floating list over the slide. Covers the slide being edited, and adds a second kind of panel. Dropped.

## How (builder's calls)

- `src/lib/layers.ts` (pure, tested in `layers.test.ts`): `layerRows(elements)` builds the rows per box (groups
  folded), and `moveLayer(elements, movingIds, targetId, place)` puts the moving block just above or below the
  target's block inside the same box (returns the same array when nothing changes), like `moveInLayers`.
- Store: `isLayersPanelOpen` / `toggleLayersPanel` / `closeLayersPanel` (closing the other panels, and they close
  it), `hoveredLayerIds` (not saved, not in undo) and `reorderLayers(slideId, movingIds, targetId, place)`.
- `LayersPanel.tsx` uses `@dnd-kit` (already used for slides and options): one `SortableContext` per box, and one
  per open group.
- `SvgElementItem`'s selection part draws the hover outline.
- Notes in `src/components/editor/CLAUDE.md`. No database, schema, `DATA_VERSION` or Privacy Policy change.
