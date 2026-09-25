# Plan: Make Quiz Slides from Claude's JSON

Status: **test version built.**

## Test version (what's built)

- **Top bar → "Copy format"**: copies notes, an example, and the JSON Schema (every allowed value, including all shape names) to paste into Claude. Made by `getClaudeFormat()` in `src/lib/importQuiz.ts`.
- **Top bar → "Import"**: pick a `.json` file. The imported slides **replace all slides** in the quiz (one Ctrl+Z brings the old ones back). "Paste" does the same from the clipboard. Errors show in an alert.
- **One set of rules** (zod, in `importQuiz.ts`) both tells Claude what's allowed and checks the upload.
- **No pictures in the question box.** Its text grows to fill the box, so pictures would sit on top of it. The question's pictures go in the shape box (`"side"`): the strip under the question (grid/list), the tall box beside the options (list-side), or the area under the question (short-answer).
- **Placing:** each element's height = 30% / 55% / 85% of its box (small / medium / large), worked out from at least 120px so short boxes (list options) don't get tiny pictures. Elements are laid out like words in a sentence: rows, shrunk until they fit. So the `arrange` word isn't needed.
- **Question and strip heights:** the question box fits its text (1 line ≈ 82px, max 160px). When a grid/list slide has pictures in the strip, the strip grows into the room the options can spare (up to 240px), leaving each option box at least ~70px tall.
- **Options with text:** pictures go on the right half, so the text keeps the left. Options with no text: pictures are centered. Claude is told to keep option text short (1–3 words) when there's a picture, or leave it empty.
- **Number lines:** `hidden` lists the *numbers* to hide (e.g. `[6]`), not tick positions.
- **Shared limits:** the math tools' limits (fraction parts, bar count…) live in `svgLibrary.tsx`, used by both the settings panels and the importer.
- **Layout auto-pick:** if a choice slide has no `layout`, the app picks: picture answers → grid; a reading tool (clock, thermometer, bar graph, protractor, base-ten, fraction circle) → list-side; an option over 25 characters → list; else grid. Claude's notes give the same table.
- **Defaults:** `in` defaults to `"side"`; `size` defaults to medium, or large for reading tools.
- **Counting:** at most 5 copies of the same picture per row (8 = 5 + 3).
- **Picture sums:** numbers and symbols (e.g. `symbol-plus`) take the size of the biggest picture in their box.
- **Lesson slides** (for teaching, instructions, or class discussion): `title` (bold) and `text` become text boxes; `layout` is `text-top` (default), `text-left`, or `title-only`. Pictures fill the room left; their `in` is ignored.
- **Callouts** (lesson slides): arrows with labels pointing at part of a picture. `from` left/right/top/bottom, `at` top/middle/bottom (or left/middle/right). Room is reserved around the picture.
- **Design** (all slides): `background` color (dark colors lightened automatically); `design` decorations at corners (big on lessons, small in the edge on question slides) or `bottom-strip` (lessons). Claude chooses its own colors.
- **Claude's own SVG, design only:** `backgroundSvg` (full-slide artwork behind the cards) and `svg` decorations. Always shown as an **image** (`<img>` / CSS background), so nothing inside can run. Max 20,000 characters. Teaching pictures stay library-only.
- **Claude's own background (`backgroundSvg`)** is always shown at 20% opacity: the importer wraps it in a see-through layer.
- **Library backgrounds:** `backgroundPattern` picks one of the app's patterned backgrounds (`background-dots`, …). The importer draws it into `backgroundSvg` at half size, as a soft (25%) frame around the edges with a plain middle, in the `background` color: 40px on every slide. It drops the slide's `design` decorations. Give it or `backgroundSvg`, not both.
- **Saving:** imported slides are saved like any other edit (Supabase, via `saveQuizToDb` in `src/lib/quizzes.ts`).
- **Option letter button:** the A/B/C/D button sits in each option card's top-left corner. Option pictures stay clear of it: they are centered, or on the right half when the option has text.
- **Not in the test:** styled text beyond the bold title.
- Sample file: `docs/sample-import.json`.

The sections below are the original plan. Where they differ from the test version, the test version wins.

## The idea in one line

**Claude writes words. The app does the numbers.**

Claude can't see the slide, so it can't guess pixel positions well. Instead:

- **Claude (the customer)** says *what* goes on the slide: "3 apples, in the question box, in a row, medium size."
- **The app (the cook)** works out *where* it goes: the exact x, y, width and height, centered and inside its box.

## How it works (for now: no MCP server)

1. In the chat, give Claude the cheat sheet (see below).
2. Claude writes the quiz as simple "recipe" JSON.
3. Upload that JSON into the app with an **Import** button.
4. The importer reads it, places everything, and builds the real slides.

## The recipe JSON Claude writes

No ids, no x/y, no pixels.

```json
{
  "title": "Counting Fruits",
  "slides": [
    {
      "type": "choice",
      "layout": "grid",
      "question": "How many apples are there?",
      "options": ["2", "3", "4", "5"],
      "answer": "B",
      "elements": [
        { "asset": "apple", "in": "question", "count": 3, "arrange": "row", "size": "medium" }
      ]
    },
    {
      "type": "choice",
      "layout": "list-side",
      "question": "What time does the clock show?",
      "options": ["3:00", "4:30", "6:15", "9:45"],
      "answer": "C",
      "elements": [
        { "asset": "<clock id>", "in": "side", "size": "large", "clockTime": { "hours": 6, "minutes": 15 } }
      ]
    }
  ]
}
```

