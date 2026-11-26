# Element effects (elements that appear on click while presenting)

## Why

Teachers know this from PowerPoint, Canva and Google Slides: while presenting, a click makes the next picture or
text appear, so they can talk first and then show it. Today only the whole slide has an effect (Effects panel, one
for the presentation).

## What the user decided

- **Approach A:** each element gets its own entrance effect, and every effect waits for a click. The Effects panel's
  new tab lists the slide's animated elements in order (1, 2, 3…), and the teacher drags to reorder them.
- **Two effects: Fade and Pop up.**
- **Only on Blank and Title slides.** Question slides (choice, true or false, short answer, custom) never get
  element effects. Video, slide deck and picture slides have no elements.
- Not now: "With previous / After previous" (playing by itself). It can be added on top later.

## Goals / non-goals

- Goals: the Effects panel gets two tabs, **Slide effects** (today's panel, unchanged) and **Element effects**. On a
  Blank or Title slide, a picked element (or group) can get None / Fade / Pop up and a speed. While presenting, Next
  shows the next element before it moves to the next slide.
- Non-goals: effects on the question box or answer choice cards; exit effects; effects that play by themselves; a
  Preview button in the editor; Claude's connector making or reading effects; the view page's Prev/Next (it isn't
  presenting).
- Anti-goals: a slide without element effects must present exactly as it does today. Effects must never hide an
  element anywhere except while presenting (cards, thumbnails, the view page, downloads and the editor show
  everything).

## Saved data (DATA_VERSION 6 → 7)

On an element (`svgElementSchema`), optional:

```ts
effect: { type: "fade" | "pop", order: int 1..MAX_ELEMENTS, speed: int SLIDE_EFFECT_SPEED_MIN..MAX }
```

- `ELEMENT_EFFECTS = ["fade", "pop"]` and `ELEMENT_EFFECT_LABELS` ("Fade", "Pop up") in `schema.ts`. Missing =
  no effect. The speed reuses the slide effect's 1–5 scale (default 3).
- `order` is the step. Elements with the same `order` appear together. A group's members always share one effect
  (the editor sets all of them together). The steps are the distinct `order` values sorted, so gaps after a delete
  don't matter.
- Stored on the element (not a list on the slide), so copying an element or a slide carries it along.
- Saved on a question slide (e.g. a slide's type changed later): kept in the data but ignored when presenting, and
  the tab says effects work only on Blank and Title slides. Nothing is deleted.
- Migration: `current_data_version()` → 7, applied live before the app deploys (the usual rule). Check whether the
  database's slide checks (`check_review_draft` etc.) look at element keys; if so, they take `effect` too. Run Admin →
  Data check before deploying.

## Presenting (`PresentationView`)

- A small helper `src/lib/elementEffects.ts` (no imports beyond `schema` types, tested with `npm test`):
  `effectSteps(slide)` gives the steps (a list of element-id lists, in order; empty for a slide type that doesn't
  allow them) and `canHaveElementEffects(slide)` (`blank` / `title`).
- The view keeps `stepsShown` for the slide on screen.
  - Arriving going forward (Next, or the "Show all slides" grid): 0, so every element with an effect is hidden.
  - Arriving going back: all steps shown (like PowerPoint).
- **Next** (click on the right 75%, →, ↓, Space): if steps are left, show the next step and play its effect; else
  what happens today (Space: the answer key toggle when the slide has one, else the next slide; the others: the next
  slide).
- **Back** (left 25% click, ←, ↑): if any step is shown, hide the last one at once (no effect); else the previous
  slide.
- Hidden elements are drawn but invisible (`opacity: 0`, not removed), so photos are ready and nothing moves.
  `SlideStaticView` takes a new optional prop (e.g. `hiddenElementIds`); `StaticElementView` marks each element's
  wrapper with `data-element-id`, so the view can find it to animate. The preloaded slides drawn ahead are drawn
  with their effect elements hidden too, so the slide effect brings in a slide without them.
- The effects play with `motion/mini` (`animate`, `reduceMotion: false`, like the slide effect). Fade: opacity 0 → 1.
  Pop up: opacity 0 → 1 and scale 0.5 → 1 with a small overshoot. Duration from the element's speed (new seconds in
  `constants.ts`, next to `SLIDE_EFFECT_SECONDS`). A press during an effect ends it at once and goes on.
- `PresentDraftButton` and the home cards' `PresentingView` use `PresentationView`, so they get it by themselves.

## Editor

- `EffectsPanel` gets two tabs at the top: **Slide effects** (today's content) and **Element effects**.
- Element effects tab, for the selected slide:
  - Not Blank / Title: a note, "Element effects work on Blank and Title slides.", and nothing else.
  - Nothing picked: a hint to pick an element on the slide.
  - "On this slide", the slide's steps in order as rows (number, the element's name like the Layers panel's row
    names, its effect). Click = select the element. Drag (`@dnd-kit`, as in the Layers panel) = reorder. Each row
    has a remove (✕). While a row's elements are picked, the row opens with a Fade | Pop up switch and the Speed
    control inside it (changed 2026-11-26 at the user's request: the choices live in the item, not above the list).
  - A picked element with no effect: a dashed row under the list ("No effect yet") with the same switch to add one.
- Several separate elements picked and given an effect: each gets its own step, one after another at the end, in
  their order on the slide. A group is one step.
- A new effect goes at the end (`max order + 1`). Changing an element's effect type or speed keeps its step.
- A pasted or duplicated element (within a slide) keeps its effect type and speed but goes to the end.
- On the canvas, while the Effects panel is open, each element with an effect shows a small step number badge at its
  top-left (editor only, not saved).
- Store actions (undoable, through `updateSlide`, so a hidden slide stays locked): `setElementEffect(ids, type |
  null, speed?)` and `moveElementEffect(slideId, fromStep, toStep)` (rewrites orders 1..n).

## Other

- Downloads, thumbnails, cards, the view page: unchanged (everything shows).
- No Privacy Policy change (nothing new is collected).
- Notes: `src/components/presentation/CLAUDE.md` (presenting steps), `src/components/editor/CLAUDE.md` (the tab),
  `src/lib/CLAUDE.md` (`elementEffects.ts`, DATA_VERSION 7).
- Tests: `src/lib/elementEffects.test.ts` (steps, groups, gaps, slide types, reorder math);
  `e2e/element-effects.mjs` (set effects in the editor, save, present: Next shows steps, Back hides, Space then
  the answer, a question slide ignores them).

## Calls I made (the user can change them)

- Speed per element (1–5) reusing the slide effect scale.
- Going back to a slide shows all its elements; arriving from the grid shows none.
- After all steps, Space works exactly as today (toggle the answer key), so slides without effects don't change.
- Several picked elements get separate steps; a group is one step.
- The step badge shows only while the Effects panel is open.
