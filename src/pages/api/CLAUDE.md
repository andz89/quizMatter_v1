# src/pages/api (Claude's connector, the MCP server)

`mcp.ts` is the MCP server that Claude chat connects to (a custom connector in claude.ai). It's the only file under
`src/pages`; the rest of the app uses `src/app`.

## How it works

1. **Login:** Claude has no browser cookies, so it logs in with OAuth. Supabase is the login server; the teacher
   clicks Allow on `/oauth/consent` (`src/app/oauth`), and `/.well-known/oauth-protected-resource` tells Claude where
   to start. The consent page shows where the login code goes (the redirect address, e.g. `claude.ai`), and Allow
   works only when it's on Claude's own sites, `claude.ai` or `claude.com` over https (`ALLOWED_REDIRECT_HOSTS` in
   `src/app/oauth/consent/allowedApps.ts`; `answerConsent` checks again). An app picks its own name, so the name
   proves nothing. `src/proxy.ts` lets `/api/mcp` through without cookies. `checkLogin` reads the token and asks the
   database `is_admin` / `is_banned` with `userClient(token)` (acts as that user); if it can't tell whether the user
   is banned, it refuses. **For now only admins
   can use it.** During maintenance (root `CLAUDE.md`, "Maintenance") it answers 503 to everyone but the super
   admin, checked before `checkLogin` with the same client (the database guard refuses others' login checks, which
   would look like "log in again" to Claude). On Allow and on Deny, `answerConsent` sends the browser only to
   Claude's sites (else `NOT_CLAUDE_MESSAGE`), so the page is never an open redirect.
2. **The tools:**
   - `get_presentation_format`: the recipe format (`getClaudeFormat()` in `src/lib/importPresentation.ts`).
   - `read_presentation`: reads a saved presentation as a reference: only the admin's own, other teachers' published
     copies (`sharedFrom`) and QuizMatter ones (`fromAdmin`), never one an admin hid (`isHidden` from
     `loadPresentation`). An admin may open any presentation, but anything else
     gets the "someone else's private one" answer, as the Privacy Policy promises.
   - `find_photos`: searches the shared photo library.
   - `prepare_photo_upload`: makes one-time upload links (`src/lib/photoTickets.ts`); Claude then sends each file to
     `/api/claude-photo` (`src/app/api/claude-photo/route.ts`). Each link counts first, as the admin, like Admin →
     Photos' shared uploads (`count_write('photos')`: 30 a minute, `QM429`; the super admin has no limit), since the
     upload route uses the secret key.
   - `find_photos_needing_details` + `save_photo_details`: Claude fills in shared photos' file name, description,
     tags and category (e.g. editors' waiting photos). The find tool narrows by `which` (no description / waiting /
     any) and `words` (file name, tags or category, e.g. a marker file name like "todo-frogs"), a few at a time, and
     sends each picture (a 640 px copy, `loadPicture`). Saves run as the admin, so the database rules decide: a plain
     admin only gets and changes their own photos. Never the source or `is_public`. The pictures load together.
     Categories: `src/lib/photoCategories.ts` (shared with `/api/claude-photo`): `findOrCreateCategory` looks up one
     row by name (`ilike`, capitals don't matter, like the table's unique index), and `removeUnusedNewCategory`
     deletes a category just made when its photo wasn't saved (with the secret key: plain admins can't delete
     categories). Checked with `claudePhotoFillSchema`.
   - `send_presentation`: `buildSlides` turns the recipe into real slides and checks them (the recipe schema, then
     `slideProblems` in `schema.ts` runs `slideSchema` on each built slide, so a too-long text is caught now like a
     save would). Problems go back to Claude as a report to fix. If all is well, it saves a **draft** (`src/lib/drafts.ts`) and gives a link.
   - The old names (`…_lesson…`, `…_quiz…`) still work, because old chats keep the tool list they started with.
