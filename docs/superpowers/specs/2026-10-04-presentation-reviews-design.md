# Presentation Reviews ("Reviewed by") — Design

Date: 2026-10-04

## Goal

QuizMatter presentations (the ones admins make in Admin → Presentations) can be checked by trusted teachers
called **editors**. An editor opens a shared QuizMatter presentation, starts a review, fixes the slides and
details in the editor, fills in their "Reviewed by" fields and submits it. An admin then looks at the changes and
either publishes them (they go live for every teacher) or sends them back with a note. Every reviewer who has
reviewed a presentation is listed under "Reviewed by" on it.

## Words used here

- **Editor**: a teacher an admin gave the editor role (Admin → Teachers).
- **Review**: one round of changes by one editor, from "Review" to the admin's Publish (or Stop review).
- **Draft**: the reviewer's changed copy of the presentation, saved apart from the live one. Teachers never see it.
- **Live presentation**: what teachers see today (`presentations` + `slides` rows).

## Rules

1. Only **shared QuizMatter presentations** (`from_admin` and `is_published`) can be reviewed.
2. Only **editors** can review. One person reviews a presentation at a time.
3. Who may start a review:
   - never reviewed → any editor;
   - reviewed before → only the **last reviewer** (the one whose round the admin last published);
   - unless the admin switched on **"Open to all editors"** → any editor, for one round. The switch turns off
     when someone starts a review.
4. While a presentation is under review (status *reviewing* or *submitted*):
   - teachers still see the live version, but **Make a copy** is greyed out with an "Under review" pill;
   - the owning admin **can't edit, unshare or delete** it (the database refuses with code `QMREV`).
5. The reviewer can change everything the owner can change in the editor: slides (and everything on them),
   title, description, grade, subject, curriculum, learning competency, references, tags, transition.
   They can **not** change: **author**, sharing (Visibility), `from_admin`, owner. "Published by" always shows
   **QuizMatter**.
6. **Save as draft** saves only the draft. **Submit for publishing** opens the "Reviewed by" form, saves the
   draft + fields, and sets status *submitted*. The reviewer is told: "Thanks! QuizMatter will publish this
   presentation in 1–2 days." While *submitted*, the reviewer can view the draft but not change it.
7. **Stop review** (reviewer, with a confirm step): no changes reach the original presentation. The draft and
   fields are thrown away, the lock ends, and the round's status becomes **canceled**, so the admin's "Under
   review" list shows the presentation as **Canceled** with that reviewer's name. The "last reviewer" stays
   whoever it was before.
8. The admin, for a *submitted* review:
   - **Publish**: the draft replaces the live presentation's details and slides; the reviewer's "Reviewed by" row
     is added (or updated, if they reviewed it before); the review ends; the reviewer becomes the last reviewer.
   - **Send back** with a note: status goes back to *reviewing*; the reviewer sees the note and can edit and
     submit again.
9. Removing someone's editor role cancels any review they have open (same as Stop review).
10. A presentation is **locked** only while its status is *reviewing* or *submitted*. *Canceled* and *published*
    rounds don't lock it; a new round replaces them.

## "Reviewed by" fields

| Field | Input | Rule (zod `reviewerSchema`, and a length check in the database) |
|---|---|---|
| Name | text, filled in from the account's display name | required, max 100 |
| Email | text, filled in from the account's email | valid email, max 254 |
| Background (education / current work) | textarea | required, max 1000 |
| Date reviewed | date picker, starts on today | a real date, not in the future |

The admin's send-back note: required, max 500 (zod `reviewNoteSchema`).

## Database (one new migration)

### Tables

- **`editors (user_id uuid primary key references auth.users on delete cascade)`**, like `admins`. No rules for
  teachers; admins add and remove rows through rules that check `is_admin()`. New function **`is_editor()`**
  (security definer, like `is_admin()`).
- **`presentation_reviews`**, one row per presentation that has had a review:
  - `presentation_id text primary key references presentations on delete cascade`
  - `reviewer_id uuid` — the reviewer of the latest round
  - `status text` — `'reviewing'`, `'submitted'`, `'canceled'` or `'published'` (locked only for the first two)
  - `draft jsonb` — the draft presentation (same shape as `presentationSchema`, with all slides)
  - `draft_updated_at timestamptz` — for the "saved in another tab" check
  - `submitted_fields jsonb` — the four fields, waiting for the admin
  - `admin_note text` — why it was sent back
  - `started_at`, `submitted_at timestamptz`
  - `last_reviewer_id uuid` — who may start the next round
  - `open_to_all boolean not null default false`
  - `ended_at timestamptz` — when it was canceled or published
  - Rules: no direct writes. Reading the whole row: the round's reviewer and admins. Everyone else learns only
    what they need through `review_status(id)`.
