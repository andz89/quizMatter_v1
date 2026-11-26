# src/components/presentation (presenting and view-only slides)

Slides drawn without the editor: fullscreen presenting, cards, the view page, review pages.

- `SlideStaticView.tsx`: draws one slide, view only, at full size (1280×720). The one way to draw a slide outside
  the editor, so a slide looks the same everywhere. Also has the background helpers (`getSlideBackgroundStyle`,
  `slideBackgroundCss`; they draw nothing for a color `isSafeColor` refuses, see `src/lib/CLAUDE.md`), the shape box
  frame and `QuestionNumberBadge`, which the editor reuses.
  `revealAnswer` shows the right answer; `liveEmbed` plays a video / slide deck (only on the slide being shown), and gives a picture slide from another
  website its "Show picture" button (see `src/components/editor/CLAUDE.md`). Option rows take their heights from
  `getOptionsGridStyle` (each option's `rowSize`, a grid's `gridRowSizes`), the same style as the editor, and an
  option's text spans the whole option with its pictures on top (see "Option row heights" in
  `src/components/editor/CLAUDE.md`).
- `FluidSlidePreview.tsx`: a slide shrunk to fit its box's width (cards, lists, panels). Use it for any small
  picture of a slide; don't scale slides another way. `HiddenSlideMark` there fades a hidden slide's picture and adds
  an eye-off mark (also used by the editor's `SlideThumbnailPreview`).
- `PresentationView.tsx`: fullscreen presenting. It reads the presentation from the editor store
  (`isPresenting`, `presentationIndex`), so whoever opens it first calls `store.loadPresentation`. Click the left
  25% of the screen = previous slide; hidden slides (the slide's `hidden` field) are skipped by the arrows, Space and
  clicks (`stepPresentation`), but the "Show all slides" grid still opens them; the buttons (bottom left) hide after 3 seconds, except while a live
  video or deck shows (`hasLivePlayer`: a mouse moving over another site's frame never reaches the page);
  on open, a tip ("If this slide has a saved answer key, click the check icon at the bottom left or press Space to
  reveal it.") fades in at the bottom center (a white card; it stays when the buttons hide), stays
  6 seconds (`TIP_MS`; its ✕ closes it sooner) and fades out; Space shows / hides the answer key like the check
  button (`AnswerModal` closes on Space too), and on a slide without one goes to the next slide;
  the next 2 slides the arrows go to are drawn hidden so they're ready; a slide change waits at most 400 ms for photos. While open it puts `data-presenting` on `<html>`, so
  announcements hide even when the browser refused fullscreen.
- **Slide effects** (Fade, Slide, Zoom): played by `startSlideEffect` with the `motion` library (`motion/mini`), even
  when the computer asks to reduce motion (the teacher picked one on purpose; "None" turns them off). Speed 1–5 (default 3):
  seconds in `SLIDE_EFFECT_SECONDS` / `SLIDE_FADE_SECONDS` (`constants.ts`). A new effect goes in
  `startSlideEffect` and `SLIDE_TRANSITIONS` (`schema.ts`), and gets a choice in the editor's `EffectsPanel`.
- **Element effects** (Fade, Pop up; spec `docs/superpowers/specs/2026-11-26-element-effects-design.md`): only on
  Blank and Title slides (`effectSteps` in `src/lib/elementEffects.ts` gives none on other types, so a question slide
  presents as before). `stepsShown` counts the shown slide's steps that came in: Next (right-side click, →, ↓,
  Space) brings in the next step before moving on; once all are in, Space does today's answer toggle. Back hides the
  last step at once, then goes to the previous slide. Arriving going back shows all steps; going forward or from the
  "Show all slides" grid (`isGridJump`), none. Elements not in yet are drawn see-through (`hiddenElementIds` →
  `StaticElementView`'s `opacity-0` class on the inner box marked `data-element-id`), so photos are ready; slides
  drawn ahead hide all their steps, the slide we came from keeps what it showed. `startElementEffect` plays one step
  with `motion/mini` (`ELEMENT_EFFECT_SECONDS`, `constants.ts`); the next press cancels it and clears its inline
  styles, so the class decides. While a slide effect waits for photos or plays, a press that would bring in or hide a
  step only ends the slide effect (`endSlideEffect`), so a step never plays unseen. `stepsShown` belongs to
  `shownIndex` (which may still be loading); the slide still on screen keeps its own count (`fromStepsShown`), and
  going back to it before the new one showed keeps its steps. Picking the slide already shown in the grid sets no
  `isGridJump`. Nothing is hidden anywhere else (cards, thumbnails, the view page, the editor).
  Test: `e2e/element-effects.mjs`.
- `PresentDraftButton.tsx`: Present for a presentation that isn't open in the editor (a review's submitted
  version). Downloads `PresentationView` only when clicked, with the Spinner meanwhile. `showView={false}` leaves the
  showing to another Present on screen (a page under the presentation modal), so only one view hears the keys.
- `ReviewDraftView.tsx`: a review's draft, or a submission, view only ("Reviewed by" / "Submitted by" details +
  every slide as a picture). Shared by the reviewer's page and the admin's review and submission pages; reuse it.

Presenting from a home page card works the same way (`PresentingView` in `src/app/(home)/CardGrid.tsx`).