3. **Drafts:** they live in Cloudflare D1 (`d1/migrations`; `0004_indexes.sql` indexes drafts by owner and time,
   and both tables by time, for the expiry deletes), not Supabase, and last 24 hours. A new D1 migration is applied
   by hand: `npx wrangler d1 migrations apply quizmatter-drafts --remote`. The link opens
   `/presentation/new?draft=<id>` (`src/app/presentation/new/page.tsx`), which loads it into the editor as a new
   presentation. It is only saved for real when the admin clicks Save (or Ctrl+S). Leaving the editor doesn't save
   it: changes are kept in that browser and come back when the link is opened again, and it stays a draft (see
   `src/components/editor/CLAUDE.md`). Nothing here touches saved presentations.

## Rules

- Everything Claude sends is checked with zod (`presentationRecipeSchema`, `claudeDetailsSchema`,
  `claudePhotoSchema`) before it's stored (see "Saving Data" in the root `CLAUDE.md`).
- Claude can make every element in the Elements panel: pictures, math tools, diagrams and tables through `elements`,
  text boxes through `title`, `text` and `textBoxes` (on question slides too, in the box named by `in`).
- A table is `"asset": "table"` with `table` (rows of words; `src/lib/importTable.ts` sizes it). A cell's text never
  shrinks, so the rows are shared out by their text and the layout report names any row still cut off. A cell
  written as `{ "text", "style", "fill" }` gets its own background (`fill`: `#RRGGBB` or `gradient:#A,#B`, the
  element-color rule, so it always passes `isSafeColor`); anything else is refused at the cell.
  `read_presentation` (`shrinkPresentation`) gives each cell's `fill` back with its words, and the format asks
  Claude to send it again, so editing a table keeps the teacher's cell colors. Test: `e2e/claude-table-fill.mjs`.
- Option rows are sized by their text (`optionNeedFor`, `src/lib/importText.ts`; saved as each option's `rowSize`,
  or a grid's `gridRowSizes`, like the editor's grid re-fit). Option text keeps the size Claude gives, or the
  default: the import never changes it. When a picture strip Claude left at its own height leaves the options too
  little room, the strip gets shorter (not below `MIN_SHAPE_STRIP_HEIGHT`). An option holding pictures or text boxes
  keeps at least an equal row, for them. Like the question box, an option's text spans the whole box and its pictures
  sit on top of it (the import puts them on the right half); the report warns when the text runs under them. The layout report lists each option's box and names any still cut off.
  Claude can't set or read row sizes, so when it edits a saved presentation (`read_presentation`, then a new draft)
  rows a teacher dragged are sized by their text again; text sizes stay. Test: `e2e/claude-text-fit.mjs`.
- **Small slips are fixed, not refused** (`fitted` in `src/lib/importPresentation.ts`): a position's x / y / width /
  height, a text size (`fontSize`, also a table's), `questionHeight` and `stripHeight` are rounded and pulled into
  their range (a 12 px tall arrow → 20, a 10 px table text → 12), since one refusal sends the whole presentation
  back. The format still shows each range. A `questionHeight` or `stripHeight` above what the slide allows is
  lowered to the most allowed, and the layout report says so. A value that isn't a number is still refused. Test:
  `e2e/claude-number-fixes.mjs`.
- An element's `color` can be a gradient (`gradient:#A,#B`), except on text.
- Diagrams use the automatic layout: each box is its `text` and, if wanted, its look (`fill`, `border`, `borderWidth`,
  `textColor`, `fontSize`, `shape`), the fields the editor saves. Never a box's place or size.
- Claude never changes a saved presentation: it reads one (`read_presentation`) and sends the changed version as a
  new draft, which the teacher saves.
- Claude can group pieces: the same `"group"` name on pictures and `textBoxes` of one slide (e.g. a ribbon and its
  words) becomes one editor group (`groupId`), like the Group button: at least 2 pieces, all in the same box (else an
  error; one piece = a note in the layout report). `groupByName` in `src/lib/importGroups.ts` (tests
  `importGroups.test.ts`).
- Claude can pick the slide effect in its details (`transition`, `transitionSpeed`); left out = the default.
- Picture boxes are fitted to the drawing's real shape from `src/lib/assetShapes.json` (see `src/lib/CLAUDE.md`).
- **After adding or renaming a tool, the user must reconnect the connector in claude.ai and start a new chat**, or
  Claude won't see it. Say so when you finish such a change.
