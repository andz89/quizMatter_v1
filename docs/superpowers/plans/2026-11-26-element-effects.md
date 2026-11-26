# Element Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Blank and Title slides, a teacher gives elements a Fade or Pop up effect; while presenting, each click
shows the next one before moving to the next slide.

**Architecture:** An optional `effect` on each element (saved data, DATA_VERSION 7). A pure helper
(`src/lib/elementEffects.ts`) turns a slide into ordered steps and does the reorder math. `PresentationView` keeps
how many steps are shown and plays each with `motion/mini`; the editor's `EffectsPanel` gets a second tab that sets
effects through two new store actions.

**Tech Stack:** Next.js (this repo's version), zustand, zod, `motion/mini`, `@dnd-kit`, lucide-react, Playwright
(e2e), Node test runner, Supabase (Docker).

**Spec:** `docs/superpowers/specs/2026-11-26-element-effects-design.md`

## Global Constraints

- Effects: `ELEMENT_EFFECTS = ["fade", "pop"]`, labels "Fade" / "Pop up". Speed 1–5 (`SLIDE_EFFECT_SPEED_MIN` /
  `MAX`), default `SLIDE_EFFECT_SPEED_DEFAULT` (3).
- Only slides of type `blank` or `title` use element effects; on any other type they're kept in the data but ignored.
- Effects hide elements only in `PresentationView`. Every other view shows everything.
- A slide without element effects presents exactly as today (Space, arrows, clicks, answer key).
- Design system: existing classes only (`rounded-button`, `bg-accent-soft`, `text-text-header`…), Lucide icons with
  `size`, the `side-panel` class. No new spinner, no new colors.
- `DATA_VERSION` 7 and `current_data_version()` 7 together; the migration goes live before the app.
- Every change to the presentation goes through a store action using `updateSlide` (new slide objects, undoable,
  hidden slides stay locked).
- Notes updated in the same commits (`src/lib/CLAUDE.md`, `src/components/editor/CLAUDE.md`,
  `src/components/presentation/CLAUDE.md`).

## Review Focus

- A saved `effect` with a bad value (order 0, type "spin", speed 9) from a hand-edited request: the slide must still
  open, the effect left out (`cleanElement`). Test in Task 1.
- A group whose members have different orders (old or hand-edited data): the whole group must appear in one step, at
  its lowest order. Test in Task 1.
- The teacher presses Next very fast during a Pop up: the effect ends at once and the next step starts; no element
  is left half-shown or at scale 0.5. Check in Task 4's e2e (two quick presses → both elements fully visible).
- An element with an effect is deleted, or a slide's type is changed away from Blank/Title: presenting must not wait
  on a step that has no element, and question slides ignore effects. Test in Task 1 (`effectSteps` on a `choice`
  slide = `[]`; gaps in orders).
- Going back from slide N+1 to a slide with steps shows all of them; pressing Back then hides the last one. Test in
  Task 4's e2e.

---

### Task 1: Saved data and the step helper

**Files:**
- Modify: `src/lib/schema.ts` (new constants near `SLIDE_TRANSITIONS` ~line 187; `effect` in `svgElementSchema` ~line
  489; `DATA_VERSION` → 7; `cleanElement` ~line 549)
- Create: `src/lib/elementEffects.ts`, `src/lib/elementEffects.test.ts`
- Create: `supabase/migrations/20261231002900_element_effects.sql`
- Modify: `src/lib/CLAUDE.md`, then `npm run db:snapshot` (`supabase/schema.sql`, `src/lib/database.types.ts`)

**Interfaces:**
- Produces (in `schema.ts`): `ELEMENT_EFFECTS`, `type ElementEffectType = (typeof ELEMENT_EFFECTS)[number]`,
  `ELEMENT_EFFECT_LABELS: Record<ElementEffectType, string>`, `elementEffectSchema` (`{ type, order: int
  1..MAX_ELEMENTS, speed: int 1..5 }`), `SvgElement["effect"]` optional.
- Produces (in `elementEffects.ts`):
  - `canHaveElementEffects(slide: Pick<Slide, "type">): boolean` (`blank` / `title`)
  - `effectSteps(slide: Slide): string[][]` (element ids per step, in step order; a group = one step at its
    members' lowest order; within a step, in `slide.elements` order; `[]` when the type can't have effects)
  - `stepNumbers(slide: Slide): Map<string, number>` (element id → 1-based step, for the editor badge and list)
  - `nextEffectOrder(slide: Slide): number` (max order + 1, or 1)
  - `withEffect(slide: Slide, ids: string[], type: ElementEffectType | null, speed?: number): Slide` (ids already
    expanded to whole groups by the caller; `null` removes; an element that already has an effect keeps its order;
    new ones get `nextEffectOrder` in `slide.elements` order, one step each, but a group's members share one)
  - `moveEffectStep(slide: Slide, from: number, to: number): Slide` (0-based step places; rewrites every order to
    1..n in the new step order)

- [ ] **Step 1: Write the failing tests** in `src/lib/elementEffects.test.ts` (Node test runner, `node:assert`):
  - `effectSteps` on a blank slide with a (order 2), b (order 1), c (no effect) → `[["b"], ["a"]]`
  - gaps: orders 1, 5, 9 → three steps
  - a group g1 (members m1 order 3, m2 order 1) → one step `["m1","m2"]` at place of order 1
  - same order on two separate elements → one step with both
  - `effectSteps` on a `choice` slide with effects → `[]`; `canHaveElementEffects` true for blank / title only
  - `withEffect` on two separate new elements → orders `max+1`, `max+2`; re-setting type on an existing one keeps
    its order; `null` removes `effect`; returns a new slide object (`!== input`)
  - `moveEffectStep(slide, 0, 2)` on three steps → orders rewritten 1..3 with the first now last
  - `upgradeSlide`/`slideSchema` parse of an element with `effect: { type: "spin", order: 0, speed: 9 }` → the
    element is kept without `effect`

- [ ] **Step 2: Run to see them fail**

Run: `npm test -- src/lib/elementEffects.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement** the schema additions, `cleanElement` dropping an `effect` that fails
  `elementEffectSchema` (same pattern as `clockTime`, with a comment that the database doesn't check it), `DATA_VERSION
  = 7`, and `elementEffects.ts` (imports only types from `schema.ts`, so `npm test` can load it).

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS (all, including existing schema tests)

- [ ] **Step 5: Migration** `20261231002900_element_effects.sql`: header comment like
  `20261231002100_option_row_heights.sql` (new `effect` on elements, DATA_VERSION 7, apply before the app), then
  `current_data_version()` returning 7. Run `npm run test:sql` (Docker), then `npm run db:snapshot`.
  Expected: every SQL test passes; snapshot files change only in `current_data_version`.

- [ ] **Step 6: Notes** in `src/lib/CLAUDE.md`: a line for `elementEffects.ts` (what each helper does, DATA_VERSION 7,
  migration name).

- [ ] **Step 7: Commit**

```bash
git add src/lib/schema.ts src/lib/elementEffects.ts src/lib/elementEffects.test.ts supabase/migrations/20261231002900_element_effects.sql supabase/schema.sql src/lib/database.types.ts src/lib/CLAUDE.md
git commit -m "feat: element effects data (DATA_VERSION 7)"
```

### Task 2: Store actions

**Files:**
- Modify: `src/lib/store.ts` (interface near `duplicateElements` ~line 549; implementation near ~1684;
  `duplicateElements` and `pasteClipboard`)

**Interfaces:**
- Consumes: `withEffect`, `moveEffectStep`, `nextEffectOrder` (Task 1).
- Produces:
  - `setElementEffect(slideId: string, elementIds: string[], type: ElementEffectType | null, speed?: number): void`
    (expands ids to whole groups, does nothing on a slide where `canHaveElementEffects` is false, through
    `updateSlide`)
  - `moveElementEffect(slideId: string, from: number, to: number): void` (no change when `from === to`)
  - `duplicateElements` / `pasteClipboard`: a copy that has an `effect` keeps type and speed, and its order becomes
    `nextEffectOrder` of the target slide (copies of one group share one new order); on a slide that can't have
    effects the copy keeps it unchanged (ignored there).

- [ ] **Step 1:** Implement the two actions and the copy rule. The logic lives in Task 1's tested helpers, so the
  store only wires them in.
- [ ] **Step 2:** Run `npx tsc --noEmit` and `npm test`. Expected: no errors, all pass.
- [ ] **Step 3: Commit** `git commit -m "feat: store actions for element effects"`

### Task 3: Effects panel tabs and the canvas badge

**Files:**
- Modify: `src/components/editor/EffectsPanel.tsx` (split into the tab switch + `SlideEffectsTab` (today's content,
  unchanged) + `ElementEffectsTab`; pull the speed control into a small `SpeedControl({ value, onChange })` in the
  same file and use it in both tabs)
- Modify: `src/components/editor/LayersPanel.tsx` (export `elementName` so the effects list reuses it)
- Modify: `src/components/editor/SvgElementItem.tsx` (the step badge)
- Modify: `src/components/editor/CLAUDE.md`

**Interfaces:**
- Consumes: `setElementEffect`, `moveElementEffect` (Task 2); `effectSteps`, `stepNumbers`,
  `canHaveElementEffects` (Task 1); `isEffectsPanelOpen`, `selectedSlideId`, `selectedElementIds` from the store.

- [ ] **Step 1: Tabs.** Two-part switch under the title ("Slide effects" | "Element effects"), styled like the
  Download box's All slides / Custom switch in `DownloadButton.tsx` (reuse its classes). Tab choice is component
  state; opens on "Slide effects".
- [ ] **Step 2: Element effects tab**, for the selected slide:
  - type not blank/title: text "Element effects work on Blank and Title slides." only;
  - nothing picked: "Pick a picture or text on the slide to give it an effect.";
  - picked: cards None / Fade / Pop up (same card classes as the slide effect choices), picked one = the picked
    elements' shared effect (None if mixed or none), and `SpeedControl` under Fade / Pop up;
  - "On this slide" label (`PanelLabel`) and one row per step: the step number, the first element's `elementName`
    (a group: "Group · N items"), the effect label, a ✕ (`XIcon`, title "Remove effect") that calls
    `setElementEffect(..., null)`. Row click selects its elements (store `selectElements` or the action the Layers
    panel uses). Drag to reorder with `@dnd-kit` `SortableContext` like `LayersPanel` → `moveElementEffect`.
  - Keep `data-keep-container-selection="true"` on the panel so clicks don't drop the picked element.
- [ ] **Step 3: Badge.** In `SvgElementItem`, when `isEffectsPanelOpen` and the slide can have effects and the
  element has a step (`stepNumbers`), draw a 20 px `rounded-dropdown bg-accent text-white text-[11px] font-bold`
  number at the element's top-left, `pointer-events-none`, editor only.
- [ ] **Step 4:** `npx tsc --noEmit`, `npm run lint`. Expected: clean.
- [ ] **Step 5: Notes** in `src/components/editor/CLAUDE.md`: an "Element effects" line under the side panels.
- [ ] **Step 6: Commit** `git commit -m "feat: element effects tab in the Effects panel"`

### Task 4: Presenting

**Files:**
- Modify: `src/components/editor/StaticElementView.tsx` (`data-element-id` on each wrapper; optional
  `hiddenIds?: ReadonlySet<string>` → `opacity: 0` on those)
- Modify: `src/components/presentation/SlideStaticView.tsx` (optional `hiddenElementIds?: ReadonlySet<string>`,
  passed to every `StaticElementView`)
- Modify: `src/components/presentation/PresentationView.tsx`
- Modify: `src/lib/constants.ts` (`ELEMENT_EFFECT_SECONDS: Record<number, number> = { 1: 0.9, 2: 0.7, 3: 0.5, 4:
  0.35, 5: 0.25 }`)
- Create: `e2e/element-effects.mjs`
- Modify: `src/components/presentation/CLAUDE.md`

**Interfaces:**
- Consumes: `effectSteps` (Task 1).

- [ ] **Step 1: Write the e2e** `e2e/element-effects.mjs` (reuse `e2e/lib.mjs` per `e2e/CLAUDE.md`): a teacher's
  presentation with slide 1 Blank (two elements: a Fade, b Pop up; plus c with no effect) and slide 2 a choice slide
  with an effect saved on an element. Present from slide 1:
  - c visible, a and b `opacity 0`; Next → a visible; Next → b visible; Next → slide 2.
  - slide 2's element visible at once (ignored on a question slide).
  - Back → slide 1 with a and b both visible; Back → b hidden; Back → a hidden.
  - two quick Next presses on slide 1 (from 0) → after 1 s both a and b at opacity 1 and `transform` none / scale 1.
  - in the editor, the Effects panel's Element effects tab sets an effect and the badge "1" shows.
- [ ] **Step 2: Run it to see it fail.** `npm run e2e:dev` then `node e2e/element-effects.mjs`. Expected: FAIL at
  the first hidden check.
- [ ] **Step 3: Implement in `PresentationView`:**
  - `const steps = effectSteps(slide)`; state `stepsShown`, reset on slide change: going forward or from the grid
    → 0; going back (`goingBack`) → `steps.length` (set alongside the existing `setGoingBack` block).
  - Hidden set for each drawn layer: current slide = ids of steps `>= stepsShown`; other layers = all their step ids
    when ahead of the current slide, none when behind.
  - `next()`: `stepsShown < steps.length` → `stepsShown + 1` and play; else today's `nextSlide()`. Used by the
    right-side click, →, ↓, and Space when the slide can't reveal or steps are left (Space with steps left shows a
    step first; with none left it does today's reveal toggle).
  - `back()`: `stepsShown > 0` → `stepsShown - 1` (no effect); else `prevSlide()`.
  - Play in a `useLayoutEffect` on `stepsShown` growing: find `[data-element-id]` nodes of the new step in
    `currentLayerRef`, `animate` with `reduceMotion: false`, duration `ELEMENT_EFFECT_SECONDS[effect.speed]`; Fade
    `{ opacity: [0, 1] }`; Pop up `{ opacity: [0, 1], transform: ["scale(0.5)", "scale(1.08)", "scale(1)"] }` with
    `times: [0, 0.7, 1]`. Clean-up: `finish()` running ones (so a fast press leaves them fully shown), then clear
    inline styles. Combine the element's own `rotate(...)`: animate an inner wrapper, not the rotated one (add the
    inner `div` in `StaticElementView` carrying `data-element-id`).
- [ ] **Step 4: Run e2e and unit tests.** `node e2e/element-effects.mjs`, `node e2e/present-answer-key.mjs`,
  `node e2e/hidden-slides.mjs`, `npm test`. Expected: all PASS (the last two prove slides without effects didn't
  change).
- [ ] **Step 5: Notes** in `src/components/presentation/CLAUDE.md`: an "Element effects" bullet after "Slide
  effects" (steps, Next/Back/Space rules, only blank/title, hidden only here).
- [ ] **Step 6: Commit** `git commit -m "feat: element effects play while presenting"`

### Task 5: Final check

- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:sql` all pass.
- [ ] Admin → Data check locally (`npm run dev`) lists nothing.
- [ ] `git diff main...dev` read against the spec; notes true.
- [ ] Tell the user the deploy order: paste `20261231002900_element_effects.sql` into the live SQL editor, **then**
  push `dev`.
