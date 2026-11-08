# The editor (how it fits together)

The page `src/app/presentation/[id]/edit/page.tsx` loads the presentation on the server (`fetchPresentation`), picks
editor / view / review, and renders `Editor.tsx`, which calls `store.loadPresentation`.

## The pieces

- `Editor.tsx`: the frame. `EditorTopBar`, `IconRail` (the left icon bar that opens the side panels), `Workspace`,
  `EditorBottomBar` (zoom, which slide is showing, the slide grid, fullscreen present).
- `EditorTopBar.tsx`: Save, `ShareButton`, `ReviewControls`, and the toolbar for what is picked:
  `SelectedElementToolbar` (elements), `TextFormatToolbar` (text), `ShapeBoxToolbar`. `ArrangePanel` and
  `MathToolPanels` are drop-downs inside those toolbars (`ToolPanelButton` in `PanelControls.tsx`). One picked
  clock gets "Set time" (`clockTime`); one picked calendar gets "Set date" (`calendarDate`: the date box, and
  "Today"; an empty or half-typed date isn't saved). Both calendars share it, like both clocks share the time.
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
  per element). Embed slides (video, slide deck, picture) use `EmbedSlide` instead. New picture embed slides
  (`image`) can't be made any more, by the Add slide menu (`AddSlideMenu`) or by Claude (2026-11-04); old ones still
  open, present and edit, so the `image` type stays in the saved data.
- `SvgElementItem.tsx`: one element: drag, resize (`handles.ts`: `CORNERS` / `EDGE_HANDLES`), rotate, crop.
  `ElementSvg` draws it, `TextBoxContent` is a text box, `DiagramBoxEditor` / `DiagramBoxButtons` are diagrams,
  `TableContent.tsx` is a table (see "Tables").
- Side panels (all use the `side-panel` class, sideways rows use `ScrollRow`): `ElementsPanel`, `PhotosPanel`,
  `ColorPanel`, `BackgroundPanel`, `EffectsPanel`, `PresentationsPanel`. They stay open after you add something
  (don't auto-close them).
- Teachers' own photo uploads are **for editors and admins only, for now** (`checkCanUpload` in
  `src/lib/photos.tsx`, which asks `is_editor` / `is_admin` once). Other teachers' "My Photos" tab shows "This will
  be available soon." with Upload greyed out, and a file dropped on a slide only shows a toast
  (`useElementDropTarget`). Old "My photos" still show and can be added. `upload-image` refuses them too (403).
  Admin → Photos and Claude's photo import still upload.
