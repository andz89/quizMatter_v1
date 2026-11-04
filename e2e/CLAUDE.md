# Browser tests (Playwright)

Playwright is already installed (`playwright` in devDependencies, its Chromium in `%LOCALAPPDATA%\ms-playwright`).
Don't install it again, and don't make a new folder for browser tests in the scratchpad: write them here, using
`lib.mjs`.

## Running them

1. The local Docker Supabase is up (`npx -y supabase@latest start`).
2. `npm run e2e:dev` (`dev.mjs`, keep it running): the app on **http://localhost:3100**. It reads the local keys from
   `supabase status` (they win over the live ones in `.env.local`), applies the D1 migrations locally, and sets
   `QM_E2E=1`, so `next.config.ts` uses local copies of D1 and R2 (no Cloudflare login needed) and builds in
   `.next-e2e`, so it can run next to `npm run dev`.
3. `node e2e/<test>.mjs`. Each prints `PASS` / `FAIL` per check and `N of M checks passed`, and exits 1 on a failure.
   Screenshots go to `e2e/shots/` (not saved in git).

## Writing one

A plain Node script with the `playwright` library (not `@playwright/test`). From `lib.mjs`:

- `env` (the local keys; it stops if they aren't for 127.0.0.1), `APP`, `SHOTS`.
- `makeTeacher({ first, last, superAdmin })`: a new confirmed account with a unique email;
  `deleteTeacher(teacher)` in `finally` deletes it and its presentations.
- `loggedIn(browser, teacher, viewport)`: a browser context already logged in (the session goes into the
  `sb-127-auth-token` cookie, so the login page's Turnstile box is skipped). It blocks every `*.supabase.co`
  request, and `finish()` fails the run if one was tried.
- `api(path, init)`: the local API with the service role key (e.g. insert presentations and slides).
  `psql(sql)`: SQL as postgres in the Docker database.
- `check(name, ok, detail)` per check, then `finish()` at the end.

Tests that delete data (the announcements ones empty the announcements table) do so only in the local database.

## The tests

- `hidden-slides.mjs`: hide a slide, save, present (→ / ← skip it), the all-slides grid, show it again.
- `add-slide-menu.mjs`: the slide's + and the workspace's Add slide have no "Embed image" (the other 8 types stay),
  and an image slide saved before still opens with its picture.
- `calendar-date.mjs`: add a Calendar Page and a Month Calendar (both start on today), Set date to 29 February 2024,
  Today, save, reload.
- `photo-delete.mjs`: Photo cleanup's Delete refuses a file under 7 days old (a WebP and an announcement's GIF,
  which counts as our file), and the page shows no Delete button on it.
- `photo-uploads.mjs`: a plain teacher's profile photo is refused before anything is counted; an editor's is stored
  and the profile switches to it, counted once; a too-big upload sent in pieces (no Content-Length) gets 413.
- `announcements-admin.mjs`: the super admin makes a corner box and an HTML modal in the form; a teacher sees them.
- `announcements-show-after.mjs`: the super admin sets "It shows after 8 seconds" in the form (not on a top bar;
  the list line, the saved number, the edit page). The teacher's modal waits, keeps counting across a reload and an
  in-app move, starts over in a new tab, doesn't count in a background tab or while presenting; a corner box with no
  wait shows at once, then waits while the modal is up.
- `announcements-interval.mjs`: the super admin picks "Again every 2 minutes" in the form (the box starts at 15;
  backspacing and typing 30 gives 30). The teacher's modal, once closed, stays gone across an in-app move and a
  reload and comes back after 2 minutes (Playwright's `clock` jumps the time), comes back as soon as the tab is in
  front after a laptop sleep (`clock.setSystemTime`: the time jumps but no timer fires), waits while presenting,
  shows at once in a new tab, and no closed record is saved.
- `announcements-pages.mjs`: announcements put straight in the table, checked on the home, saved, liked, search,
  account and editor pages, at desktop and phone width.
