# Dev branch and preview site

Date: 2026-11-04. Status: approved in chat; this file is the written version.

## Goal

Split the GitHub repo (`andz89/quizMatter_v1`, public) into two long-lived branches:

- `main` = production. Cloudflare Workers Builds deploys it to quizmatter.com (as today).
- `dev` = work in progress. Every push builds a Cloudflare **preview** of it at its own address, so a change can be
  tried online before it reaches teachers.

Work moves from `dev` to `main` only through a GitHub pull request.

## Decisions (the user's)

- **The preview uses the live services:** the live Supabase, the live R2 photo bucket and the live D1 drafts
  database. No second Supabase project. Anything done on the preview is real data.
- **dev → main by pull request**, with `main` protected (no direct pushes).
- **The preview address is Cloudflare's preview link** (`dev-quizmatter-v1.<account subdomain>.workers.dev`), not a
  custom domain like dev.quizmatter.com, so there is one Worker, one set of secrets, and no second set of timers.

## The flow

```
work ──push──► dev ──► Cloudflare builds a Worker Preview "dev" ──► https://dev-quizmatter-v1.<account>.workers.dev
                │
                └─ pull request dev → main (GitHub checks run) ── Merge ──► main ──► Cloudflare deploys quizmatter.com
```

## Changes in the repo (done by Claude)

1. **Branch `dev`**, made from `main` and pushed. `main` stays the default branch. The calendar date work (not yet
   committed) is committed on `dev` as its first change.
2. **GitHub checks on both branches:** `.github/workflows/ci.yml` and `database.yml` run on pushes to `main` and
   `dev` (`branches: [main, dev]`), and still on every pull request (so a dev → main pull request is checked).
3. **`wrangler.jsonc`:** `"preview_urls": true`. Wrangler's default is `false`, which gives no preview address.
   `workers_dev`, `routes` and `triggers` stay as they are, so production doesn't change.
4. **Notes:** a "Branches and deploys" section in the root `CLAUDE.md` (where to work, how to release, the migration
   order, the preview's live data). The saved memory "Live migrations by hand" gets the new order.

Left alone: the old branches (`feat/diagrams`, `teacher-profiles`, …) and the user's own uncommitted edits in
`SlideToolbar.tsx` and `PresentationView.tsx` (they stay uncommitted and come along to `dev`).

## Settings outside the repo (done by the user, with exact steps)

1. **Cloudflare → Workers & Pages → quizmatter-v1 → Settings → Builds:** the Production tab stays as it is (`main`,
   `npx opennextjs-cloudflare build`, `npx opennextjs-cloudflare deploy`). The Previews Base tab (Cloudflare's Worker
   Previews, beta): "Builds for Preview branches" on, build command `npx opennextjs-cloudflare build`, preview
   command `npx wrangler preview` (a Preview named after the branch; plain wrangler is enough, since OpenNext's
   deploy only adds a cache fill and skew protection, which this app doesn't use). The two public build values
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (baked into the build) come from the committed
   `.env.production`: the Previews Base tab didn't keep build variables or an edited build command (four builds
   failed with `Invalid URL`), and both values are public anyway. Production's own build secrets win over the file.
   Previews keep their own secrets: if `SUPABASE_SECRET_KEY` is needed there, the user adds it
   (`wrangler preview secret`). A Preview never becomes the live version and never runs the cron timers (photo and
   account cleanups), so they don't run twice.
   (Changed on 2026-11-04: the plan first named `opennextjs-cloudflare upload --preview-alias dev`, for the older
   version-upload previews; the dashboard has Worker Previews instead.)
2. **Supabase (live) → Authentication → URL Configuration → Redirect URLs:** add
   `https://dev-quizmatter-v1.<account>.workers.dev/**`, so email links and sign-in redirects work on the preview.
3. **Cloudflare → Turnstile → the site's widget → Hostnames:** add `dev-quizmatter-v1.<account>.workers.dev`, so the
   login and sign up check works there.
4. **Optional, recommended: Cloudflare Access on preview links** (Worker → Settings → Domains & Routes → Preview
   URLs → enable Cloudflare Access), so only the owner can open the preview. Without it, anyone with the link can use
   the preview, against live data.
5. **GitHub → Settings → Branches → Add rule for `main`:** require a pull request before merging, and require the
   `ci` status check to pass. (No `gh` tool on this computer, so this is done in the browser.)

## Rules after this

- **Work on `dev`.** Commit and push there; check the preview.
- **Release:** open `https://github.com/andz89/quizMatter_v1/compare/main...dev`, create the pull request, wait for
  the checks, Merge. Cloudflare deploys `main`.
- **Migrations:** the preview already talks to the live database, so a migration is pasted into the live SQL editor
  **before** pushing code that needs it to `dev` (before, it was before deploying `main`). Testing still happens on
  the local Docker database first, as always.
- **A `DATA_VERSION` bump** reaches teachers' saves through the preview too: apply its migration before pushing to
  `dev`.

## Checking it

- After pushing `dev`: the GitHub checks start on the `dev` push.
- After the user's Cloudflare step: a push to `dev` shows a build in Cloudflare and the preview address opens the
  app; quizmatter.com still shows `main`.

## Risks

- The preview writes real data (the user's choice). Access (step 4) keeps strangers out.
- Worker Previews are in beta: if `npx wrangler preview` stops working, the fallback is the older version upload
  (`npx opennextjs-cloudflare upload --preview-alias dev`).
