# The editor (how it fits together)

The page `src/app/presentation/[id]/edit/page.tsx` loads the presentation on the server (`fetchPresentation`), picks
editor / view / review, and renders `Editor.tsx`, which calls `store.loadPresentation`.

## The pieces

- `Editor.tsx`: the frame. `EditorTopBar`, `IconRail` (the left icon bar that opens the side panels), `Workspace`,
  `EditorBottomBar` (zoom, which slide is showing, the slide grid, fullscreen present).
- `EditorTopBar.tsx`: Save, `ShareButton`, `ReviewControls`, and the toolbar for what is picked:
  `SelectedElementToolbar` (elements), `TextFormatToolbar` (text), `ShapeBoxToolbar`. `ArrangePanel` and
  `MathToolPanels` are drop-downs inside those toolbars (`ToolPanelButton` in `PanelControls.tsx`).
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
- Modals: `AnswerModal`, `DetailsModal` (title, grades, subject…), `SlideGridModal`, `ConfirmModal` (the app's one
  confirm box, used on every page; never the browser's `confirm()`).
- Review mode: `ReviewControls.tsx` (Save as draft + the ⋮ menu, and `ReviewBanner`).

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
