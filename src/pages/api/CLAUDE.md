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
   database `is_admin` / `is_banned`; if it can't tell whether the user is banned, it refuses. **For now only admins
   can use it.**
2. **The tools:**
   - `get_presentation_format`: the recipe format (`getClaudeFormat()` in `src/lib/importPresentation.ts`).
   - `read_presentation`: reads a saved presentation as a reference: only the admin's own, other teachers' published
     copies (`sharedFrom`) and QuizMatter ones (`fromAdmin`). An admin may open any presentation, but anything else
     gets the "someone else's private one" answer, as the Privacy Policy promises.
   - `find_photos`: searches the shared photo library.
   - `prepare_photo_upload`: makes one-time upload links (`src/lib/photoTickets.ts`); Claude then sends each file to
     `/api/claude-photo` (`src/app/api/claude-photo/route.ts`).
   - `find_photos_needing_details` + `save_photo_details`: Claude fills in shared photos' file name, description,
     tags and category (e.g. editors' waiting photos). The find tool narrows by `which` (no description / waiting /
     any) and `words` (file name, tags or category, e.g. a marker file name like "todo-frogs"), a few at a time, and
     sends each picture (a 640 px copy, `loadPicture`). Saves run as the admin, so the database rules decide: a plain
     admin only gets and changes their own photos. Never the source or `is_public`. Categories:
     `src/lib/photoCategories.ts` (shared with `/api/claude-photo`). Checked with `claudePhotoFillSchema`.
   - `send_presentation`: `buildSlides` turns the recipe into real slides and checks them (the recipe schema, then
     `slideProblems` in `schema.ts` runs `slideSchema` on each built slide, so a too-long text is caught now like a
     save would). Problems go back to Claude as a report to fix. If all is well, it saves a **draft** (`src/lib/drafts.ts`) and gives a link.
   - The old names (`…_lesson…`, `…_quiz…`) still work, because old chats keep the tool list they started with.
3. **Drafts:** they live in Cloudflare D1 (`d1/migrations`), not Supabase, and last 24 hours. The link opens
   `/presentation/new?draft=<id>` (`src/app/presentation/new/page.tsx`), which loads it into the editor as a new
   presentation. It is only saved for real when the admin clicks Save (or Ctrl+S). Leaving the editor doesn't save
   it: changes are kept in that browser and come back when the link is opened again, and it stays a draft (see
   `src/components/editor/CLAUDE.md`). Nothing here touches saved presentations.

## Rules

- Everything Claude sends is checked with zod (`presentationRecipeSchema`, `claudeDetailsSchema`,
  `claudePhotoSchema`) before it's stored (see "Saving Data" in the root `CLAUDE.md`).
- Claude adds diagrams with `{ "text": … }` boxes only (automatic layout).
- Picture boxes are fitted to the drawing's real shape from `src/lib/assetShapes.json` (see `src/lib/CLAUDE.md`).
- **After adding or renaming a tool, the user must reconnect the connector in claude.ai and start a new chat**, or
  Claude won't see it. Say so when you finish such a change.
