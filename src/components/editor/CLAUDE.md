# The editor (how it fits together)

The page `src/app/presentation/[id]/edit/page.tsx` loads the presentation on the server (`fetchPresentation`), picks
editor / view / review, and renders `Editor.tsx`, which calls `store.loadPresentation`.

## The pieces

- `Editor.tsx`: the frame. `EditorTopBar`, `IconRail` (the left icon bar that opens the side panels), `Workspace`,
  `EditorBottomBar` (zoom, which slide is showing, the slide grid, fullscreen present).
- `EditorTopBar.tsx`: Save, `ShareButton`, `ReviewControls`, and the toolbar for what is picked:
  `SelectedElementToolbar` (elements), `TextFormatToolbar` (text), `ShapeBoxToolbar`. `ArrangePanel` and
  `MathToolPanels` are drop-downs inside those toolbars (`ToolPanelButton` in `PanelControls.tsx`).
- `ShareButton.tsx` (the Share card): a teacher's Published = a shared copy (store `sharedCopy`). It says "up to
  date" or "You have changes the shared copy doesn't have" (unsaved edits, or saved after `sharedCopy.sharedAt`),
  with "Update shared presentation". When QuizMatter hid the copy (`sharedCopy.isHidden`) it says so, and Private and
  Copy link are off. Refusals show the database's own reason. Editors get Published greyed out (store `canPublish`) and a "Submit to QuizMatter" / "Submit again" button
  instead (store `submission`; "approved" says it's in QuizMatter). It saves unsaved edits, calls
  `submitToQuizMatter`, then opens the locked view page. QuizMatter presentations
  keep the Draft / Shared switch.
- `Workspace.tsx`: the scrolling list of slides (drag to reorder with `@dnd-kit`). Each slide is a
  `SlideWorkspaceItem` = `SlideToolbar` + `SlideCanvas`. It also draws `AnswerArea` (the answer of a short-answer,
  custom or blank slide) over itself.
- `SlideCanvas.tsx`: one 1280×720 slide (`CANVAS_WIDTH` / `CANVAS_HEIGHT` in `constants.ts`). It holds the boxes
  (`QuestionContainer`, `OptionCard` A–D, `SideContainer` = the shape box) and the elements (`SvgElementItem`, one
  per element). Embed slides (video, slide deck, picture) use `EmbedSlide` instead.
- `SvgElementItem.tsx`: one element: drag, resize (`handles.ts`: `CORNERS` / `EDGE_HANDLES`), rotate, crop.
  `ElementSvg` draws it, `TextBoxContent` is a text box, `DiagramBoxEditor` / `DiagramBoxButtons` are diagrams.
- Side panels (all use the `side-panel` class, sideways rows use `ScrollRow`): `ElementsPanel`, `PhotosPanel`,
  `ColorPanel`, `BackgroundPanel`, `EffectsPanel`, `PresentationsPanel`. They stay open after you add something
  (don't auto-close them).
- Teachers' own photo uploads are **for editors and admins only, for now** (`checkCanUpload` in
  `src/lib/photos.tsx`, which asks `is_editor` / `is_admin` once). Other teachers' "My Photos" tab shows "This will
  be available soon." with Upload and the link box greyed out, and a file dropped on a slide only shows a toast
  (`useElementDropTarget`). Old "My photos" still show and can be added. `upload-image` refuses them too (403).
  Admin → Photos and Claude's photo import still upload.
- Modals: `AnswerModal`, `DetailsModal` (title, grades, subject…), `SlideGridModal`, `ConfirmModal` (the app's one
  confirm box, used on every page; never the browser's `confirm()`).
- Review mode: `ReviewControls.tsx` (Save as draft + the ⋮ menu, and `ReviewBanner`).
- `SentBackBanner.tsx`: the yellow "QuizMatter sent this back" bar (a sent-back submission, or `ReviewBanner`), with
  "View comments" opening the admin's note in a `Modal`.

## State: `src/lib/store.ts` (zustand)

- Every change to the presentation is a store action (`addSlide`, `updateOption`, `setLayout`, …). Components never
  change the presentation themselves.
- **Never change a slide in place.** An action makes a new slide object. Saving sends only the slides that are not
  the same object as last time (`savePresentationToDb` with `savedSlides`), so an in-place change would never save.
- Undo / redo keep up to 100 past copies (`past` / `future`).
- UI-only state (picked element, open panel, zoom, typing box, picked diagram box) also lives in the store and is
  never saved.
- `savePresentation` saves (Save button, Ctrl+S): `saveReviewDraft` in review mode, else `savePresentationToDb`.
  It shows a sonner toast for success and for failure.
- **Kept work after an app update:** when a save (or a review's Submit) is refused because newer app code saved the
  presentation (`QMOLD`, `SaveRefusedError.isOutdated`), the unsaved presentation goes into this browser's storage
  (`src/lib/keptWork.ts`, key `qm-unsaved:<id>`) and `isOutdated` makes `Editor` show "QuizMatter was updated" with
  Reload (no "Leave page?" then; a quiet save before Share/Submit shows no second message). After the reload,
  `Editor` calls `restoreKeptWork`: only what was changed since the last save comes back, upgraded (changed slides
  and details; untouched slides, the publish switch and save times stay as just loaded, so they aren't sent again
  in the old shape), only in the same mode (owner's editor or review draft) and within 7 days. It's one undo step,
  unsaved, against the just-loaded save time, so saving replaces what the newer code saved (the toast says so and
  has "Throw away"). The old save time would always conflict, and that conflict's reload would lose the work. The
  kept copy stays in storage until a save or submit of that presentation works (`forgetKeptWork`).

## Helpers this folder uses (in `src/lib`)

`useEditorShortcuts` (keys), `useMarqueeSelection` (drag a rectangle to select), `useElementDropTarget` (drop from a
panel or the computer), `useCanvasTextEditor` + `richText.ts` (text typing, with tiptap), `useAutoFitText` (text
shrinks to fit), `useFormatTexts` (which texts the format toolbar changes), `geometry.ts` / `crop.ts` (math),
`svgLibrary.tsx` (every drawing in the Elements panel, and the diagram layouts).

## Diagrams (Flowchart, Cycle, Mind Map, Tree)

The "Diagrams" group of the Elements panel. Full design: `docs/superpowers/specs/2026-10-06-diagram-box-drag-design.md`. When changing them, keep these rules:

- **Each box works like a text box:** it keeps its size, its text shrinks to fit (size 12 down to 1), and a picked box has the same handles (corners keep the shape, side handles change width or height). Reuse `CORNERS` / `EDGE_HANDLES` from `src/components/editor/handles.ts`; don't make new handles.
- **One layout, two users:** the layouts in `svgLibrary.tsx` place every box, and `getDiagramBoxes` gives those same boxes to the editor (`DiagramBoxEditor.tsx`). Never place boxes a second way in the editor, or the outline won't match the drawing.
- **Text is typed on the slide** (double-click a box; Shift+Enter = new line, Enter/Esc/click outside = done). The panels have no text boxes, only box count, Across/Down, Tidy up, Reset (and the Tree's add/remove).
- **A box's own place and size** (`x, y, width, height`) are saved all together or not at all; missing = its automatic spot. Limits live in `constants.ts` and are checked by `diagramBoxSchema` (zod) before saving.
- **A box's own look** (`fill`, `border`, `borderWidth`, `textColor`, `fontSize`) is optional; missing = the diagram's Color tint and border, dark text, size 12. The toolbar's box style group and the Color panel (`boxFill` / `boxBorder` / `boxText`) change the picked box, or every box when none is picked, through `diagramStyleTargets` + `withDiagramBoxStyle`. Moving, Tidy up and new boxes keep or copy the look. Spec: `docs/superpowers/specs/2026-10-07-diagram-box-style-design.md`.
- **"+" and × on every box** of a selected diagram (`DiagramBoxButtons.tsx`) add a box next to it or remove it. The rules per diagram (where, limits, new text, copying the look) live only in `diagramBoxActions` (`svgLibrary.tsx`); the element is kept in place with `keepInPlace`. Spec: `docs/superpowers/specs/2026-10-07-diagram-box-add-remove-design.md`.
- **Nothing else moves on the slide** when the drawing area changes: use `keepInPlace` (dragging) or `useResizeForViewBox` (panel), which both keep the other boxes still.
- **Text widths are measured only once the fonts have loaded** (`fontsReady` from `ElementSvg.tsx`); before that, and on the server, use the estimate, so server and browser draw the same.
- **Picked / typing box** is UI state in the store (`pickedDiagramBox`, `editingDiagramBox`), never saved.
- **Claude** adds diagrams with `{ "text": … }` boxes only (automatic layout).
