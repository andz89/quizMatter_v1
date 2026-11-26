# The editor (how it fits together)

The page `src/app/presentation/[id]/edit/page.tsx` loads the presentation on the server (`fetchPresentation`), picks
editor / view / review, and renders `Editor.tsx`, which calls `store.loadPresentation`.

## The pieces

- `Editor.tsx`: the frame. `EditorTopBar`, `IconRail` (the left icon bar that opens the side panels), `Workspace`,
  `EditorBottomBar` (zoom, which slide is showing, the slide grid, fullscreen present).
- `EditorTopBar.tsx`: Save, `ShareButton`, `ReviewControls`, the download button (`DownloadButton`, the store's
  presentation, unsaved edits too), and the toolbar for what is picked:
  `SelectedElementToolbar` (elements), `TextFormatToolbar` (text), `ShapeBoxToolbar`. The text bar's "Aa" (Change
  case: UPPERCASE, lowercase, Sentence case, Capitalize Each Word; `applyTextCase`, `src/lib/textCase.ts`) rewrites
  the real letters, keeping bold and colors, on the selected words while typing, else all the text (like the other
  buttons, `formatChain`); one undo step, nothing new saved (spec
  `docs/superpowers/specs/2026-11-25-text-case-design.md`, test `e2e/text-case.mjs`). At 1280 px the middle toolbars
  share 640 px (half the bar), so every text bar button is 28 px wide (`ToolButton`, the color button, and the size
  picker's − / +, which the table and diagram bars share); check `e2e/save-button-width.mjs` after adding one. From laptop width they sit in
  the middle of the bar, pinned 6 px from its top; when two don't fit on one line (typing in a table: text bar +
  table bar) the second row hangs below the bar instead of the first being pushed off the screen (test
  `e2e/toolbar-rows.mjs`). `ArrangePanel` and
  `MathToolPanels` are drop-downs inside those toolbars (`ToolPanelButton` in `PanelControls.tsx`). One picked
  clock gets "Set time" (`clockTime`); one picked calendar gets "Set date" (`calendarDate`: the date box, and
  "Today"; `DateBox` lets typing pass through dates that can't be saved, like the year "0002" or 31 February, and
  only a real date reaches the calendar; leaving the box shows the calendar's date again). Both calendars share it,
  like both clocks share the time. A button that changes nothing (Reset, Today) isn't an edit: `updateElements` skips
  a patch with the values the element already has, the toolbar's setters write "no value" for a default, and
  `MathToolControls` skips a change that lands on what a tool already shows, saved or not, in any key order
  (`sameValue`: a saved setting comes back from the database with its keys re-sorted).
- `ShareButton.tsx` (the Share card): a teacher's Published = a shared copy (store `sharedCopy`). It says "up to
  date" or "You have changes the shared copy doesn't have" (unsaved edits, or saved after `sharedCopy.sharedAt`),
  with "Update shared presentation". When QuizMatter hid the copy (`sharedCopy.isHidden`) it says so, Private and
  Copy link are off, and "Update shared presentation" and the up-to-date line don't show (`share_presentation`
  refuses a hidden copy). Refusals show the database's own reason. Editors get Published greyed out (store `canPublish`) and a "Submit to QuizMatter" / "Submit again" button
  instead (store `submission`; "approved" says it's in QuizMatter). It saves unsaved edits, calls
  `submitToQuizMatter`, then opens the locked view page. QuizMatter presentations
  keep the Draft / Shared switch.
- `Workspace.tsx`: the scrolling list of slides (drag to reorder with `@dnd-kit`). Each slide is a
  `SlideWorkspaceItem` = `SlideToolbar` + `SlideCanvas`. It also draws `AnswerArea` (the answer of a short-answer,
  custom or blank slide) over itself. Zoomed past the screen's width, the list grows (`w-max`), so both edges of a
  slide can be scrolled to; a zoom change or a side panel narrowing the area centers it again.
- `SlideCanvas.tsx`: one 1280×720 slide (`CANVAS_WIDTH` / `CANVAS_HEIGHT` in `constants.ts`). It holds the boxes
  (`QuestionContainer`, `OptionCard` A–D, `SideContainer` = the shape box) and the elements (`SvgElementItem`, one
  per element). Embed slides (video, slide deck, picture) use `EmbedSlide` instead. New picture embed slides
  (`image`) can't be made any more, by the Add slide menu (`AddSlideMenu`) or by Claude (2026-11-04); old ones still
  open, present and edit, so the `image` type stays in the saved data. Outside the editor (`EmbedSlideView`: home
  cards, the view page, presenting) a picture from a website a teacher typed doesn't load by itself, since that
  website would see the internet address of everyone who only looks: the slide says "Picture from example.com", and
  while presenting "Show picture" loads it (`ViewerPicture`; `outsidePictureHost` in `src/lib/embed.ts`; Google
  Drive's pictures load at once; a shown one stays shown until the tab reloads). The editor loads it as before. The
  video / deck frame (`EmbedPlayer`) is sandboxed: scripts, its own site's storage, new tabs, forms and fullscreen,
  but never `allow-top-navigation` (the site can't move the teacher's tab). Keep both if this changes.
- `SvgElementItem.tsx`: one element: drag, resize (`handles.ts`: `CORNERS` / `EDGE_HANDLES`), rotate, crop.
  Dropped on a question or answer box, an element moves into it (`boxAtPoint` looks under the dragged picture). Not
  the box the drag began over, so nudging a free picture lying over a box leaves it free; hold Alt to lay a free
  picture over a box. A corner dragged past the opposite one stops at the smallest size (`cornerDragScale`).
  Letters and emoji are `<text>`, measured to trim them: `ElementSvg` draws them with `textRendering="geometricPrecision"`,
  or the browser's size-based adjusting would change their boxes each time a presentation opens.
  `ElementSvg` draws it, `TextBoxContent` is a text box, `DiagramBoxEditor` / `DiagramBoxButtons` are diagrams,
  `TableContent.tsx` is a table (see "Tables").
- Side panels (all use the `side-panel` class, sideways rows use `ScrollRow`): `ElementsPanel`, `PhotosPanel`,
  `ColorPanel`, `BackgroundPanel`, `EffectsPanel`, `PresentationsPanel`, `WordFilePanel`, `LayersPanel`. They stay
  open after you add something (don't auto-close them). Only one is open at a time: each toggle in the store closes
  the others, so a new panel adds its `is…Open: next ? false : …` line to every toggle.
- **Effects panel** (`EffectsPanel`, spec `docs/superpowers/specs/2026-11-26-element-effects-design.md`): two tabs.
  "Slide effects" = the presentation's `transition` / `transitionSpeed`. "Element effects" (only Blank and Title
  slides, `canHaveElementEffects`; other slides get a note): the picked elements' None / Fade / Pop up and speed
  (`setElementEffect`, whole groups; a new one comes in last, one already set keeps its step), then "On this slide",
  the steps in order (`effectSteps`): click selects, drag reorders (`moveElementEffect`, `@dnd-kit`), ✕ removes.
  Both tabs share `SpeedControl`. While the panel is open, `SvgElementItem` shows each element's step number at its
  top-left (editor only). Duplicate and paste keep a copy's effect but put it last (`effectsToEnd`). The math is in
  `src/lib/elementEffects.ts`; presenting in `src/components/presentation/CLAUDE.md`.
- **Color panel** (`ColorPanel`): one panel for every color target (text, shapes, borders, table cells, diagram
  boxes, the shape box), all through its `handleColor`. 36 Solid colors (the first 18 are the originals, kept in place
  so colors already used still show as picked), 12 Light, the Gradients. "Custom" (spec
  `docs/superpowers/specs/2026-11-25-custom-colors-design.md`, test `e2e/custom-colors.mjs`): the rainbow "+" opens
  `CustomColorPicker` (a shade square, a hue bar, a hex box; math in `src/lib/colors.ts`), then Recent colors (custom
  ones used, up to 11, newest first; this browser only, `localStorage` `qm-recent-colors`). The square and bar never
  take the focus (a drag keeps typing and its picked words). A drag is one undo step however long it pauses (the
  store's `beginHistoryStep` / `endHistoryStep`), and goes into Recent only if it changed the color. The hex box
  needs the focus, which ends typing: a press on it first reads each typed-in text's picked words (`pressedWords`,
  with what was picked then, `selectionKey`), and Enter / leaving colors those words (a cursor with no words picked
  colors the whole text instead; a table cell's editor is gone by then, so its words, or with no words picked the
  whole cell, are colored in its saved text with `colorSavedText`). After that the panel keeps those words
  (`wordPick`): the picker shows their color and the square / hue bar keep coloring them, until something else is
  picked, typing starts again or a swatch is clicked. The hex box always uses its value (the color shown can be
  only a start: Quiz Violet when there's no one solid color). Nothing colored = nothing in Recent. The focus moving
  into the panel (`data-color-panel`) keeps it open (`setActiveTextEditor`'s `keepColorPanel`). Saved colors stay
  `#RRGGBB`: no data change.
- **Layers panel** (`LayersPanel`, the rail's "Layers", like Canva's; spec
  `docs/superpowers/specs/2026-11-25-layers-panel-design.md`): the selected slide's elements, one list per box, top
  layer first, since elements only overlap inside their box. `shownLayerBoxes` (`src/lib/layers.ts`) gives only the
  boxes the teacher can see now, in their order on the slide: "On the slide", "Question" (not on blank, title or
  custom slides), "Answer A"–"D" (choice slides; True or false only A and B), "Shape box" (when the slide has one;
  a strip is listed before the answers, as it sits above them, a box beside the rows after them). While the answer's
  modal is open (`answerSlideId`), it covers the slide, so only "Answer" / "Reveal" is listed (a drawn answer,
  `answerType` "canvas"); while it's closed, that box isn't. Elements kept in a box the slide doesn't show aren't
  listed (picking them would select something invisible). A hidden slide (locked) and an embed slide show a
  note instead. A group is one row ("Group · N items") whose ▸ shows its members. A row's name is a text box's
  first 40 characters (whole characters, so an emoji isn't cut), "Table", "Photo", "Drawing", or the asset's label.
  Click, or Enter / Space on a focused row = select (a group row the whole group, a member row only that member;
  with Shift / Ctrl / Cmd the same is added or taken out), so an element
  hidden behind another can be picked; its handles are drawn above everything in its box (a box draws its elements
  in two passes like the slide's two layers, `BoxElements` in `SvgElementItem.tsx`: pictures, then outlines and
  handles), and arrow keys, the toolbar and Arrange then work on it (dragging its body on the slide still grabs
  what's on top). Hover = the store's `hoveredLayerIds`, drawn by `SvgElementItem`'s selection part as a 2 px violet
  outline (not saved, not in undo); a hovered row that goes (its element deleted) clears it, or undo would bring the
  element back outlined. Drag a row (`@dnd-kit`, one list per box and per open group; an open group's members
  move with its row; `sameListOnly` makes only rows of its own list drop targets, so a drop near the next box still lands in its own) =
  `reorderLayers` → `moveLayer`: just above or below the row it's dropped on, past a whole group, a member only
  among its own group; one undo step; a drop that changes nothing makes none. Only `slide.elements`' order changes,
  so nothing new is saved.
  **Speed (up to 1,000 rows):** a redrawn `DndContext` hands every draggable row new values, redrawing all of them,
  so the panel keeps it still: `LayersPanel` is memoized (Editor redraws on each selection change) and reads only
  yes / no facts about the slide; its sensor options, modifiers and drop handler never change while the slide stays
  the same; only `LayerBoxes` inside it follows the slide's elements. Rows (`ElementRow`, `GroupRow`, `BoxRows`) are
  memoized, each box's ids keep their array while they don't change (`useSameIds`, or `SortableContext` would
  redraw every row), and a row's "selected" is a yes / no from the store. So moving an element on the slide redraws
  only its own row (before this, 1,000 rows redrew on each move). Rows out of sight skip drawing
  (`content-visibility`). An element's row is the list item itself, its fixed height on the same node as
  `content-visibility`: each small picture measures itself, and inside a wrapper each measure laid out the whole
  list (3× slower). Only a group's row has a wrapper list item, which also holds its members. Test: `e2e/layers-panel.mjs`; the math: `src/lib/layers.test.ts`.
- **Word file panel** (`WordFilePanel`, the rail's "Word file"; spec
  `docs/superpowers/specs/2026-11-21-word-file-panel-design.md`): a teacher opens a `.docx` (`readWordFile`,
  `src/lib/wordFile.ts`, read in the browser only: never uploaded or saved, so no Privacy Policy line) and sees its
  text one line per piece (`wordLines`; pictures left out; at most `WORD_LINES_MAX`), each with Copy. A line is
  dragged under `TEXT_DRAG_MIME` (only our own type: ProseMirror's drop reads only plain text, HTML or links, so the
  box's Tiptap lets it through) onto a question box or answer choice (`useElementDropTarget`'s `onTextDrop`, given
  only by `QuestionContainer` and `OptionCard`). Touch screens can't drag: a tap on a line's handle holds it (store
  `heldWordLine`, the line's place in the list, so a twin line isn't held too; a new file lets go; a "Tap a box" note; Escape or Cancel lets go; closing the panel too), every box is tinted, and the
  box's `onClickCapture` takes the next tap. Both end in the store's `putLineInBox`: it removes a leading "1." / "a)"
  / "II." (`stripItemMark`; a letter only from an answer box), refuses a line over `PLAIN_TEXT_MAX` (`TEXT_LIMIT_MESSAGE`), and replaces the box's text
  keeping its first paragraph's settings (`droppedTextHtml`), through `updateQuestion` / `updateOption` (one undo
  step). The list is `wordFile` in the store: kept while the panel is closed, gone on reload.
  Each line also has a checkbox: ticked lines (at most `PICKED_LINES_MAX`, 5) fill a "New slide" preview card that floats beside the panel, at its top, over the slides
  (`pickedSlideTexts`: the first ticked is the question, the next ones A–D in click order, marks removed); from 2
  ticks, "Add as a new slide" adds a choice slide after the active one (`insertSlides`, which keeps the slide limit)
  and clears the ticks (component state, so closing the panel clears them too).
  Layout: only the list of lines scrolls; above it, once a file is open, one row holds the file name and icon buttons
  whose words show on hover (Open another file, Show / Hide suggestions with the count found, ⓘ for the help text),
  so the list keeps the room. Before a file is open: the big "Open a Word file" button and its help line.
  "Show suggestions" (off until clicked; off again for a new file) colors each item `suggestItems` finds: a
  numbered line ("1.", "2)", "____ 3.", or numbered by Word's list button, read from `numbering.xml`) as the question (violet row) and the lines under it, up to 4 and stopping at
  the next numbered line, as its choices (violet edge, indented; lettered ones in A–D order, since two columns read A, C, B, D); 2
  choices at least. The question row's Create adds
  that item like Add as a new slide, then says "Added" (Mint; a click adds it again).
  Test: `e2e/word-file.mjs`.
- **Slides from other presentations** (`PresentationsPanel`): published presentations (not this one or its shared
  copy) in a row per subject, plus a Saved tab. Opening one refuses a presentation saved by newer app code
  (`isNewerThanApp`, the `QMOLD` words) and leaves out a slide that doesn't parse. A click on a slide adds a copy right
  after the active slide; a drag carries `slideDragData` (the slide and this tab's `DATA_VERSION`, `src/lib/slideDrag.ts`)
  under `SLIDE_DRAG_MIME`. `Workspace` drops it right after the slide under the pointer (or the nearest one in a gap),
  or before slide 1 on its top half, and shows the line where it will go (`dropTarget`). The drop reads it with
  `readSlideDrag` (zod): from newer app code (another tab) → the `QMOLD` toast, not a copy missing fields; not a slide
  → a toast. Both ways end in the store's `insertSlides` (new ids for the slide, options and elements via
  `duplicateSlide`, so a picture stays in its answer box; one undo step; refused past `MAX_SLIDES`). Test:
  `e2e/slide-drag.mjs`.
- **Photo storage** in the Photos panel's "My Photos" tab (root `CLAUDE.md`, "Photo Storage"): `PhotoStorageBar`
  ("1.8 MB of 50 MB", or of 500 MB for an editor; coral with `storageFullMessage` when full, and Upload greyed out), read each time the tab
  opens and after each save while it's open (`savedAt`: a save may free space), and updated by `watchPhotoStorage`;
  not for admins (no limit). Removing a photo: one `removeMyPhoto` call (`if_unused`, the tile goes at once); when
  the open presentation has it on a slide (maybe unsaved; never in review mode, a draft doesn't count) it asks first
  (`ask`). If a slide of theirs has it and it counts (`bytes` and `limit` filled), `ConfirmModal` lists where
  (`stillUsedMessage`; its message keeps line breaks) and "Remove from My photos" removes it anyway, with
  `STILL_COUNTS_TOAST`; when it counts for nothing (an admin, a photo they didn't upload) it's removed without the
  box. A failed remove puts back only that photo, so an upload that finished meanwhile stays. Test: `e2e/photo-storage.mjs`.
- **Every teacher uploads their own photos** (opened 2026-11-26, once the storage limit was in; spec
  `docs/superpowers/specs/2026-11-26-open-photo-uploads-design.md`): the "My Photos" tab's Upload and a file dropped
  on a slide; Upload greys out only while paused or full. Test: `e2e/photo-uploads.mjs`.
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
- Undo / redo keep up to 100 past copies (`past` / `future`). Their top-bar buttons keep the picked element
  (`data-keep-container-selection`), so an open panel like Set time stays open and shows the undone value.
- UI-only state (picked element, open panel, zoom, typing box, picked diagram box) also lives in the store and is
  never saved.
- `savePresentation` saves (Save button, Ctrl+S): `saveReviewDraft` in review mode, else `savePresentationToDb`.
  It shows a sonner toast for success and for failure.
- **Auto save:** `Editor`'s timer calls the store's `autoSave` every 12 seconds (`AUTO_SAVE_MS`, `src/lib/autoSave.ts`):
  a quiet `savePresentation` (the Save button shows the Spinner at its same size, no toast), only when there are
  changes. Tests: `e2e/auto-save.mjs`, `e2e/save-button-width.mjs` (from laptop width the toolbar sits in a fixed spot
  in the middle of the bar, so a wider Save button would run into it). It holds back:
  - on a **Claude draft** (only Save makes it a presentation) and a **live QuizMatter lesson** (`fromAdmin` and
    published: every teacher would see half-done edits at once; a review of one does auto save, to its own draft);
  - after a **refused save** (`SaveRefusedError`: one toast, not one every 12 seconds) and while **restored work**
    waits for Save or Throw away (`autoSaveIsStopped`), until a save works or another presentation opens. A lost
    connection isn't a refusal, so it tries again quietly;
  - while saving is **paused** by a click limit, during a leave-save, and while a step that sends the presentation
    itself runs (`withoutAutoSave`: the review's Submit and Stop). Share and Submit to QuizMatter wait for a running
    save first (`whenNotSaving`);
  - after **600 auto saves in a day** in this browser, Philippine time (`AUTO_SAVES_PER_DAY`), with one toast. Each
    one counts toward the database's 1,000 saves a day, and three days in a row at that limit bans the account. A
    review draft isn't counted by the database, so it has no cap. Save and Ctrl+S always work.
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
- **Kept work after a conflict:** when a save is refused because another tab or device saved since (`QM409`,
  `SaveRefusedError.isConflict`), the store keeps the work the same way (`keepWorkNow`) and sets `isConflict`; its
  toast says "Reload the page: your changes here are kept and come back on top of the newest copy." Reloading or
  closing the tab then keeps it once more without "Leave page?" (the same `beforeunload` handler), and after the
  reload `restoreKeptWork` merges it over the newest copy with "Saving them replaces what was saved since" and Throw
  away. Before this, the reload the toast asked for threw this tab's edits away (only leaving with the ← arrow kept
  them). If the browser can't store it, the toast keeps the plain `QM409` words and "Leave page?" still asks.
  Review Submit's own conflict doesn't keep anything (`REFUSALS.QM409` is unchanged).
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

## Slide text size

Text on a slide (question, answer choices, text boxes, table cells) always shows at its chosen size: it never
shrinks to fit (removed 2026-11-18). Text that reaches the box's edge goes onto a new line, a word too long for the
box breaks in the middle, and lines past the box's bottom are cut off until the box is made bigger or the size
smaller. The editor (`EditableText`, `TextBoxContent`) and the read-only `SlideText` (thumbnails, presenting) wrap
the same way. Diagram boxes are different: their text still shrinks (see "Diagrams").

**Fill-in blanks ("___") show as one line.** Lexend draws `_` 0.1em narrower than the room it takes, so a row of
them showed gaps. A run of two or more underscores gets the `qm-blank` class (`globals.css`: `letter-spacing:
-0.1em`), display only: the editor marks it with the `BlankLines` Tiptap decoration (`src/lib/blankLines.ts`, in
`useCanvasTextEditor`), `SlideText`, `measureOptions` and `textFit`'s word widths with `markBlanks` (`src/lib/blanks.ts`). `getHTML()` and the
saved text never get the span, so no `DATA_VERSION` change. Diagram boxes (a textarea / SVG text) aren't marked.
Test: `e2e/blank-lines.mjs`.

So a teacher doesn't miss cut-off text, the editor shows a Sunny "+…" (24 px) hanging over the bottom-right corner (a third outside) of any text
whose letters are cut at its box's bottom (`HiddenTextMark.tsx`, hover says why; on the question, answer choices and
text boxes a click on it fits the text, see "Option row heights"): the question, answer choices and text boxes
(`useCanvasTextEditor` returns `hasHiddenText`). **Tables show no mark at all (the user's rule, 2026-11-19):** no
"+…" and no grow mark on any cell, typed in or not (`isTableCell` in `useCanvasTextEditor` turns the check off); a
cut-off cell is just clipped. The question, answer
choices and text boxes use `useTextRoom` (`src/lib`), which calls `measureRoom` (`src/lib/textFit.ts`): a hidden, unrotated copy of the text at the box's real width (so a turned or
zoomed box, or one scrolled while typing, measures the same) and its last line's letters. Lexend keeps the bottom
fifth of a line for letters that hang down (g, y, p, a comma), so cutting only that room off a last line without such
letters doesn't count (`isCutOff`, `src/lib/textRoom.ts`; a "uniform." whose empty room is cut shows whole). It watches the
box's size and everything inside it (and checks again once the fonts have loaded), so typing, undo, a size change
or resizing the box updates it at once. The mark takes the mouse, so its tip shows. Where it can't fit the text a press
on it still reaches the box (select, drag, double-click to type); where it can, the press and click stay on the mark. Either way it keeps the focus (`preventDefault` on mousedown), so pressing it while
typing doesn't stop the typing. Typing near the bottom scrolls the box to the cursor (hidden overflow can still
scroll), so `useCanvasTextEditor` scrolls it back to the top when typing stops: the text's start always shows. It is
editor only: thumbnails, the view page and presenting never show it. Test: `e2e/hidden-text-mark.mjs`.

The size control is `FontSizePicker` (`TextFormatToolbar.tsx`; also tables and diagram boxes): − / the size box / +.
− and + step by 1; the box takes any whole number (Enter or leaving the box uses it, clamped to the `range` it's
given: `FONT_SIZE_RANGE` 12–96 for text, `DIAGRAM_FONT_SIZE` for diagrams; Escape puts the old one back; ↑ / ↓ step
by 1); clicking it opens the list of common sizes. A typed size goes to the text(s) picked when the box got the
focus, even when the click that leaves the box picks another one first; − / + or a list pick drops a typed size that
wasn't used yet. What blur does is kept in refs, since `blur()` runs it before React redraws. The box stops mousedown from reaching the text toolbar (which
keeps focus in the text), so clicking it while typing ends the typing.

## Option row heights

The option rows share the options area by their text (spec: `docs/superpowers/specs/2026-11-18-option-row-heights-design.md`;
math: `src/lib/optionRows.ts`; test: `e2e/option-rows.mjs`). **Nothing here changes a text size by itself**: every option
keeps its own until the teacher changes it (the size box, or a click on its "+…" mark, below).

- **Saved as shares**, numbers that only count compared with each other: each option's `rowSize` in the list layouts
  (it moves with the option on Shuffle and reorder), the slide's `gridRowSizes` in a grid (by place). Missing = equal
  rows. `getOptionRowHeights` (`constants.ts`) turns them into heights for `getContainerBounds`, and
  `getOptionsGridStyle` into the options grid's rows (as `minmax(0, Nfr)`, so they always fill the real area and never
  pass its bottom) in `SlideCanvas` and `SlideStaticView` alike.
- **Fit the text on a click** (the only size change here, and only the teacher's click; there's no Fit button:
  removed 2026-11-18, the user's choice). On the question and answer choices (`canFit` on `EditableText`, from
  `QuestionContainer` and `OptionCard`) and text boxes (`TextBoxContent`; their grow mark shows only while selected; table cells have no marks): a click on "+…" (cut off) makes the text smaller, and a click on the grow mark (`GrowTextMark.tsx`, an
  `ALargeSmallIcon`; both marks sit outside the box (`src/lib/markPlace.ts`), 12 px above it (past the corner handles), their
  right edge lined up with the box's right edge, so they never cover the text or handles on a small box; a text box near the slide's top
  edge (the slide cuts off what passes it) gets them under it instead (or beside it, tops lined up, when there's no room above or under) (`markSide`, from `SvgElementItem`),
  inside its corner only when it's nearly as big as the whole slide; the gap is see-through padding of the mark's
  holder, so a hover-only mark keeps the box hovered and a press reaches the handle under it; shown while the box is hovered or selected, never while typing, on empty text or
  at 96 px, and only when the next size up really fits) makes it bigger. Both call `fittingSize` (`src/lib/textFit.ts`)
  on the real text box: the hidden copy at each size, the range halved each try (`largestFittingSize` in `textRoom.ts`,
  about 7 tries), keeping the biggest that is no taller than the box and breaks no word (all words measured once, in
  one pass, then scaled; a word too wide even at 12 px, like a web address, is ignored); then `setTextFontSizes` (one
  undo step). The grow mark's check (`measureRoom` with `withSpare`, asked only while that mark can show:
  `checkSpareRoom` in `useCanvasTextEditor`) uses the same measure, so it never offers a size the click can't give.
  The box's height stays. Both marks keep their press (`stopPropagation` on pointerdown), or a text box's drag would
  take the pointer and swallow the click. The hidden copy drops `contenteditable` and ids and is emptied after each
  measure (a copy of the typing editor broke "is anyone typing").
- **Lines between list rows** (`OptionRowLines.tsx`, in the 12 px gap, the `ResizeHandle` look): dragging one makes one
  row taller and its neighbor shorter, each down to one line of its own text or its lowest picture, whichever is
  taller (`moveRowLine`, `rowMin`), so a drag never squeezes a picture; ↑ / ↓ move it by 6. Each line is placed with
  the rows' own shares (`lineTop`, a CSS `calc`), so it sits in the middle of the real gap. Its ↑ / ↓ stop there (the
  editor's arrow keys would also move a selected picture), and it sits under an option's "+…" mark (`z-[5]` vs
  `z-10`), which hangs into the gap. The store's `setOptionRowHeights`. Undo takes back a drag (the history joins changes less than
  half a second apart, so a drag that pauses longer takes more than one undo).
- **Grid:** no lines. Its rows are fitted again after Shuffle and reorder (`refitGridRows`, rows only: it measures
  each option with `measureOptionNeeds`, its text at its own size and full width plus its lowest picture), each as tall
  as its taller option, so a column never runs off the slide. Not while typing: "+…" tells the teacher.
- **Pictures in an option sit on top of its text, like the question box's:** the text always spans the whole option
  (`OptionCard`, `SlideStaticView`), and the element layer is drawn over it. (Before 2026-11-18 the text kept to the
  left half when the option had a picture.)
- Pictures in an option stay as they are while they fit their row and only shrink when it gets too short for them
  (`fitIntoRow`, never grown), so a grid's Shuffle doesn't keep resizing them. Their
  room counts the card's border (`OPTION_BORDER`).
- The lines and the question box / picture strip's resize bar (`ResizeHandle`) share one look: a violet bar, solid on
  hover (the lines add a faint dashed line across the gap).

## Tables

The "Table" tile in the Elements panel. Design: `docs/superpowers/specs/2026-11-08-table-element-design.md`; math:
`src/lib/table.ts`; browser tests: `e2e/table-element.mjs`, `e2e/table-overflow.mjs` (edge cases). When changing them, keep these rules:

- **One grid everywhere:** `TableGrid` (`ElementSvg.tsx`) draws a table in the editor, small pictures, presenting and
  drag previews, each cell a read-only `SlideText`. Its lines are one SVG shape over the cells (`tableLinePositions`),
  in the element's Color, so a gradient works. Don't draw them as gaps between filled cells: at the editor's CSS zoom
  the browser rounds each cell's edge to a whole pixel, so some lines came out 1 px and others 2 px.
- **Only the cell being typed in has a text editor** (`TextBoxContent` inside `TableContent`), never one per cell: a
  13 × 13 times table would be far too heavy.
- **Picked / typing cell** is UI state in the store (`pickedTableCell`; `typingAt` is set while typing), never saved.
  The first click selects the table, a click on a cell picks it, a double-click types. A cell is found with
  `tableCellAt` (by screen position, since a dragged element's events all point at it). While typing, a press on
  another cell only stops the typing (the old cell blurs); the click that follows moves it there (`wasTypingOnPress`).
- **Selecting many cells, like Excel:** with a cell picked (not typing), dragging across the cells selects the
  rectangle between them (`pickedTableCell.end`, the far corner; missing = one cell; never set while typing), and
  Shift+click stretches the selection to the clicked cell. The drag is `cellDrag` in `SvgElementItem`, so it
  doesn't move the table; to move a table with a picked cell, Escape first (lets go), then drag — the same order
  as diagrams. The selection shows as one outline over the rectangle (`tableRangeBox`), with a soft accent tint
  when it's more than one cell. Delete empties every selected cell in one undo step (`withCellsEmptied`); undo or
  a delete that takes away a cell the selection touches drops the pick.
- **Cell background color** (`fill` on a cell, DATA_VERSION 4; `colorSchema`, so an unsafe saved value is cleaned
  out by `upgradeSlide` like other colors): the table's toolbar gets a "Cell background" swatch that opens the
  Color panel on `cellFill`; it colors the selected cells, or every cell when none is picked (the diagram rule),
  through one `withCellsFill` per click = one undo step. "None" = back to plain white. `TableGrid` draws each
  cell's fill, so the editor, thumbnails, the view page and presenting all show it.
- **Keys while typing** are handled in `TableContent` before the text editor sees them: Tab / Shift+Tab move between
  cells (they stay put at the first and last cell), Escape stops typing. With a cell picked and not typing,
  `useEditorShortcuts` makes Delete empty the cell (not delete the table) and Escape let go of it.
- **Adding and deleting:** the two "+" (`TableButtons`) add at the end, the toolbar's "Table" menu (`TablePanel`) acts
  on the picked cell or else the last one, then picks the new cell. A new row or column keeps the others' size, so the
  table grows, up to the edge of its box (`addTableRow` / `addTableColumn`); from there they share the room.
- **Dragging a line, like Excel** (`TableLines`, drawn under the element's handles, gone while typing): the line on a
  column's right side or a row's bottom side changes only that one, and the table grows or shrinks by it; at the
  box's edge the rest comes out of the next one (`resizeTableLine`, always from the table as the drag started). Saved
  as `columnSizes` / `rowSizes`, numbers that only count compared with each other (missing = all the same, until a
  line is first dragged), so resizing the whole table keeps its proportions. A new column or row copies the size of
  the one before it. `tableCellBox` and `TableGrid` both read them.
- **A cell keeps its size and its text keeps the table's text size,** like all slide text (see "Slide text size").
- **Text size is the whole table's** (`table.fontSize`; `TextTarget` kind `table`), from the toolbar or the text
  format bar while typing. The other text styles are each cell's own, in its HTML.
- **Limits:** `TABLE_ROWS` and `TABLE_COLUMNS` (`constants.ts`), checked by the `table` zod schema. Never flipped or
  cropped. Claude reads a table's text and cell fills (`read_presentation`) and makes tables, cell fills included
  (`src/pages/api/CLAUDE.md`).

## Helpers this folder uses (in `src/lib`)

`useEditorShortcuts` (keys; Ctrl+V pastes a copied element only when no input, textarea, rich text or dialog has
focus, and Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z leave a plain input or textarea to the browser's own typing undo, while rich
text on a slide, sliders and date boxes keep the store's undo; `isTextFieldOrDialog` in `dom.ts`; while a box
(`Modal`, `ConfirmModal`: `role="dialog"` with `aria-modal`) is open, only Ctrl+S works, so no key changes the slides
behind it, test `e2e/editor-edges.mjs`), `useMarqueeSelection` (drag a rectangle to select), `useElementDropTarget` (drop from a
panel or the computer), `useTextRoom` in `useHasHiddenText.ts` (the "+…" on cut-off text), `useCanvasTextEditor` + `richText.ts` (text typing, with tiptap; it stops at the save limits with `TextLimit`,
`src/lib/textLimit.ts`: the question and answer choices at 5,000 characters, every text at 50,000 as HTML; the slide
name box has `maxLength` 5,000), `useFormatTexts` (which texts the format toolbar changes), `geometry.ts` / `crop.ts` (math),
`svgLibrary.tsx` (every drawing in the Elements panel, and the diagram layouts).

## Diagrams (Flowchart, Cycle, Mind Map, Tree)

The "Diagrams" group of the Elements panel. Full design: `docs/superpowers/specs/2026-10-06-diagram-box-drag-design.md`. When changing them, keep these rules:

- **Each box works like a text box:** it keeps its size, its text shrinks to fit (size 12 down to 1; a word too wide for the box shrinks it first so the word isn't cut in two, but not below size 8, `DIAGRAM_WHOLE_WORD_FONT`), and a picked box has the same handles (corners keep the shape, side handles change width or height), drawn over the diagram's own handles so a box at the diagram's corner can be resized from there. Reuse `CORNERS` / `EDGE_HANDLES` from `src/components/editor/handles.ts`; don't make new handles.
- **One layout, two users:** the layouts in `svgLibrary.tsx` place every box, and `getDiagramBoxes` gives those same boxes to the editor (`DiagramBoxEditor.tsx`). Never place boxes a second way in the editor, or the outline won't match the drawing.
- **Text is typed on the slide** (double-click a box; Shift+Enter = new line, Enter/Esc/click outside = done; an Enter that picks a word in a Chinese/Japanese/Korean keyboard, `isComposing`, isn't "done", and the same goes for the slide name box). The panels have no text boxes, only box count, Across/Down, Tidy up, Reset (and the Tree's add/remove).
- **A box's own place and size** (`x, y, width, height`) are saved all together or not at all; missing = its automatic spot. Limits live in `constants.ts` and are checked by `diagramBoxSchema` (zod) before saving.
- **A box's own look** (`fill`, `border`, `borderWidth`, `textColor`, `fontSize`) is optional; missing = the diagram's Color tint and border, dark text, size 12. The toolbar's box style group and the Color panel (`boxFill` / `boxBorder` / `boxText`) change the picked box, or every box when none is picked, through `diagramStyleTargets` + `withDiagramBoxStyle`. Moving, Tidy up and new boxes keep or copy the look. Spec: `docs/superpowers/specs/2026-10-07-diagram-box-style-design.md`.
- **"+" and × on every box** of a selected diagram (`DiagramBoxButtons.tsx`) add a box next to it or remove it. The rules per diagram (where, limits, new text, copying the look) live only in `diagramBoxActions` (`svgLibrary.tsx`); the element is kept in place with `keepInPlace`. Delete on a picked box does the same as its × (`boxRemovalPatch`); a box with no × stays, and Delete removes the whole diagram only when no box is picked. Spec: `docs/superpowers/specs/2026-10-07-diagram-box-add-remove-design.md`.
- **Nothing else moves on the slide** when the drawing area changes: use `keepInPlace` (dragging) or `useResizeForViewBox` (panel), which both keep the other boxes still.
- **Text widths are measured only once the fonts have loaded** (`fontsReady` from `ElementSvg.tsx`); before that, and on the server, use the estimate, so server and browser draw the same.
- **Picked / typing box** is UI state in the store (`pickedDiagramBox`, `editingDiagramBox`), never saved.
- **Claude** adds diagrams with `{ "text": … }` boxes only (automatic layout).
