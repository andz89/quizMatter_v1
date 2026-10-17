# src/app/admin (the admin pages)

Admin-only work (things shared with every teacher, managing teachers) lives here, not in the editor.

- `layout.tsx` checks `getAccount().isAdmin` and shows "page not found" to everyone else, plus the header and the
  left menu (`AdminMenu.tsx`: the list of pages). A new admin page = a folder here + a line in `AdminMenu`.
- The database still refuses non-admins on its own; the layout check only hides the pages.
- Super admin vs plain admins (root `CLAUDE.md`, "Super Admin"): `AdminMenu` items with `superOnly` (Teachers,
  Safety, Photo cleanup) show only for the super admin; those pages and their actions check `isSuperAdmin`.
  Admin → Photos shows a plain admin only their own photos (`uploaded_by`) and hides Categories. `setEditor` stays
  open to every admin (Admin → Editors uses it).

## The pages

| Menu | Folder | What it does |
|---|---|---|
| Photos | `page.tsx`, `AdminPhotos.tsx`, `photoSearch.ts` | Shared photo library and its categories. Editors' uploads show as **Waiting** (pill + filter) until a live QuizMatter presentation uses them; editable like the rest |
| Presentations | `presentations/` | QuizMatter presentations, sharing, moving a teacher's one to QuizMatter |
| ↳ Under review | `presentations/reviews/` | Review rounds: publish, send back, cancel (`[id]` = one review) |
| ↳ Submissions | `presentations/submissions/` | Editors' submissions: approve or send back (`[id]` = one) |
| Reports | `reports/` | Reported presentations: hide, dismiss, delete |
| Teachers (super admin only) | `teachers/` | Ban / unban, give or take the editor role (`setEditor`) |
| Editors | `editors/` | The editors with their review numbers and how many presentations / photos they made; remove (same `setEditor`). The name opens `[id]`: view only, their presentations (not shared copies) with each one's Submit to QuizMatter status, their reviews (published ones from `presentation_reviewers`, plus each presentation's latest round from `presentation_reviews`, which keeps no older rounds), and their uploaded photos (`photos`; file name, category, tags, … only if the photo is also a shared one, else the stored file's name and "—"; Status = Waiting / Public from `shared_photos.is_public`) |
| Safety (super admin only) | `safety/` | Click-limit pauses (`releasePause`) and their history (`safety/history`) |
| Photo cleanup (super admin only) | `cleanup/` | What the weekly photo cleanup will delete |

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
