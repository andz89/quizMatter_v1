# Custom Colors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 36 preset colors and a Canva-like custom color picker (square, hue bar, hex box, recent colors) in the editor's Color panel.

**Architecture:** Pure color math in `src/lib/colors.ts` (tested with `npm test`); a hand-made picker component; `ColorPanel` wires it to its existing `handleColor`.

**Tech Stack:** React, zustand store, Tiptap, Node test runner, Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-11-25-custom-colors-design.md`

## Global Constraints

- No new package. Lucide icons only. Design-system classes only.
- Saved colors are uppercase `#RRGGBB`. No `DATA_VERSION` change.
- Recent colors: `localStorage` key `qm-recent-colors`, at most 11, newest first, presets never added.
- The square and the hue bar never take the focus (typing keeps its selection).

## Review Focus

- Hex box while typing in a text: the words picked before focusing it get the color, not the whole text.
- Bad hex typed ("zzz", "#12"): nothing is painted, the box goes back to the current color.
- `localStorage` blocked or holding junk: the panel still opens, Recent is just empty.
- A gradient or "none" as the current color: the picker starts at violet `#6B3DF5`.
- A drag outside the square/bar keeps tracking (pointer capture) and clamps to 0–1.

---

### Task 1: Color math (`src/lib/colors.ts`)

**Files:** Create `src/lib/colors.ts`, `src/lib/colors.test.ts`.

**Interfaces — Produces:**
- `type Hsv = { h: number; s: number; v: number }` (h 0–360, s/v 0–1)
- `parseHex(text: string): string | null` → `#RRGGBB` uppercase from `#rgb`, `rgb`, `#rrggbb`, `rrggbb` (trimmed), else null
- `hexToHsv(hex: string): Hsv` (hex already parsed)
- `hsvToHex(hsv: Hsv): string` → uppercase `#RRGGBB`
- `withRecent(list: string[], color: string, max = 11): string[]` → color first, no duplicates, cut to max
- `readRecentColors(text: string | null): string[]` → valid parsed hexes from JSON, else `[]`

- [ ] Tests: `parseHex("#abc") === "#AABBCC"`, `parseHex("1e8e4f") === "#1E8E4F"`, `parseHex("#12") === null`, `parseHex("zzz") === null`; `hsvToHex(hexToHsv(c)) === c` for `#6B3DF5`, `#000000`, `#FFFFFF`, `#E03131`; `hsvToHex({h:0,s:1,v:1}) === "#FF0000"`; `withRecent(["#A","#B"], "#B")` → `["#B","#A"]`; max cut; `readRecentColors("junk")` → `[]`, `readRecentColors('["#abc", 5]')` → `["#AABBCC"]`.
- [ ] Run `npm test` → fails; implement; `npm test` → passes. Commit.

### Task 2: Picker component

**Files:** Create `src/components/editor/CustomColorPicker.tsx`.

**Interfaces — Consumes:** Task 1. **Produces:** `CustomColorPicker({ color, onChange, onHexFocus, onHexColor }: { color: string; onChange: (hex: string) => void; onHexFocus: () => void; onHexColor: (hex: string) => void })`.

- [ ] Square (h-36, full width, `rounded-dropdown`, background `hsl(h 100% 50%)` with white→transparent and transparent→black overlays) and hue bar (h-3, rainbow gradient); both `onPointerDown` → `setPointerCapture`, `preventDefault`, move updates; a round marker shows the spot. HSV kept in state so hue survives grays; a new `color` prop that isn't what we last sent resets it.
- [ ] Hex box (`rounded-input`, `aria-label="Hex color"`): `onMouseDown` stopPropagation (the panel stops mousedown), `onFocus` → `onHexFocus()`, Enter / blur → `parseHex` → `onHexColor`, else back to `color`; Escape puts it back and blurs.

### Task 3: Panel wiring, presets, recent, notes, e2e

**Files:** Modify `src/components/editor/ColorPanel.tsx`, `src/components/editor/CLAUDE.md`, the root `CLAUDE.md` map is unchanged. Create `e2e/custom-colors.mjs`.

- [ ] `COLORS` → 36 (first 18 unchanged). New "Custom" section above Solid: `PlusIcon` rainbow swatch (title "Custom color", toggles the picker), then recent swatches. Picker start = `commonColor` if `parseHex` reads it, else `#6B3DF5`.
- [ ] Custom paints via `handleColor`; the recent list updates (`withRecent`) when a custom color is used — on pointer up / hex use, not every move — saved with `localStorage` in try/catch.
- [ ] Hex while typing: `onHexFocus` stores `texts.map(t => ({ editor, from, to, editable }))`; `onHexColor` paints each stored range with `editor.chain().setTextSelection({from,to}).setColor(hex).run()` when it was typing, else `handleColor`.
- [ ] e2e: open a slide, select the question, open Color, click "Custom color", type `#123456` + Enter → the question's text shows `rgb(18, 52, 86)`; the recent row shows `#123456`; reload, recent still there; drag on the square changes the color.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test`, e2e passes. Notes in `src/components/editor/CLAUDE.md`. Commit.
