# Text limits while typing (the editor stops at the save limits)

## Why

The save path review (round 3) found that the editor lets a teacher type or paste past the text limits that zod
checks on save. The save is then refused with a message that names the slide ("The 3rd slide has too much text in
its question"), which is the safety net. Better: the editor never lets the text get that long, so a save never fails
for it.

## Goals

- The question and the answer choices stop at the same limits zod uses: plain text 5,000 characters, the styled HTML
  50,000.
- Text boxes and table cells stop at their HTML limit (50,000).
- The slide name box stops at 5,000 characters.
- When a change is stopped, a toast says why (one toast, not one per key).

## Non-goals

- The whole-slide size (2 MB in the database) is not checked while typing; its save message stays.
- No character counter on screen.
- The announcement bar's editor (admin only) is not changed.

## Anti-goals

- A teacher must never be stuck: deleting, undo, "Clear text" and outside changes always work, even on text that is
  already over a limit (e.g. saved before a limit existed).
- No slow typing: the check runs once per change, like the HTML Tiptap already makes for each change.

## Approaches

1. **Tiptap's CharacterCount extension** (needs the new `@tiptap/extensions` package). It counts text characters
   only, so it can't stop the HTML limit: text with a color on every word reaches 50,000 HTML characters long before
   5,000 letters. Rejected.
2. **Cut the text in the store's `onUpdate`** after the change. The cursor and undo would jump, and the editor and the
   store would disagree. Rejected.
3. **Our own small Tiptap extension with a ProseMirror `filterTransaction`** (chosen): before a change is applied, it
   builds the text and HTML the change would save and refuses the change when one goes over its limit **and** the
   change makes it longer. No new package. Typing, paste, and the format toolbar (which adds HTML) all go through it.

## Design

- `schema.ts` exports `PLAIN_TEXT_MAX` (5,000) and `HTML_MAX` (50,000); `plainTextSchema` / `htmlSchema` use them.
- `src/lib/textLimit.ts`: `TextLimit` extension, options `{ maxText: number | null; maxHtml: number; onRefused }`. Its
  plugin's `filterTransaction(tr, state)`: let it through when the doc didn't change or the change has
  `preventUpdate` (an outside `setContent`: undo, Clear text). Else measure the new doc the way the editor saves it
  (`getText` with `blockSeparator: "\n"`, `getHTMLFromFragment`), refuse when over a limit
  and longer than before, and call `onRefused`.
- `useCanvasTextEditor` gets `hasTextLimit?`; it adds `TextLimit` (text `PLAIN_TEXT_MAX` when set, HTML always `HTML_MAX`). Two fixed extension lists
  (with and without the text limit) at module level, so the editor is never rebuilt. `onRefused` shows
  `toast.error(TEXT_LIMIT_MESSAGE, { id: "text-limit" })` (the same id: one toast).
- `EditableText` (question, answer choices) passes `hasTextLimit: true`; `TextBoxContent` (text boxes, table cells) none.
- The slide name `<input>` gets `maxLength={PLAIN_TEXT_MAX}`.
- Message: "This text is at its limit. Shorten it to add more."

## Tests

A browser test (`e2e/text-limits.mjs`): pasting past the limit in the question, an answer choice and a text box
leaves the text as it was and shows the toast; text up to the limit goes in; deleting still works.
