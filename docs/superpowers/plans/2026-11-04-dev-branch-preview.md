# Dev Branch and Preview Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `dev` branch whose every push gets GitHub's checks and a Cloudflare preview, with `main` reached only by pull request.

**Architecture:** Git branches plus configuration: the two GitHub workflows run on `dev` too, `wrangler.jsonc` turns on
preview links, and the root `CLAUDE.md` says how to work. Dashboard settings (Cloudflare, Supabase, Turnstile, GitHub
protection) are the user's, as a checklist.

**Tech Stack:** git, GitHub Actions, Cloudflare Workers Builds + OpenNext (`@opennextjs/cloudflare` 1.20.6, wrangler 4.139.0).

**Spec:** `docs/superpowers/specs/2026-11-04-dev-branch-preview-design.md`

## Global Constraints

- `main` stays the default branch and the production branch; nothing in the repo changes how `main` deploys.
- `wrangler.jsonc`: add only `"preview_urls": true`; `workers_dev`, `routes`, `triggers` stay as they are.
- Never commit the user's own edits in `src/components/editor/SlideToolbar.tsx` and
  `src/components/presentation/PresentationView.tsx`, nor `.claude/`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The preview uses the live Supabase, R2 and D1 (the user's choice); migrations go to live before a push to `dev`.

## Review Focus

- The user's two uncommitted files must still be uncommitted (and unchanged) after switching to `dev`.
- A pull request dev → main must still run both workflows (`pull_request` triggers kept).
- `database.yml`'s `paths` filter must stay on both its `push` and `pull_request` triggers.
- `wrangler.jsonc` must still parse (JSON with comments) after the edit.
- The push to `dev` must not touch `origin/main`.

---

### Task 1: The `dev` branch with the calendar work

**Files:**
- Commit (already written): `src/lib/calendarDate.ts`, `src/lib/calendarDate.test.ts`, `src/lib/schema.ts`,
  `src/lib/schema.test.ts`, `src/lib/store.ts`, `src/lib/svgLibrary.tsx`, `src/lib/importPresentation.ts`,
  `src/lib/CLAUDE.md`, `src/components/editor/SelectedElementToolbar.tsx`, `src/components/editor/PanelControls.tsx`,
  `src/components/editor/CLAUDE.md`, `supabase/migrations/20261231000800_calendar_date.sql`,
  `supabase/tests/calendar_date.sql`, `supabase/schema.sql`, `src/lib/database.types.ts`, `e2e/calendar-date.mjs`,
  `e2e/CLAUDE.md`

- [ ] **Step 1:** `git switch -c dev` from `main`. Check: `git status --short` still lists `SlideToolbar.tsx` and `PresentationView.tsx` as modified.
- [ ] **Step 2:** `npm test` → 135 pass, 0 fail; `npx tsc --noEmit` and `npm run lint` → no output errors.
- [ ] **Step 3:** Commit exactly the files above: "Calendar elements: a Calendar Page and a Month Calendar with Set date".

### Task 2: Checks on `dev`, preview links, notes

**Files:**
- Modify: `.github/workflows/ci.yml` (push `branches: [main]` → `[main, dev]`)
- Modify: `.github/workflows/database.yml` (push `branches: [main]` → `[main, dev]`; `paths` and `pull_request` unchanged)
- Modify: `wrangler.jsonc` (add `"preview_urls": true` with a one-line comment: the dev branch's preview link)
- Modify: `CLAUDE.md` (new section "Branches and deploys", after "Workflow Preferences"; the GitHub workflows line in
  "Tests" says `main` and `dev`)
- Create: `docs/superpowers/specs/2026-11-04-dev-branch-preview-design.md`, this plan
- Memory: update `live-migrations-by-hand.md` (migration on live before pushing to `dev`)

- [ ] **Step 1:** Make the edits. The "Branches and deploys" section says, short: work and push on `dev` (preview at
  `dev-quizmatter-v1.<account>.workers.dev`, live data); release = pull request
  `https://github.com/andz89/quizMatter_v1/compare/main...dev`, checks, Merge; never push to `main`; a migration (and
  a `DATA_VERSION` bump's migration) goes to live before the push to `dev`; spec link.
- [ ] **Step 2:** Verify the workflows with `js-yaml` (already in node_modules): for each file, the parsed `on.push.branches`
  deep-equals `["main", "dev"]` and `on.pull_request` is still there; for `database.yml`, `on.push.paths` and
  `on.pull_request.paths` are unchanged.
- [ ] **Step 3:** Verify `wrangler.jsonc` with TypeScript's JSON-with-comments reader
  (`ts.parseConfigFileTextToJson`): no error, `preview_urls === true`, and `routes`, `triggers`, `workers_dev`
  (absent) as before. The full check is the first Cloudflare build after the user's step (Task 3).
- [ ] **Step 4:** Commit: "Dev branch: checks run on dev, Cloudflare preview links, notes".

### Task 3: Push and check

- [ ] **Step 1:** `git push -u origin dev`. Check `git rev-parse origin/main` is unchanged.
- [ ] **Step 2:** `curl -s "https://api.github.com/repos/andz89/quizMatter_v1/actions/runs?branch=dev&per_page=5"` → runs for `ci` (and `database`, since `supabase/` changed) on the dev head commit.
- [ ] **Step 3:** Give the user the dashboard checklist from the spec ("Settings outside the repo", steps 1–5), with the exact values.
