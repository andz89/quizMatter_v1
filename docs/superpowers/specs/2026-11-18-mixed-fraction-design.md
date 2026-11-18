# Mixed Fraction (Elements → Math tools)

## Why

Teachers already have the Written Fraction (a numerator over a denominator). Mixed numbers like 2 ¾ come up all the
time in fraction lessons (improper fractions ↔ mixed numbers), and today a teacher has to put a text box next to a
Written Fraction and line them up by hand.

## What

A new tile, **Mixed Fraction**, next to Written Fraction: a big whole number on the left, a fraction on its right,
all in the element's color. Starts at 1 ½. Its "Edit fraction" panel has three number boxes (Whole number,
Numerator, Denominator) and Reset, like the Written Fraction's.

## Approaches

1. **Add `whole` to the existing `fraction` setting** (chosen). `fraction: { parts, shaded, whole? }`, read only by
   the mixed fraction (`mathTool: "mixedFraction"`). Reuses the Written Fraction's panel boxes, schema, limits and
   Claude's `fraction` recipe. One new optional field.
2. A separate `mixedFraction: { whole, numerator, denominator }` field. Cleaner names, but a second copy of the same
   limits, panel and Claude recipe.
3. Group a text box with a Written Fraction. No saved-shape change, but the two pieces drift apart when resized and
   it's not one tile.

## Rules

- `whole`: whole number 1–999 (`FRACTION_NUMBER_MAX`), optional. Missing on a mixed fraction = 1. Numerator 0–999,
  denominator 1–999, same as the Written Fraction.
- It's a new saved field, so `DATA_VERSION` 5 and `current_data_version()` 5 in
  `20261231002000_mixed_fraction.sql` (older tabs would drop `whole`; they get `QMOLD`). Apply it before the app.
- Drawing: a fixed 170 × 100 area. The whole number ends just left of the fraction and shrinks with more digits;
  the fraction bar widens with its longest number, like the Written Fraction.
- Claude's connector: `fraction.whole` works on `mixed-fraction` only.
- Tests: zod (`schema.test.ts`), the browser test (`e2e/math-tools.mjs`).
