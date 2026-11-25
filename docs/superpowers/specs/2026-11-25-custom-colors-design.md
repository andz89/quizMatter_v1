# More colors and a custom color picker (Color panel)

**Why:** teachers asked for more text colors and to pick any color, like Canva.

## What changes

- **More preset colors:** the Color panel's Solid grid goes from 18 to 36 (grays, darker and brighter shades). The
  first 18 stay as they were, so colors already used still show as picked.
- **Custom color:** a rainbow "+" swatch (first in a new "Custom" row) opens a picker inside the panel:
  - a saturation / brightness square (drag or click),
  - a hue bar (drag or click),
  - a hex box (`#RGB` or `#RRGGBB`, with or without `#`; Enter or leaving the box uses it, Escape puts it back).
  The picker starts at the color the panel shows as picked (or violet when none). Each change paints at once, through
  the panel's own `handleColor`, so it works for every target (text, shapes, borders, table cells, diagram boxes,
  the shape box). Dragging makes changes less than half a second apart, which the history joins into one undo step.
- **Recent colors:** custom colors used (not presets) show after the "+" (up to 11, newest first), kept in this
  browser only (`localStorage` key `qm-recent-colors`). Nothing is sent anywhere, so no Privacy Policy change.

## Rules kept

- No new package: the square and bar are our own (pointer events, no focus), so a drag never takes the focus out of
  the text being typed (the panel's mousedown `preventDefault` stays).
- The hex box needs the focus, which ends typing. So on focus it remembers each text's selected range; Enter /
  leaving paints that range (`setTextSelection` + `setColor`), so the words picked while typing get the color.
- Saved colors stay `#RRGGBB` (uppercase), which `isSafeColor` already allows: no `DATA_VERSION` change.
- Design system: section labels, `rounded-input` for the hex box, `rounded-dropdown` for the square and bar,
  Lucide `PlusIcon`.

## Approaches considered

1. Native `<input type="color">`: no code, but on Windows it opens the OS dialog (not Canva-like) and takes the
   focus. Not chosen.
2. `react-colorful` package: small, but its square focuses itself on press (ends typing) and needs CSS overrides.
   Not chosen.
3. **Our own small picker (chosen):** ~150 lines, keeps the typing selection, fits the design system.

## Code

- `src/lib/colors.ts` (no imports, tested in `colors.test.ts`): `hexToHsv`, `hsvToHex`, `parseHex`, `withRecent`.
- `src/components/editor/CustomColorPicker.tsx`: the square, the hue bar, the hex box.
- `src/components/editor/ColorPanel.tsx`: the 36 colors, the Custom row, Recent colors.
- Test: `e2e/custom-colors.mjs`.
