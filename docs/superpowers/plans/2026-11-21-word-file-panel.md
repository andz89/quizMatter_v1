# Word File Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Word file" side panel in the editor that lists a .docx's text one line per piece, with Copy, and lets a teacher drag a line onto a question box or answer choice.

**Architecture:** The file is read only in the browser: `fflate` unzips `word/document.xml`, a pure helper (`wordText.ts`) turns the XML into lines. The panel keeps the list in the store. Dragging carries the line under our own drag type; the existing drop hook on question boxes and choices gains a text branch that calls `updateQuestion` / `updateOption`.

**Tech Stack:** Next.js / React, zustand store, `fflate` (new), Node test runner, Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-11-21-word-file-panel-design.md`

## Global Constraints

- The file is never uploaded or saved; nothing goes to the server.
- Only `.docx`; refuse other files with: "Open a Word file (.docx). For an old .doc file, save it as .docx in Word first."
- Refuse files over 20 MB. List at most 2,000 lines (`WORD_LINES_MAX`), with a note when there were more.
- A drop replaces the box's text, removes a leading item mark (`1.` `1)` `a.` `A)` `(a)` `(1)` + space), refuses a line over `PLAIN_TEXT_MAX` with toast `TEXT_LIMIT_MESSAGE`.
- Drag type is our own `TEXT_DRAG_MIME` only, never `text/plain`.
- Install with `npx -y npm@10.9.2 install fflate`; commit `package-lock.json`.
- Design system classes only; the one `Spinner`; Lucide icons with `size`.

## Review Focus

- Text boxes in Word (`mc:Choice` + `mc:Fallback`): the same line must not show twice. → Task 1 test.
- A paragraph nested inside a text box inside a paragraph: its text must be its own line, not glued to the outer one. → Task 1 test.
- `1.5 kg of rice` / `A cat` must keep their start (a mark needs `.` or `)` and then a space). → Task 1 test.
- A text drag over a whole slide (not a box) must not highlight or swallow it. → Task 3 (onTextDrop absent → ignore).
- A corrupt/renamed file must show the error, not crash the panel. → Task 2 test.

---

### Task 1: `wordText.ts` (XML → lines, item mark)

**Files:** Create `src/lib/wordText.ts`, `src/lib/wordText.test.ts`

**Interfaces — Produces:** `wordLines(xml: string): string[]`, `stripItemMark(line: string): string`, `WORD_LINES_MAX = 2000`.

- [ ] Tests (`node:test` + `assert`):
  - `<w:p><w:r><w:t>What gas?</w:t></w:r></w:p><w:p/><w:p><w:r><w:t xml:space="preserve">a. </w:t><w:t>Oxygen</w:t></w:r></w:p>` → `["What gas?", "a. Oxygen"]`
  - `<w:br/>` and `<w:cr/>` split a paragraph into two lines; `<w:tab/>` becomes one space; `"a  \t b"` spacing collapses to single spaces.
  - `&amp; &lt; &gt; &quot; &apos; &#233; &#x41;` decoded.
  - `<mc:AlternateContent><mc:Choice>…<w:p><w:r><w:t>Box</w:t></w:r></w:p>…</mc:Choice><mc:Fallback>…<w:p><w:r><w:t>Box</w:t></w:r></w:p>…</mc:Fallback></mc:AlternateContent>` inside an outer paragraph with text "Outer" → `["Outer", "Box"]` (order: the nested line ends first or after — assert set membership and length 2, no "OuterBox").
  - `<w:pPr>`/`<w:rPr>` content (e.g. `<w:rFonts w:ascii="Arial"/>`) contributes no text; `<w:instrText>` ignored.
  - `stripItemMark`: `"1. Dog"→"Dog"`, `"12) Dog"→"Dog"`, `"a. Dog"→"Dog"`, `"B) Dog"→"Dog"`, `"(c) Dog"→"Dog"`, `"(3) Dog"→"Dog"`, `"1.5 kg"→"1.5 kg"`, `"A cat"→"A cat"`, `"I. Intro"→"Intro"` (one letter counts as a mark).
- [ ] Run `npm test` → fails (module missing).
- [ ] Implement: a regex tokenizer over tags (`/<(\/?)([\w:]+)[^>]*?(\/?)>|([^<]+)/g`) with a stack of line buffers: open `w:p` pushes a buffer, close `w:p` pops and emits; text inside `w:t` appends to the top buffer; skip everything between `mc:Fallback` open/close; `w:br`/`w:cr` emit the top buffer and start a new one. Clean, drop empty lines. Mark regex: `/^\s*(?:\(\s*(?:\d{1,3}|[a-zA-Z])\s*\)|(?:\d{1,3}|[a-zA-Z])[.)])\s+/`.
- [ ] `npm test` → passes. Commit `feat: read a Word file's lines (wordText)`.

### Task 2: `wordFile.ts` (File → lines) + `fflate`

**Files:** Create `src/lib/wordFile.ts`, `src/lib/wordFile.test.ts`; modify `package.json`, `package-lock.json`