- **`presentation_reviewers`**: `presentation_id`, `reviewer_id`, `name`, `email`, `background`, `reviewed_on date`,
  primary key `(presentation_id, reviewer_id)`. Read: anyone who can read the presentation. No direct writes.

### Functions (all `security definer`, `set search_path = ''`, each checks who is calling)

| Function | Who | What it does |
|---|---|---|
| `review_status(id)` | anyone logged in | locked or not, status, reviewer's name, `can_start` (for me), `is_mine` (I'm the reviewer of an open round) |
| `start_review(id)` | editor | checks rules 1–3 and that it isn't locked, starts a new round (me as reviewer, status *reviewing*, old draft/fields/note cleared), turns `open_to_all` off |
| `save_review_draft(id, draft, base_updated_at)` | the round's reviewer, status *reviewing* | saves the draft; refuses with `QM409` if it was saved in another tab since; checks the slide count limit; returns the new save time |
| `submit_review(id, draft, fields)` | the round's reviewer, status *reviewing* | saves draft + fields, status *submitted* |
| `stop_review(id)` | the round's reviewer (status *reviewing* or *submitted*), or the trigger when the editor role is removed | status *canceled*, `ended_at` set, draft and fields cleared; the live presentation is not touched |
| `publish_review(id)` | admin, status *submitted* | copies the draft onto `presentations` (only the content columns, never `owner_id`, `from_admin`, `is_published`, `created_at` or `author`) and `slides` (same delete/insert as `save_presentation`), upserts `presentation_reviewers`, sets `last_reviewer_id`, status *published*, `ended_at` set, draft cleared |
| `send_back_review(id, note)` | admin | status *reviewing*, saves the note |
| `set_review_open(id, open)` | admin | the "Open to all editors" switch |
| `my_reviews()` | editor | my open rounds (*reviewing*, *submitted*): id, title, status, note |
| `admin_reviews()` | admin | rounds that are *reviewing*, *submitted* or *canceled*: id, title, reviewer name, status, started/submitted/canceled time |

### Changes to existing database code

- `save_presentation`: refuse with `QMREV` when the presentation is locked (status *reviewing* or *submitted*).
- A `before delete` trigger on `presentations`: refuse with `QMREV` when it's under review.
- A trigger on `editors` delete: ends that user's open reviews.
- `used_photo_srcs`: also counts photos inside `presentation_reviews.draft`, so the weekly photo cleanup never
  deletes a photo only a draft uses.

## App

### Shared code

- `src/lib/schema.ts`: `reviewerSchema`, `reviewNoteSchema` (limits live here).
- `src/lib/reviews.ts`: client calls for `start_review`, `save_review_draft`, `submit_review`, `stop_review`. Each
  parses its input with zod right before the rpc call (draft with `presentationSchema`).
- `src/lib/presentations.ts`: add `QMREV: "This presentation is under review, so it can't be changed right now."`
  to `REFUSALS`.
- `src/lib/account.ts`: add `isEditor` (one more rpc in the same `Promise.all`).
- `src/lib/fetchPresentation.ts`: also returns the review status and the reviewers list.

### View page (`/presentation/[id]`, `PresentationPreview.tsx`)

- **Review** button (editors who `can_start`): calls `start_review`, then opens the editor (Spinner + top line).
- **Continue review** for the reviewer of the open round instead.
- **Make a copy**: disabled while under review, with an "Under review" pill (`bg-highlight-soft
  text-highlight-strong`); `makeCopy` checks the status first.
- **"Reviewed by"** block in the details card: each reviewer's name, email, background (line breaks kept), date.

### Editor review mode

- `/presentation/[id]/edit/page.tsx`: if I'm not the owner but I'm the reviewer of its open round, open my draft (or the
  live presentation if I have no draft yet) in review mode; otherwise redirect as today.
- `store.ts`: a `reviewMode` flag. In review mode `savePresentation` calls `saveReviewDraft` (same
  saving/saved/error states, same toasts, Ctrl+S still works); while *submitted* the editor is read-only.
- `EditorTopBar.tsx` in review mode: Save button reads **"Save as draft"**; new main button **"Submit for
  publishing"** opens the "Reviewed by" modal; a **Stop review** item with a confirm step; back arrow goes to the
  view page; a banner shows the admin's send-back note when there is one.
