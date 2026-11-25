# Layers Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Layers side panel that lists the selected slide's elements per box, top layer first, with groups,
click to select, hover to outline, and drag to reorder.

**Architecture:** Pure row-building and reorder helpers in `src/lib/layers.ts` (tested); store gets the panel's
open state, a hover list and a `reorderLayers` action; `LayersPanel.tsx` draws the list with `@dnd-kit`.

**Tech Stack:** Next.js, React, zustand, `@dnd-kit/core` + `@dnd-kit/sortable` (already installed), lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-25-layers-panel-design.md`

## Global Constraints

- Design system only (`side-panel`, `bg-accent-soft`, `rounded-dropdown`, Lucide icons with `size`).
- No saved-shape change: only the order of `slide.elements` changes. No migration, no `DATA_VERSION`.
- One undo step per drag (a normal `set({ presentation })`).
- Notes updated in `src/components/editor/CLAUDE.md` in the same commit.

## Review Focus

- A drag dropped on its own row or outside the list changes nothing (no undo step): `moveLayer` returns the same array.
- A group dragged past another group lands whole, never between that group's members.
- A member dragged onto a row outside its group does nothing.
- Elements removed / slide switched while the panel is open: rows come from the store, hover ids are cleared on leave.
- An embed slide or a slide with no elements: "Nothing on this slide yet" text, no crash.

---

### Task 1: `layers.ts` helpers

**Files:** Create `src/lib/layers.ts`, `src/lib/layers.test.ts`

**Interfaces (Produces):**
```ts
export type LayerItem = { kind: "element"; element: SvgElement } | { kind: "group"; groupId: string; members: SvgElement[] /* top first */ };
export type LayerBox = { containerId: string | null; items: LayerItem[] /* top first */ };
export function layerBoxes(elements: SvgElement[]): LayerBox[]; // boxes in first-seen order of slide.elements, free (null) first
export function moveLayer(elements: SvgElement[], movingIds: string[], targetId: string, place: "above" | "below"): SvgElement[];
```
`moveLayer`: moving block = `movingIds` (caller passes a whole group, or one member). Target block = target's whole
group when the moving block isn't inside that same group, else just the target. Refuse (return `elements`) when
target is in the block, another box, or (moving one member) outside the member's group. "above" = drawn on top of
the target = later in the array. Returns `elements` itself when the order is unchanged.

- [ ] Tests: `layerBoxes` orders top first and folds groups; `moveLayer` moves above/below, keeps groups whole when
  stepping past one, refuses another box / outside-group member / own row, returns same array when unchanged.
- [ ] Run `npm test` → fail; implement; run → pass.

### Task 2: Store

**Files:** Modify `src/lib/store.ts`

**Produces:** `isLayersPanelOpen`, `toggleLayersPanel()`, `closeLayersPanel()`, `hoveredLayerIds: string[]`,
`setHoveredLayerIds(ids: string[])`, `reorderLayers(slideId, movingIds, targetId, place)`. Every other panel's
toggle closes Layers; Layers' toggle closes them. `hoveredLayerIds` is not in history.

### Task 3: Panel + rail + hover outline

**Files:** Create `src/components/editor/LayersPanel.tsx`; modify `IconRail.tsx` (`LayersIcon`), `Editor.tsx`,
`SvgElementItem.tsx` (selection part: `1.5px solid var(--accent)` outline when hovered and not selected).

- Box titles: null "On the slide", `question` "Question", option ids "Answer A–D" (by `getShownOptions` index),
  `side` "Shape box", `answer` "Answer".
- Row name: text box → its plain text (first 40 letters, "Text box" if empty); table "Table"; `PHOTO_ID` "Photo";
  `CUSTOM_SVG_ID` "Drawing"; else asset `label`. Picture: `ElementSvg` in a 32 px tile (text box / table: Lucide
  `TypeIcon` / `TableIcon`).
- Click: group row `selectElement(slideId, firstMemberId)`; member row `selectElements([id])`; Shift/Ctrl/Cmd:
  `selectElement(..., true)`.
- Escape closes (`isPanelEscape`), `data-keep-container-selection="true"` on the panel.

### Task 4: Notes, checks, browser test

- `src/components/editor/CLAUDE.md`: a "Layers panel" section; `e2e/layers-panel.mjs` (open panel, rows show, drag
  reorders, click selects). Run `npx tsc --noEmit`, `npm run lint`, `npm test`, the e2e test. Commit.
