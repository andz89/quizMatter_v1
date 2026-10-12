# Submit to QuizMatter (editors offer their own presentations)

## What it is

An **editor** (a teacher with the editor role) can send one of **their own** presentations to QuizMatter. An
**admin** looks at it and either **approves** it or **sends it back** with a note. On approval, QuizMatter gets
its **own copy**: Publisher QuizMatter, Author still the editor, shared with every teacher right away. The editor
keeps their original.

This is not the same as Presentation Reviews (`2026-10-04-presentation-reviews-design.md`). There, an editor
checks a presentation QuizMatter already has. Here, an editor offers a new one.

## Decisions

| Question | Choice |
|---|---|
| Who can submit | Editors only, their own saved presentations |
| Move or copy | **Copy.** The editor keeps their original |
| When the copy is made | **On approval.** The original is locked while it waits |
| Admin's choices | **Approve**, or **Send back** with a note |
| Withdraw | **None.** Once submitted, it waits for the admin |
| After approval | The copy is **shared right away** |
| Submit again after approval | **No.** Once approved, it can't be submitted again |

## Statuses

One row per presentation in a new table, `presentation_submissions`:

```
submitted ──Approve──▶ approved   (final: the copy exists, the original unlocks)
    │
    └──Send back──▶ sent_back ──Submit again──▶ submitted
    │
    └──(editor role taken away)──▶ canceled ──Submit again (if editor)──▶ submitted
```

- **submitted:** waiting for an admin. The original is **locked**.
- **sent_back:** the admin returned it with a note. Unlocked. The editor can change it and submit again.
- **approved:** the QuizMatter copy was made. Unlocked. Can't be submitted again.
- **canceled:** the editor lost the editor role while it waited. Unlocked.

## The database (one new migration)

### Table `presentation_submissions`

| Column | Meaning |
|---|---|
| `presentation_id` text, primary key, references `presentations` on delete cascade | The editor's original |
| `submitter_id` uuid, references `auth.users` on delete cascade | The editor |
| `status` text, check in (`submitted`, `sent_back`, `approved`, `canceled`) | See above |
| `admin_note` text, at most the same length as review notes (`reviewNoteSchema`) | Set by Send back, cleared on Submit again |
| `submitted_at` timestamptz | The last time it was submitted |
| `decided_at` timestamptz, `decided_by` uuid (references `auth.users` on delete set null) | The admin's Approve / Send back |
| `copy_id` text, references `presentations` on delete set null | The QuizMatter copy, once approved |

Row level security on, **no policies**: everything goes through the functions below (same as `slide_photos`).

### The lock

`is_review_locked(target_id)` also returns true when the presentation has a submission with status `submitted`
**and its submitter's account still exists** (same as reviews, so deleting an account never gets stuck on the
lock). The existing triggers (`presentation_review_lock`, `slide_review_lock`) then refuse every change and
delete with `QMREV`, except hiding. Nothing new is needed in the triggers.

`review_status()` reads `is_locked` from the review row only, so the app gets the submission status separately
(see "In the app").

### Functions (each checks who is calling; all `security definer`, `set search_path = ''`)

- **`submit_presentation(target_id)`**: only an editor who isn't banned, only their own presentation, only a
  saved one that isn't `from_admin` and isn't hidden. It needs a title and real slide content
  (`has_publishable_content`, error `QMPUB`). Refused (`QMSUB`) if it's already `submitted` or `approved`, or if a
  review round is open on it. Inserts the row, or turns `sent_back` / `canceled` back into `submitted`
  (clears the note, sets `submitted_at = now()`).
