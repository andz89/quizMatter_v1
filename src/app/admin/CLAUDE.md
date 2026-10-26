# src/app/admin (the admin pages)

Admin-only work (things shared with every teacher, managing teachers) lives here, not in the editor.

- `layout.tsx` checks `getAccount().isAdmin` and shows "page not found" to everyone else, plus the header and the
  left menu (`AdminMenu.tsx`: the list of pages). A new admin page = a folder here + a line in `AdminMenu`.
- The admin pages use the full screen width. From `lg` the menu is a column on the left (it stays in place as
  you scroll); below that it is one row above the page that scrolls sideways. The menu has Overview on top, then groups, each a card with its label in violet: **Waiting for you** (Under review, Submissions, Reports), **Library**
  (Presentations, Photos, Photo cleanup), **People** (Teachers, Editors, Safety), and Admin log on its own. The Waiting for you
  items show a yellow count pill when something waits. `layout.tsx` reads the numbers with the `admin_todo_counts`
  rpc (if it fails, no pills) and passes them to `AdminMenu`; `page.tsx` (Overview) reads the same rpc.
- The database still refuses non-admins on its own; the layout check only hides the pages.
- Super admin vs plain admins (root `CLAUDE.md`, "Super Admin"): `AdminMenu` items with `superOnly` (Teachers,
  Safety, Photo cleanup, Admin log, Data check) show only for the super admin; those pages and their actions check `isSuperAdmin`.
  Admin → Photos shows a plain admin only their own photos (`uploaded_by`) and hides Categories. `setEditor` stays
  open to every admin (Admin → Editors uses it).

## The pages

| Menu | Folder | What it does |
|---|---|---|
| Overview | `page.tsx`, `OverviewCharts.tsx` | The first page. What waits for you (the To do counts, linked), then bars per day for the last 7 / 30 / 90 days (`?days=`) from the `admin_overview` rpc (reads `activity_events` and the real tables; the people charts, the logins, signups, pauses and bans, come back only for the super admin). The super admin also sees the latest admin actions |
| Photos | `photos/` (`page.tsx`, `AdminPhotos.tsx`, `photoSearch.ts`) | Shared photo library and its categories. Editors' uploads show as **Waiting** (pill + filter) until a live QuizMatter presentation uses them; editable like the rest |
| Presentations | `presentations/` | QuizMatter presentations, sharing, moving a teacher's one to QuizMatter |
| ↳ Under review | `presentations/reviews/` | Review rounds: publish, send back, cancel (`[id]` = one review) |
| ↳ Submissions | `presentations/submissions/` | Editors' submissions: approve or send back (`[id]` = one) |
| Reports | `reports/` | Reported presentations: hide, dismiss, delete |
| Teachers (super admin only) | `teachers/` | Ban / unban, give or take the editor role (`setEditor`) |
| Editors | `editors/` | The editors with their review numbers and how many presentations / photos they made; remove (same `setEditor`). The name opens `[id]`: view only, their presentations (not shared copies) with each one's Submit to QuizMatter status, their reviews (published ones from `presentation_reviewers`, plus each presentation's latest round from `presentation_reviews`, which keeps no older rounds), and their uploaded photos (`photos`; file name, category, tags, … only if the photo is also a shared one, else the stored file's name and "—"; Status = Waiting / Public from `shared_photos.is_public`) |
| Safety (super admin only) | `safety/` | Click-limit pauses (`releasePause`) and their history (`safety/history`) |
| Photo cleanup (super admin only) | `cleanup/` | What the weekly photo cleanup will delete |
| Admin log (super admin only) | `activity/` | Every admin action from the `admin_actions` table, newest first, 50 a page; filter by admin and action (`?admin=`, `?action=`, `?page=`). Words for the actions: `src/lib/adminActions.ts` |
| Data check (super admin only) | `data-check/` | "Check saved data": reads every presentation (50 at a time) and review draft with the secret-key client, parses each like the editor opens it (`rowToPresentationInput` + `presentationSchema`, which upgrades old shapes), and lists the ones that fail (slide number, zod's message). Only reads. Run it locally (`npm run dev`) before deploying a change to the saved shape (see `src/lib/CLAUDE.md`) |

## How an admin action is written

Each folder's `actions.ts` holds its server actions (`"use server"`). Each one, in this order:

1. Checks the input with zod (`safeParse`), and that `(await getAccount()).isAdmin`.
2. Calls the database (usually an rpc like `publish_review`) with the server client (`createClient()` from
   `@/lib/supabase/server`). Only use `createAdminClient()` for things the database can't do, like Supabase's
   login ban.
3. Calls `refresh()` so the page shows the new data.
   The Admin log needs nothing here: the database writes it (triggers on the tables an admin changes, into
   `admin_actions`), so an action does not log itself. The exceptions are the steps a trigger can't see: ban, unban
   and releasing a pause. Those call the `log_ban`, `log_unban` and `log_click_release` rpcs after the step worked.
4. Returns `null` (worked) or a short message for the user, turning known refusal codes (`QMRVW`, `QMBRV`, …) into
   words. The page shows it in a sonner toast.

Confirmations use `ConfirmModal` (`src/components/editor/ConfirmModal.tsx`), never the browser's `confirm()`.
Reviews and Submissions rules: see the root `CLAUDE.md`. `ReviewDraftView` and `PresentDraftButton`
(`src/components/presentation`) are shared with the reviewer's own pages.