**Interfaces — Consumes:** Task 1. **Produces:** `readWordBytes(bytes: Uint8Array): { lines: string[]; more: boolean } | { error: string }`, `readWordFile(file: File): Promise<same>` (size and `.docx` name check, then `readWordBytes`), `WORD_FILE_ERROR`, `WORD_FILE_MAX_BYTES = 20 * 1024 * 1024`.

- [ ] `npx -y npm@10.9.2 install fflate`.
- [ ] Tests: a zip built with `fflate.zipSync({ "word/document.xml": strToU8(xml) })` → lines; 2,001 paragraphs → 2,000 lines, `more: true`; random bytes → `{ error: WORD_FILE_ERROR }`; a zip without `word/document.xml` → error.
- [ ] Implement with `unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" })` in try/catch, `strFromU8`.
- [ ] `npm test` passes. Commit `feat: open a .docx in the browser (wordFile, fflate)`.

### Task 3: Text drops on question boxes and choices

**Files:** Modify `src/lib/constants.ts`, `src/lib/useElementDropTarget.ts`, `src/components/editor/QuestionContainer.tsx`, `src/components/editor/OptionCard.tsx`

**Interfaces — Produces:** `TEXT_DRAG_MIME = "application/x-quizbuilder-text"`; `useElementDropTarget(slideId, containerId, onTextDrop?: (text: string) => void)`.

- [ ] Hook: a drag counts when its types include `TEXT_DRAG_MIME` only if `onTextDrop` is given. On drop with that type: `stripItemMark(text)`; if empty, nothing; if over `PLAIN_TEXT_MAX`, `toast.error(TEXT_LIMIT_MESSAGE, { id: "text-limit" })`; else `onTextDrop(text)`.
- [ ] QuestionContainer passes `(t) => updateQuestion(slide.id, t, textToHtml(t))`; OptionCard `(t) => updateOption(slideId, option.id, t, textToHtml(t))`.
- [ ] `npx tsc --noEmit` clean. (Behavior covered by Task 5's browser test.) Commit with Task 4.

### Task 4: Store state, icon rail, panel, notes

**Files:** Modify `src/lib/store.ts`, `src/components/editor/IconRail.tsx`, `src/components/editor/Editor.tsx`, `src/components/editor/CLAUDE.md`, `src/lib/CLAUDE.md`, root `CLAUDE.md` (no map change needed unless folder notes say so); create `src/components/editor/WordFilePanel.tsx`

**Interfaces — Produces:** store `isWordPanelOpen`, `toggleWordPanel`, `closeWordPanel`, `wordFile: { name: string; lines: string[]; more: boolean } | null`, `setWordFile(f)`. Every other panel toggle also closes the Word panel, and it closes them (same pattern as `toggleElementsPanel`).

- [ ] Panel (`side-panel`): title "Word file"; button "Open a Word file" (hidden `<input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document">`; `Spinner` while reading; error shown in `text-danger-strong`); then the file name, "Open another file", the note "Showing the first 2,000 lines." when `more`, and the list. Each row: `GripVerticalIcon`, the text, a Copy button (`CopyIcon`, `navigator.clipboard.writeText`, toast "Copied"). Row `draggable`, `onDragStart` sets `TEXT_DRAG_MIME` to the raw line, `effectAllowed = "copy"`. Empty state help: "Open your exam in Word format (.docx). Then drag each line onto a question or answer choice." Rows have `data-word-line` for tests.
- [ ] Rail button "Word file" with `FileTextIcon size={22}`; Editor renders `{isWordPanelOpen && <WordFilePanel />}`.
- [ ] Notes: editor `CLAUDE.md` side-panel list + a "Word file panel" section; `src/lib/CLAUDE.md` lines for `wordText.ts` / `wordFile.ts`.
- [ ] `npx tsc --noEmit`, `npm run lint` clean. Commit `feat: Word file panel: drag an exam's lines onto questions and choices`.

### Task 5: Browser test

**Files:** Create `e2e/word-file.mjs` (reuse `e2e/lib.mjs`; read `e2e/CLAUDE.md` first)

- [ ] Build a .docx in the test with `fflate.zipSync` (lines "1. What gas do plants take in?", "a. Oxygen", "b. Carbon dioxide"), save to a temp path, open a new presentation's editor, open the Word file panel, `setInputFiles`, expect 3 `[data-word-line]` rows.
- [ ] Drag line 1 to the question box and line 3 to option B by dispatching `dragstart`/`dragover`/`drop` with one shared `DataTransfer` (`page.evaluateHandle(() => new DataTransfer())`). Expect the question text "What gas do plants take in?" and option B "Carbon dioxide"; Ctrl+Z restores option B's old text.
- [ ] A text dropped on the slide outside the boxes changes nothing.
- [ ] Run `npm run e2e:dev` then `node e2e/word-file.mjs` → passes. Commit `test: Word file panel browser test`.
