# src/components/presentation (presenting and view-only slides)

Slides drawn without the editor: fullscreen presenting, cards, the view page, review pages.

- `SlideStaticView.tsx`: draws one slide, view only, at full size (1280×720). The one way to draw a slide outside
  the editor, so a slide looks the same everywhere. Also has the background helpers (`getSlideBackgroundStyle`,
  `slideBackgroundCss`; they draw nothing for a color `isSafeColor` refuses, see `src/lib/CLAUDE.md`), the shape box
  frame and `QuestionNumberBadge`, which the editor reuses.
  `revealAnswer` shows the right answer; `liveEmbed` plays a video / slide deck (only on the slide being shown).
- `FluidSlidePreview.tsx`: a slide shrunk to fit its box's width (cards, lists, panels). Use it for any small
  picture of a slide; don't scale slides another way.
- `PresentationView.tsx`: fullscreen presenting. It reads the presentation from the editor store
  (`isPresenting`, `presentationIndex`), so whoever opens it first calls `store.loadPresentation`. Click the left
  25% of the screen = previous slide; the top buttons hide after 3 seconds; the next 2 slides are drawn hidden so
  they're ready; a slide change waits at most 400 ms for photos.
- **Slide effects** (Fade, Slide, Zoom): played by `startSlideEffect` with the `motion` library (`motion/mini`), even
  when the computer asks to reduce motion (the teacher picked one on purpose; "None" turns them off). Speed 1–5 (default 3):
  seconds in `SLIDE_EFFECT_SECONDS` / `SLIDE_FADE_SECONDS` (`constants.ts`). A new effect goes in
  `startSlideEffect` and `SLIDE_TRANSITIONS` (`schema.ts`), and gets a choice in the editor's `EffectsPanel`.
- `PresentDraftButton.tsx`: Present for a presentation that isn't open in the editor (a review's submitted
  version). Downloads `PresentationView` only when clicked, with the Spinner meanwhile.
- `ReviewDraftView.tsx`: a review's draft, or a submission, view only ("Reviewed by" / "Submitted by" details +
  every slide as a picture). Shared by the reviewer's page and the admin's review and submission pages; reuse it.

Presenting from a home page card works the same way (`PresentingView` in `src/app/(home)/CardGrid.tsx`).