### Allowed words

| Field | Allowed values |
|---|---|
| `type` | `choice`, `short-answer`, `lesson` |
| `layout` | `grid`, `list`, `list-side` |
| `answer` | `A`–`D` for choice slides; the answer text for short-answer slides |
| `in` | `question`, `A`, `B`, `C`, `D`, `side` (list-side only), or `canvas` (free on the slide) |
| `arrange` | `center`, `row`, `grid` |
| `size` | `small`, `medium`, `large` |
| `count` | how many copies of the element (default 1) |

### Shape settings (same names as `src/lib/schema.ts`)

| Shape | JSON | Allowed values |
|---|---|---|
| Clock | `"clockTime": { "hours": 6, "minutes": 15, "pm": false }` | hours 1–12, minutes 0–59 |
| Fraction bar/circle | `"fraction": { "parts": 4, "shaded": 1 }` | shaded ≤ parts |
| Number line | `"numberLine": { "start": 0, "step": 1, "hidden": [3] }` | `hidden` = ticks shown as an empty box |
| Ten frame | `"tenFrame": { "count": 7, "rows": 2, "columns": 5 }` | count ≤ rows × columns |
| Base-ten blocks | `"baseTen": { "hundreds": 1, "tens": 2, "ones": 3 }` | 0–9 each |
| Thermometer | `"thermometer": { "value": 25 }` | -20 to 50 °C |
| Bar graph | `"barGraph": { "bars": [{ "label": "Mon", "value": 4 }] }` | values 0–10 |
| Protractor | `"protractor": { "angle": 45 }` | 0–180 |

Because the names match the app's schema, the importer can copy these straight over.

## Element sizes

**Claude chooses the word. The importer decides the number.**

- Claude only picks `small`, `medium`, or `large`. It never gets pixel sizes.
- The importer turns the word into a real size based on the box the element sits in, e.g.:
  - `small` = 30% of the box height
  - `medium` = 60% of the box height
  - `large` = 90% of the box height

  (Example numbers only — to decide.)
- So "medium" in a tall side box is bigger than "medium" in a short option box. Each fits its own box.

**Why we don't send Claude the box sizes:** they are not fixed. They change with the layout (`grid` / `list` / `list-side`), the question height, and the shape strip. A number that's right for one slide is wrong for another.

**What we tell Claude instead — a rough picture:**
- "Option boxes are wide and short. They fit about 3 small items in a row."
- "The side box (`list-side`) is tall. Use it for one big picture, like a clock or a thermometer."
- "The question box is wide. It fits a row of up to 6 small items."

**Safety net:** if Claude puts too many items in a box, the importer shrinks them to fit instead of letting them spill out.

## The cheat sheet for Claude

Paste this at the start of the chat (or save it as a Claude Project's instructions):

1. **The recipe format**, with 1–2 full examples like the ones above.
2. **The list of shapes**: the exact `id` from `src/lib/svgLibrary.tsx`, a few words on what it is, and any extra settings. Without this, Claude will make up names that don't exist.
3. **The allowed words and values** from the tables above.
4. **A rough picture of each box** (see "Element sizes").
5. **Simple rules**, e.g.:
   - Max 6 items in one row.
   - Use `list-side` when the picture is big.
   - Choice slides always have exactly 4 options.

Tip: later, add a small script or button that prints the shape list from `svgLibrary.tsx`, so it stays up to date when new shapes are added.

## What the importer does

1. **Check** the JSON with zod. A wrong shape name, a missing answer, or an out-of-range value (e.g. `minutes: 75`) shows a clear error instead of breaking the app.
2. **Make ids** with `createId`.
3. **Find the box size** with `getContainerBounds` (`src/lib/constants.ts`). It depends on the slide layout and the question height.
4. **Turn words into numbers:**
   - `size` → a real size from the box height (see "Element sizes").
   - `arrange: "row"` → space the items evenly and center the row.
   - `arrange: "center"` → put the item in the middle of the box.
   - `arrange: "grid"` → rows and columns, centered.
5. **Safety net:** if the items don't fit, shrink them all by the same amount. Then run `fitInBox` (`src/lib/geometry.ts`) so nothing ends up outside its box.
6. **Turn `answer: "B"`** into the matching option's id (`correctOptionId`).
7. **Add the slides** to the quiz.

## Libraries

- **zod**: already in the project. Used to check the recipe JSON.
- No new libraries needed.

## Later: MCP server

If we build an MCP server later (with `@modelcontextprotocol/sdk`), its `create_question` tool can take this **same recipe format** and reuse the importer code. So this work won't be wasted.

## Open questions

**Must decide before building:**
- **Mixed elements in one box:** if a box has 2 apples *and* 3 bananas (two entries), how are they placed together? One shared row? Apples on top, bananas below?
- **Paste or upload:** paste JSON into a text box (easiest from a chat) or upload a `.json` file?
- **Where it goes:** add slides to the current quiz, or make a new quiz?
- ~~**Saving:** the quiz only lives in browser memory right now.~~ Done: quizzes are saved to Supabase.
- **Error messages:** show which slide and which field is wrong, e.g. "Slide 3: minutes must be 0–59".
- **Exact sizes** for `small` / `medium` / `large`.

**Can wait:**
- Where the Import button lives (toolbar? menu?).
- Text boxes in the recipe.
- Undo: should one Ctrl+Z remove the whole import?
- Export: turn existing slides back into recipe JSON, to give Claude examples or ask it to edit a quiz.
- A script that prints the shape list from `svgLibrary.tsx`.
