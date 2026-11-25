# Change letter case in slide text (short design)

**Why:** teachers asked for UPPERCASE / lowercase in the slide editor's text bar; today they must retype the text.

**Goal:** one button on `TextFormatToolbar` (question, answer choices, text boxes, table cells) that changes the case
of the text. **Non-goals:** a saved "all caps" style; diagram boxes (their own toolbar). **Anti-goal:** losing a
word's bold / italic / underline / color when its case changes.

## Approaches

1. **Change the real letters (picked).** A command rewrites each piece of text in place, keeping its marks. No
   saved-shape change, no `DATA_VERSION`, and every place that shows text (thumbnails, presenting, downloads,
   Claude's `read_presentation`) shows it as is. One undo step.
2. A display-only style (CSS `text-transform` as a new mark): needs a saved-shape change, a `DATA_VERSION` bump, a
   migration, and every reader (`SlideText`, Word / Text download, Claude) to apply it too. Much bigger for the same
   result.
3. Two separate buttons (UPPER, lower) instead of a menu: takes more room on a bar that is already wide.

## Design

- **Button:** an "Aa" `ToolPanelButton` (`CaseSensitiveIcon`, `closeOnAnyClick`) after Underline, with four rows:
  UPPERCASE, lowercase, Sentence case, Capitalize Each Word. (The last two are my call: cheap, and handy for text
  pasted in all caps.)
- **Where it applies:** like the other buttons (`formatChain`): the selected words while typing; all the text when
  the box is only selected. While typing with nothing selected, the whole text (a button that did nothing would feel
  broken).
- **Rules** (`src/lib/textCase.ts`, pure and tested): each block (paragraph) is read as one string, so a word split
  by bold still counts as one word. Sentence case: the first letter of the paragraph, and the first letter after
  `.`, `!` or `?`, is upper; the rest lower. Capitalize Each Word: a letter is upper when the character before it
  is not a letter, digit or apostrophe ("don't" becomes "Don't"). A line break (Shift+Enter) counts as a space, not a
  new sentence (a break in the middle of a sentence is common in quiz text).
- **Edit:** the command replaces only the text pieces that change, from the end back, each with its own marks, in
  the chain's transaction (`formatChain(...).command(...)`), so it is one edit and the box's own `onChange` saves it.
  `TextLimit` still guards length (e.g. "ß" → "SS").