- `DetailsPanel.tsx` in review mode: Visibility hidden; Author shown read-only; "Published by" reads "QuizMatter".
  (`submit_review` / `publish_review` also keep the live author, so it can't be changed from outside the app.)
- Every action shows a sonner toast on success and on failure.

### Home page

- Editors with open reviews get a **"My reviews"** row: title + status pill (*Reviewing*, *Waiting for
  QuizMatter*, *Sent back*). Clicking opens the view page.

### Admin

- **Admin → Teachers**: a "Make editor / Remove editor" button per row and an "Editor" pill (`bg-accent-soft
  text-accent`). Server actions `makeEditor` / `removeEditor`, checked with zod (`z.uuid()`) and `isAdmin`.
- **Admin → Presentations**:
  - an **"Under review"** button showing the list from `admin_reviews()`: title, reviewer, status pill
    ("Reviewing"; "Waiting for you" in Sunny; "Canceled" in grey `bg-bg-page text-text-secondary`), time. A
    canceled row stays until a new round starts on that presentation;
  - an **"Open to all editors"** switch on each shared QuizMatter row.
- New page **`/admin/presentations/review/[id]`** (+ `loading.tsx` with the top line and Spinner): the draft's
  details, the submitted "Reviewed by" fields, and all slides (`FluidSlidePreview`), with **Publish** (main
  button) and **Send back** (modal with the note).

## Design system

Everything uses the existing classes in `globals.css`: `rounded-card` modals and cards, `rounded-button` buttons,
`btn-press` main buttons, `-soft`/`-strong` pills, Lucide icons with `size`, the one `Spinner`, `TopLoadingBar` /
`LinkPending` for page changes. No new colors.

## Errors

- Every database refusal has a code and a plain message (`QMREV`, `QM409`, and a new `QMRVW` for "you can't
  review this right now", e.g. someone else started first).
- Starting a review that someone else just took: toast "Someone else just started reviewing this." and the page
  reloads its status.

## Checking

Per CLAUDE.md: `npx tsc --noEmit`, `npm run lint`, read the diff against this spec. Live testing in the browser is
left to the user. No new packages.

## Not included

- Email notifications (the reviewer sees status on the home page; the admin sees the "Under review" list).
- Reviewing teachers' own presentations, or QuizMatter presentations that aren't shared.
- Showing the admin a side-by-side "before / after" of the changes.

---

## Addendum (2026-10-04): view-only submitted review, actions menu, "Review" column

### 1. A submitted review is view-only

- When the reviewer opens `/presentation/[id]/edit` and their round is **submitted**, the editor does not open.
  A read-only page opens instead: a "Waiting for QuizMatter — it will be published in 1–2 days." note, the
  draft's details, the submitted "Reviewed by" fields, every slide as a picture, a **Present** button and a link
  back to the presentation page. There are no tools, so nothing can be moved or changed.
- The draft's details + "Reviewed by" + slide pictures are one shared component (`ReviewDraftView`), used by this
  page and by the admin's review page (`/admin/presentations/reviews/[id]`).
- The editor no longer needs a "submitted" state: its "Waiting for QuizMatter" pill, the "won't be saved" banner
  and the blocked Ctrl+S are removed. The editor's review mode is only ever *reviewing*.

### 2. The reviewer's top bar

- In review mode the top bar shows **Save as draft** and a **⋮** button (Lucide `EllipsisVerticalIcon`). The ⋮
  opens a small menu with **Submit for publishing** (opens the "Reviewed by" form) and **Stop review** (coral
  text, confirm step). The menu closes on a click outside or Esc, like the account menu.

### 3. "Review" column in Admin → Presentations

- Database: `presentation_reviewers` gets `approved_by uuid` (references auth.users, on delete set null) and
  `approved_at timestamptz`; `publish_review` sets them to the publishing admin and now(). New admin-only
  function `admin_reviewers()` returns every reviewer row with the approving admin's display name and email (no
  rows for non-admins). No existing rows need filling in (no review has been published yet).
- The QuizMatter presentations table gets a **Review** column: a clickable **Reviewed** pill
  (`bg-success-soft text-success-strong`) when the presentation has at least one reviewer, otherwise grey
  "Not reviewed" text. The page loads every reviewer row up front.
- Clicking **Reviewed** opens a "Reviewed by" modal: one card per reviewer with name, email, date reviewed,
  education / current work, and "Approved by <admin name> (<admin email>) · <date>".
- Nothing new is saved from these screens, so no new zod schema is needed. No new packages.