- **`approve_submission(target_id)`**: admins only, status must be `submitted` (else `QMSUB`), the submitter must
  not be banned (`QMBRV`, same as publishing a review). In **one step** (all or nothing):
  1. Inserts a copy of the `presentations` row with a new id (`gen_random_uuid()::text`): every detail column
     copied, but `owner_id` = the approving admin, `from_admin = true`, `is_published = true`,
     `hidden_at = null`, new `created_at` / `updated_at`. `author` = the original's author, or the editor's name
     (display name, or the part of the email before "@") when it's empty. Computed columns (`tags_text`,
     `search_text`) are left out, so the database fills them in.
  2. Copies every `slides` row to the new id (slide ids stay the same; they're only unique per presentation).
     The existing `sync_slide_photos` trigger fills `slide_photos` for the copy, so the weekly photo cleanup
     keeps its photos.
  3. Sets the row to `approved`, `copy_id`, `decided_at`, `decided_by`.
  The copy is not in any folder (folders use `folder_items`, which isn't copied) and has no review rows.
- **`send_back_submission(target_id, note)`**: admins only, status must be `submitted`. Sets `sent_back` and the
  trimmed note, `decided_at`, `decided_by`.
- **`my_submissions()`**: my rows, with the presentation's title, status, note and dates.
- **`admin_submissions()`**: admins only. Every `submitted` row with the title, the editor's name and email, and
  `submitted_at`, oldest first.
- **`submission_status(target_id)`**: the row's status and note for the owner or an admin. No row otherwise.

When an editor loses the role (the existing trigger on `editors` delete that cancels their open review rounds),
it also sets their `submitted` rows to `canceled`.

## In the app

All saves go through server actions that parse their input with zod first (ids with the `idSchema` pattern, the
note with `reviewNoteSchema`), and every action shows a sonner toast when it works and when it fails.

### Editor

- **Card label** (`PresentationCard` `badge` / `KICKERS`, design system colors):
  These match the labels My reviews already uses:
  - `submitted`: "Waiting for QuizMatter", grey (`bg-bg-page text-text-secondary`)
  - `sent_back`: "Sent back", Sunny (`bg-highlight-soft text-highlight-strong`)
  - `approved`: "In QuizMatter", Mint (`bg-success-soft text-success-strong`)
  - `canceled`: no card label (it's unlocked and can be submitted again), "Canceled" in the table, Coral
    (`bg-danger-soft text-danger-strong`)
  The home page's card data (`cards.ts`) reads the submission status of my presentations.
- **Card ⋮ menu** (`PresentationCardMenu`): "Submit to QuizMatter" for editors on a saved presentation whose
  status is none, `sent_back` or `canceled`. A confirm box first: *"Send "{title}" to QuizMatter? An admin will
  check it. Until they decide, you can't change or delete it. If they approve it, QuizMatter gets its own copy,
  shared with every teacher, with you as the Author."* While it waits, the menu has no Edit or Delete
  (Present still works).
- **Opening it** (`src/app/presentation/[id]/edit/page.tsx`): while `submitted`, the owner gets the view-only
  page (like a locked review), with a notice: *"Submitted to QuizMatter on {date}. You can change it again once an
  admin decides."* When `sent_back`, the editor opens normally, with a notice at the top showing the admin's note
  and a "Submit again" button.
- **The home tab is renamed "Reviews & submissions"** (was "My reviews", in `HomeTabs.tsx`), since it now holds
  both. Its address moves from `/reviews` to `/reviews-submissions` (the folder `src/app/(home)/reviews` becomes
  `src/app/(home)/reviews-submissions`; every link to `/reviews` is updated, and the CLAUDE.md "Presentation
  Reviews" section is updated to the new name and path). Still editors only.
- **That page** shows **two tables**, in the same style as the tables in Admin → Safety
  (uppercase `text-text-header` column headers, rows split by `border-border-default`, inside a `rounded-card`
  white card; the table scrolls sideways on narrow phones instead of breaking the page):
  - **My reviews**: `ReviewRows` (`src/app/MyReviews.tsx`) becomes a table instead of a list, one table for the
    open and canceled rounds together. Columns: **Presentation** (links to it), **Status** (the same labels and
    colors as now), **Note** (the admin's note when sent back, else empty).
  - **My submissions**: rows from `my_submissions()`. Columns: **Presentation** (links to it; an approved one also
    links to the QuizMatter copy), **Status** (the same labels as the cards), **Note** (the admin's note when sent
    back), **Submitted** (the date).
  - The "Published" cards (QuizMatter presentations I reviewed) stay cards, under the tables.
  - A table only shows when it has rows. When both are empty and nothing is published: "You haven't reviewed or
    submitted any presentations yet."

### Admin

- **Admin → Presentations**: a "Submissions (n)" button next to "Under review" (same style, `LinkPending`).
- **`/admin/presentations/submissions`**: the waiting list (title, editor, submitted on), with a `loading.tsx`
  (top line + Spinner).
- **`/admin/presentations/submissions/[id]`**: the presentation view only (the same slide viewer the review pages
  use; reuse `PresentDraftButton` to present it), with **Approve** and **Send back** (a note box), styled like
  `ReviewDecision`. Approve says *"Approved. It's now shared with every teacher, under QuizMatter."* and opens the
  list again. Error messages: already decided (`QMSUB`), editor banned (`QMBRV`).
- The approved copy then lives in the approving admin's Admin → Presentations like any other QuizMatter
  presentation (shared, Author = editor, reviews work on it as usual).

### Errors

`REFUSALS` in `src/lib/presentations.ts` gets `QMSUB`. A save refused by the lock already shows the `QMREV`
message. Its words become "under review or waiting for QuizMatter" so they fit both cases.

## Not included

- Withdraw.
- Submitting again after approval, or updating the QuizMatter copy from the original.
- Claude (the MCP server) submitting presentations.
- Telling the editor by email.

## Checking

`npx tsc --noEmit` and `npm run lint`. The user tests it live: submit as an editor, check the lock, send back,
submit again, approve, check the copy (shared, Author, Publisher, photos), and check the editor role removal cancels.
