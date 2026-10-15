# src/app/admin (the admin pages)

Admin-only work (things shared with every teacher, managing teachers) lives here, not in the editor.

- `layout.tsx` checks `getAccount().isAdmin` and shows "page not found" to everyone else, plus the header and the
  left menu (`AdminMenu.tsx`: the list of pages). A new admin page = a folder here + a line in `AdminMenu`.
- The database still refuses non-admins on its own; the layout check only hides the pages.

## The pages

| Menu | Folder | What it does |
|---|---|---|
| Photos | `page.tsx`, `AdminPhotos.tsx`, `photoSearch.ts` | Shared photo library and its categories |
| Presentations | `presentations/` | QuizMatter presentations, sharing, moving a teacher's one to QuizMatter |
| ↳ Under review | `presentations/reviews/` | Review rounds: publish, send back, cancel (`[id]` = one review) |
| ↳ Submissions | `presentations/submissions/` | Editors' submissions: approve or send back (`[id]` = one) |
| Reports | `reports/` | Reported presentations: hide, dismiss, delete |
| Teachers | `teachers/` | Ban / unban, give or take the editor role (`setEditor`) |
| Editors | `editors/` | The editors with their review numbers; remove (same `setEditor`) |
| Safety | `safety/` | Click-limit pauses (`releasePause`) and their history (`safety/history`) |
| Photo cleanup | `cleanup/` | What the weekly photo cleanup will delete |

## How an admin action is written

Each folder's `actions.ts` holds its server actions (`"use server"`). Each one, in this order:

1. Checks the input with zod (`safeParse`), and that `(await getAccount()).isAdmin`.
2. Calls the database (usually an rpc like `publish_review`) with the server client (`createClient()` from
   `@/lib/supabase/server`). Only use `createAdminClient()` for things the database can't do, like Supabase's
   login ban.
3. Calls `refresh()` so the page shows the new data.
4. Returns `null` (worked) or a short message for the user, turning known refusal codes (`QMRVW`, `QMBRV`, …) into
   words. The page shows it in a sonner toast.

Confirmations use `ConfirmModal` (`src/components/editor/ConfirmModal.tsx`), never the browser's `confirm()`.
Reviews and Submissions rules: see the root `CLAUDE.md`. `ReviewDraftView` and `PresentDraftButton`
(`src/components/presentation`) are shared with the reviewer's own pages.
