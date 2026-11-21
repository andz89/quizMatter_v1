# Word file panel (drag an exam's lines onto slides)

## Why

Teachers already have their exams in Word. Retyping every question and choice into slides is slow. With this panel
they open the Word file in the editor, see its text as a list, and drag each line onto a question box or an answer
choice. The teacher decides where every line goes, so the app never has to guess how their exam is laid out.

## What the teacher sees

- A new **Word file** button on the editor's left icon bar (`FileTextIcon`) opens a side panel (the `side-panel`
  class, like Elements and Photos; opening it closes the other panels, like they close each other).
- "Open a Word file" picks a `.docx`. The panel then shows the file name and its text as a list: **one piece per
  line** (each paragraph, and each line break inside one, is its own piece). Empty lines are skipped. Pictures,
  shapes and styling are left out: plain text only.
- Each piece has a **drag handle** and a **Copy** button (copies the line as it is, with a toast "Copied").
- Dragging a piece onto a **question box** makes it the question; onto an **answer choice** (A–D, true/false) makes
  it that choice's text. The box lights up while a piece is over it, like it does for elements.
- The drop **replaces** the box's text. A leading item number or letter is removed on drop: `1.`, `1)`, `a.`, `A)`,
  `(a)`, `(1)` followed by a space (the answer boxes already show A–D, the slides their numbers). Ctrl+Z undoes it.
- A line longer than the question / choice limit (`PLAIN_TEXT_MAX`) is not dropped: toast `TEXT_LIMIT_MESSAGE`.
- "Open another file" replaces the list.

## Suggestions (added 2026-11-21)

- A "Show suggestions" button (off until clicked) colors the items the app finds: a line starting with a number
  ("1.", "2)", or a blank first, "____ 3.") is a question; the lines under it, up to 4 and stopping at the next
  numbered line, are its choices. At least 2 choices (true / false counts). The question row gets Create, which adds
  that item as a choice slide after the active one and then shows "Added" (a click adds it again).
- The "____" blank in front of a number is removed from the question like the number is.
- Choices in two columns ("A. … ⇥ C. …" on one row, or a table) are split at a tab or wide gap before a letter, and
  a suggestion puts lettered choices in A–D order.

## Review fixes (2026-11-21)

- Equations are read as plain text (x², H₂O, (x+1)/2, ³√8, brackets, ∑ / ∫), plus the non-breaking hyphen and
  Insert → Symbol's Greek letters and math signs (picture fonts like Wingdings give nothing).
- Touch screens: tap a line's handle, then tap a box (works with a mouse too). Escape or Cancel lets go.
- Roman numerals ("II.", "iv)", "(xii)") are removed like "1." and "a.".
- The text part's unzipped size is checked (20 MB) before unzipping.
- A drop on a box being typed in: ProseMirror only reads plain text, HTML or links from a drop, so our own drag
  type passes through to the box.

## Tick lines to make a slide (added 2026-11-21)

- Each line has a checkbox. Ticking shows a "New slide" preview at the top of the panel (it stays in view while the
  list scrolls): the first ticked line is the question, the next ones A, B, C, D, in the order they were ticked
  (item marks removed). Each ticked line shows its Q / A–D badge. At most 5 ticks; Clear unticks all.
- From 2 ticks, "Add as a new slide" adds a choice slide with those texts after the active slide (the slide limit
  applies), toasts "Slide added" and clears the ticks.

## Rules

- **The file never leaves the browser.** It's read on the teacher's computer, never uploaded or saved. Nothing new
  is collected, so the Privacy Policy doesn't change. Closing the panel keeps the list (store state); reloading the
  page forgets it.
- Only `.docx`. An old `.doc`, or a file that isn't a Word file, shows "Open a Word file (.docx). For an old .doc
  file, save it as .docx in Word first." Files over 20 MB are refused (pictures make them big; only the text part
  is unzipped). At most 2,000 pieces are listed, with a note when the file had more.
- Word's automatic numbering (1., a.) isn't part of the text, so those numbers don't show in the list at all.
- Drops only go into question boxes and answer choices (what the teacher asked for). Text boxes keep using Copy and
  paste.

## Approaches

1. **`fflate` + our own small reader (chosen).** `fflate` (tiny, no sub-packages) unzips only `word/document.xml`;
   `src/lib/wordText.ts` walks its XML and returns the lines. Pure code, so `npm test` covers it.
2. `mammoth`: a well-known Word reader, but much bigger with several sub-packages, for plain text we can get
   ourselves.
3. No package: the browser's own `DecompressionStream` plus reading the zip's file list by hand. More of our own code
   to keep right, to save a tiny package.

## How it's built

- `src/lib/wordText.ts` (no app imports, tested in `wordText.test.ts`):
  - `wordLines(documentXml)`: the lines. Each `<w:p>` is a line; `<w:br/>` / `<w:cr/>` split it; `<w:t>` gives text,
    `<w:tab/>` a space; entities (`&amp;` …) decoded; spaces trimmed and runs of spaces made one; empty lines
    dropped. Text boxes appear twice in Word's file (`mc:Choice` and `mc:Fallback`): the `mc:Fallback` copy is
    skipped. A paragraph inside a text box ends its own line (a stack, not one flat buffer).
  - `stripItemMark(line)`: the leading number / letter removed (only with a space after it, so "1.5 kg" stays).
- `src/lib/wordFile.ts` (browser): `readWordFile(file)` → `{ lines, more }` or an error message; uses `fflate`'s
  `unzip` with a filter for `word/document.xml`.
- `constants.ts`: `TEXT_DRAG_MIME` (only our own type, never `text/plain`, so the box's own text editor doesn't
  also paste it).
- `useElementDropTarget`: also accepts `TEXT_DRAG_MIME`; a drop calls a new `onTextDrop(text)` the box passes in
  (question box → `updateQuestion(slide, text, textToHtml(text))`, choice → `updateOption`). The drop checks the
  limit first.
- Store: `isWordPanelOpen` / `toggleWordPanel` / `closeWordPanel` (same as the other panels), and `wordFile:
  { name, lines, more } | null`.
- `src/components/editor/WordFilePanel.tsx`: the panel. Uses `Spinner` while reading, design-system classes only.
- Notes: `src/components/editor/CLAUDE.md` (the panel) and `src/lib/CLAUDE.md` (`wordText.ts`, `wordFile.ts`).

## Left to the builder

The exact wording of the empty panel's help line; how the list looks within the design system.
