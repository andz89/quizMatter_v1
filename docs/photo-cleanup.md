# Photo cleanup

A weekly job that deletes photo files nobody uses anymore.

## Why it exists

When a teacher removes a photo from **My photos**, only their list row goes away (the `photos` table).
The file itself stays in the R2 bucket `quizmatter-images`, because:

- a slide may still use it, and deleting it would break that slide, and
- another teacher may use the same file. Files are named by their fingerprint (a SHA-256 code of the
  photo's content), so the exact same photo uploaded by two teachers is stored once and shared.

Without cleanup, unused files would pile up forever. This job removes them safely.

## When it runs

Every **Sunday at 3:00 AM UTC**. Cloudflare runs it by itself — nobody has to click anything.
The timer is `"triggers"` in `wrangler.jsonc`.

## What it does

1. **Asks Supabase which photos are still used** — one call to the database function
   `used_photo_srcs()`. It returns every photo address that is:
   - on any teacher's **My photos** list (the `photos` table), or
   - on the **shared photos** list that admins upload for every teacher (the `shared_photos` table), or
   - inside any slide (it searches every row of the `slides` table).
   If this step fails, the job stops and deletes nothing.
2. **Lists every file** in R2 under `uploads/`.
3. **Picks the files to delete**: not used anywhere **and** older than 7 days.
4. **Deletes them**, and writes a note to the log, like
   `Photo cleanup: checked 250 files, deleted 3.` (with the names of the deleted files).

### The 7-day safety rule

A new file is never deleted, even if nothing uses it yet. A teacher may put a photo on a slide and not
save the presentation for a while. Until they save, the database doesn't know about the photo. The
7 days give them time. (Claude's drafts only live 24 hours, so they're covered too.)

## Seeing what will be deleted

Admins can open **Admin → Photo cleanup** (`/admin/cleanup`). It uses the same steps as the job
(`findUnusedPhotos()` in `src/lib/cleanupPhotos.ts`), so it shows exactly what the job will do:

- the date of the next run,
- **Deleted on the next run**: unused files old enough to go on the next run,
- **Unused, deleted later**: unused files still under 7 days old, each with the date it will go.

**Keep** saves a file, so the job skips it: a WebP file becomes a shared photo in the category you pick;
a JPEG file (shared photos must be WebP) goes to your own My photos.

The page asks the database with `admin_used_photo_srcs()`: the same list as `used_photo_srcs()`, but
callable by a logged-in admin (anyone else gets an error), so no secret key is needed.

## Files

| File | What it does |
|---|---|
| `src/lib/cleanupPhotos.ts` | The cleanup steps above, shared with the admin page |
| `src/app/admin/cleanup/` | The admin page "Photo cleanup" |
| `worker.ts` | Wraps the app's Worker: visitors get the app as before; the timer runs the cleanup |
| `wrangler.jsonc` | `main` points to `worker.ts`; `triggers` holds the timer; `vars` holds `SUPABASE_URL` |
| `supabase/migrations/20260928010000_used_photos.sql` | The `used_photo_srcs()` database function |
| `supabase/migrations/20260928020000_shared_photos.sql` | Adds shared photos, and updates `used_photo_srcs()` to keep them |
| `supabase/migrations/20260929000000_admin_used_photos.sql` | `admin_used_photo_srcs()`, for the admin page |

## Setup (one time)

1. **Add the database function.** In Supabase → SQL Editor, run the SQL in
   `supabase/migrations/20260928010000_used_photos.sql`.
2. **Add the secret key to Cloudflare.**
   - In Supabase → Project Settings → API Keys, copy the **secret** key (`sb_secret_…`, or the older
     `service_role` key).
   - In Cloudflare → Workers & Pages → `quizmatter-v1` → Settings → **Runtime variables and secrets**
     (Production) → **Add variable**: type **Secret**, name `SUPABASE_SECRET_KEY`, value = the key.
     Not the "Variables and secrets" box inside the **Build** section: the build doesn't need it, and the
     running job can't see keys saved there.
   - Never put this key in the code or in anything the browser loads. It can read and change every
     teacher's data.
3. **Deploy** (push to GitHub as usual). Cloudflare sees the timer and turns it on.

## Checking that it works

- **Its runs:** Cloudflare → Workers & Pages → `quizmatter-v1` → **Settings → Trigger Events** shows
  the timer; **Logs** shows each run and its `Photo cleanup: …` note.
- **If a run failed** (for example, the secret key is missing), the log shows the error. Nothing was
  deleted.
- **Don't test it locally** with `wrangler dev --test-scheduled`: the local setup uses the **live**
  bucket and would delete real files.

## Cost

Almost nothing. One run a week uses 1 Worker request, 1 database call, and 1 R2 "list" call per 1,000
files. Deleting R2 files is free. All of this is far inside Cloudflare's free limits.

## Known limit

If an **old** file (more than 7 days old) is uploaded again, the app reuses the file that's already
there, so its date stays old. If the teacher then puts it on a slide, removes it from My photos, and
the job runs before they save, the file could be deleted. This is very unlikely, so it's left as is.

## Changing it

- **How often:** edit the cron line in `wrangler.jsonc` (e.g. `"0 3 * * *"` = every day at 3 AM UTC),
  and `nextCleanupRun()` in `src/lib/cleanupPhotos.ts` to match (the admin page shows the next run).
- **How long new files are kept:** `KEEP_NEW_FILES_MS` in `src/lib/cleanupPhotos.ts`.
- **If photos are stored somewhere new** (a new table, or a new column outside `slides.data`): add it
  to `used_photo_srcs()`, or the job will think those photos are unused and delete them.