- Modals: `AnswerModal`, `DetailsModal` (title, grades, subject…; the Author is locked text in review mode, on an
  editor's own presentation, and when the presentation is linked to an editor, store `isAuthorLinked` from the edit
  page's `authorId`: the database always writes their name there), `SlideGridModal`, `ConfirmModal` (the app's one
  confirm box, used on every page; never the browser's `confirm()`; an optional middle button, `secondaryLabel` +
  `onSecondary`, for a third choice like Admin → Announcements' "Save as draft").
- A Claude draft whose slides can't be built (`buildSlides` errors) opens a `Modal` in `Editor` listing the errors.
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
  (`src/lib/keptWork.ts`, key `qm-unsaved:<id>`, through the store's `keepWorkNow`) and `isOutdated` makes `Editor`
  show "QuizMatter was updated" with Reload (not focused, as it can pop up while typing). Reloading or closing the tab
  keeps the work once more (in `Editor`'s `beforeunload` handler), so edits made since the box opened are in it. No
  "Leave page?" then, unless the browser couldn't store the work (`keptInBrowser` false): the box says so instead of
  "Your changes are safe". A quiet save before Share/Submit shows no second message, and the Share card's own box
  closes. Maintenance does the same without the box: `MaintenanceWatch` sends `MAINTENANCE_EVENT` before moving the
  tab to `/maintenance`, and the `beforeunload` handler keeps the work instead of asking.
  After the reload, `Editor` calls `restoreKeptWork`: only
  what was changed since the last save comes back, upgraded (changed slides
  and details; untouched slides, the publish switch and save times stay as just loaded, so they aren't sent again
  in the old shape; slides a newer save added stay, ones it deleted stay deleted unless this tab changed them, see
  `src/lib/CLAUDE.md`), only in the same mode (owner's editor or review draft) and within 7 days. It's one undo step,
  unsaved, against the just-loaded save time, so saving replaces what the newer code saved (the toast says so and
  has "Throw away"). The old save time would always conflict, and that conflict's reload would lose the work. The
  kept copy stays in storage until a save or submit of that presentation works, or Stop review throws the work away
  (`forgetKeptWork`).
- **Leaving the editor saves first:** moving away inside the app with unsaved changes (browser Back/Forward, any
  link, the ← arrow) runs the store's `saveBeforeLeaving`: a normal `savePresentation` with its toast (a review saves
  its draft). `Editor` runs it when it closes; the ← arrow (`BackToPresentationsLink`, no "Leave without saving?"
  box) runs it first with the Spinner in the button, and goes only if it worked or the work was kept. The work is
  kept in this browser (`keepUnsavedWork`) as soon as the editor is left and again just before it's sent, since a
  closed editor can't ask "Leave page?" and closing the tab could stop the save; a save that works forgets it. If the
  save fails, it stays and comes back the next time the presentation opens; a toast says so. If even that fails:
  "Couldn't save your changes." and the arrow stays. Closing or reloading the tab while the editor is open still asks
  "Leave page?" (a save can't finish then).
- **Leaving never saves a Claude draft** (the user's decision, 2026-10-26): only Save / Ctrl+S makes it a
  presentation. The store's `claudeDraft` is Claude's draft as it opened (set by `Editor` before kept work comes
  back; null once it's saved). Left unchanged (`presentation === claudeDraft`): nothing is saved or kept, no toast,
  and it stays a draft in the list. A box fitting its drawing as it first shows (`tidyUp`) doesn't count as a change.
  Left changed: the changes are only kept in this browser (`keepUnsavedWork` with no saved copy, so all of it counts
  as unsaved; at once, and again as it is after the waits below), with the toast "Your changes are kept in this
  browser. Open the draft and click Save to make it a presentation." Opening the draft's link again puts them back
  over Claude's slides (`restoreKeptWork`, "Your unsaved changes are back"). If the browser can't keep them:
  "Couldn't keep your changes in this browser." and the arrow stays. Once saved, it's a normal presentation, and
  leaving saves it (also when a Save / Ctrl+S still running as it was left works: the leave-save waits for it, then
  saves what's left as usual). Closing the tab on a draft still asks "Leave page?".
- **Opening waits for that save:** while a leave-save runs, `Editor` shows the Spinner and opens its presentation
  only after it (`waitForLeavingSave`), so opening the editor doesn't replace the store mid-save. A Present button
  on another page doesn't wait: the save then leaves the newly loaded store alone (`isStillOpen` in
  `savePresentation`) and, if it fails, keeps what it sent. A leave-save first waits for a running Save / Ctrl+S to
  really end (`whenNotSaving`, even if something else was opened meanwhile). If a Present button opened something
  while it waited (`openCount`, even the same presentation), it can't save from the store: it keeps what was left,
  with the toast, unless that Save / Ctrl+S saved exactly it. Browser Back/Forward shows the page as
  it first loaded, so the editor opens what the last save in this tab saved (`lastSaveOf`, kept apart from the store,
  so a Present button elsewhere can't hide it) when that's newer than the page, or always for a Claude draft's page.
  Stop review forgets it (`forgetLastSave`) and any kept copy (`forgetKeptWork`), and marks the store as it is now
  as saved, so a new review doesn't open the thrown-away draft and leaving doesn't save or keep it. React's dev mode
  closes and reopens the editor at once: the leave-save checks a moment later (`stillLeaving`) and skips the save
  (what it kept right away stays until the next save).

## Hidden slides

A slide can be hidden from presenting (the slide's `hidden` field, `DATA_VERSION` 1). The eye button on its
`SlideToolbar` calls the store's `toggleSlideHidden` (undoable). A hidden slide:

- **Is locked:** the store's `updateSlide` leaves a hidden slide alone, so no edit reaches it (panels, shortcuts,
  paste). `SlideWorkspaceItem` draws it with the read-only `SlideStaticView`, greyed out. Its toolbar keeps only Show
  slide, move up/down, drag and delete, with a "Hidden" pill. "Apply to all slides" (background) skips it.
- **Takes no number:** `getSlideNumbers` skips it, so the slides after it close the gap, the same in the editor, the
  grids and presenting.
- **Is skipped when presenting:** `startPresentation` / `nextPresentationSlide` / `prevPresentationSlide` use
  `presentStartIndex` and `stepPresentation` (`constants.ts`, tests `constants.test.ts`). When every slide is hidden
  nothing is skipped. The "Show all slides" grid still opens it.
- **Looks hidden in every small picture:** `HiddenSlideMark` (`FluidSlidePreview.tsx`) fades it with an eye-off mark,
  in `FluidSlidePreview` and `SlideThumbnailPreview` (grids, view page, cards).
- Copies (Make a copy, shared copies, QuizMatter approvals) carry `hidden` along, since it's part of the slide's data.

## Tables

The "Table" tile in the Elements panel. Design: `docs/superpowers/specs/2026-11-08-table-element-design.md`; math:
`src/lib/table.ts`; browser test: `e2e/table-element.mjs`. When changing them, keep these rules:

- **One grid everywhere:** `TableGrid` (`ElementSvg.tsx`) draws a table in the editor, small pictures, presenting and
  drag previews, each cell a read-only `SlideText`. Its lines are the element's Color showing through 2 px gaps between
  white cells, so a gradient works. `tableCellBox` must match that layout: it places the picked cell's outline.
- **Only the cell being typed in has a text editor** (`TextBoxContent` inside `TableContent`), never one per cell: a
  13 × 13 times table would be far too heavy.
- **Picked / typing cell** is UI state in the store (`pickedTableCell`; `typingAt` is set while typing), never saved.
  The first click selects the table, a click on a cell picks it, a double-click types. A cell is found with
  `tableCellAt` (by screen position, since a dragged element's events all point at it). While typing, a press on
  another cell only stops the typing (the old cell blurs); the click that follows moves it there (`wasTypingOnPress`).
- **Keys while typing** are handled in `TableContent` before the text editor sees them: Tab / Shift+Tab move between
  cells (they stay put at the first and last cell), Escape stops typing. With a cell picked and not typing,
  `useEditorShortcuts` makes Delete empty the cell (not delete the table) and Escape let go of it.
- **Adding and deleting:** the two "+" (`TableButtons`) add at the end, the toolbar's "Table" menu (`TablePanel`) acts
  on the picked cell or else the last one, then picks the new cell. A new row or column keeps the others' size, so the
  table grows, up to the edge of its box (`addTableRow` / `addTableColumn`); from there they share the room.
- **All rows are the same height and all columns the same width.** A cell keeps its size and its text shrinks to fit.
- **Text size is the whole table's** (`table.fontSize`; `TextTarget` kind `table`), from the toolbar or the text
  format bar while typing. The other text styles are each cell's own, in its HTML.
- **Limits:** `TABLE_ROWS` and `TABLE_COLUMNS` (`constants.ts`), checked by the `table` zod schema. Never flipped or
  cropped. Claude can read a table's text (`read_presentation`) but can't make one (left out of `ASSET_IDS`).

## Helpers this folder uses (in `src/lib`)

`useEditorShortcuts` (keys; Ctrl+V pastes a copied element only when no input, textarea, rich text or dialog has
focus, and Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z leave a plain input or textarea to the browser's own typing undo, while rich
text on a slide keeps the store's undo; `isTextFieldOrDialog` in `dom.ts`), `useMarqueeSelection` (drag a rectangle to select), `useElementDropTarget` (drop from a
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
