# Workflow Preferences

Whenever a requested feature or adjustment would change the structure or behavior of the app (new data flow, new component/module, schema change, new dependency, altered logic), do NOT write code first. First reply with a plan: describe the structure/architecture you intend to build, walk through the logic in detail, and explicitly call out any external or internal library you plan to use. Wait for the user to review and approve the plan before implementing.

# Installing Packages (npm version)

The app deploys on Cloudflare Workers Builds, which runs `npm ci` with **npm 10.9.2**. The user's machine has npm 11, which writes a `package-lock.json` that npm 10's `npm ci` rejects ("package.json and package-lock.json are not in sync") and the deploy fails.

So whenever you add, remove, or update a package, always use npm 10.9.2 instead of plain `npm`:

- Add: `npx -y npm@10.9.2 install <package>` (dev: `npx -y npm@10.9.2 install -D <package>`)
- Remove: `npx -y npm@10.9.2 uninstall <package>`
- Any other change to `package.json` dependencies: run `npx -y npm@10.9.2 install` afterwards to rewrite the lock file

Do this yourself — don't ask the user to run it. Commit `package-lock.json` together with `package.json`.

# Code Review Commands

When the user names a feature or part of the app they want reviewed (e.g. "review the slide limits", "review the login page"), find the files that feature lives in and give them a ready-to-copy `/code-review` command with those file paths as the target, so the review looks only at that feature:

```
/code-review high src/lib/schema.ts src/lib/presentations.ts supabase/migrations/20261011000000_lower_limits.sql
```

- Search the code first (Grep/Glob). Don't guess paths from memory.
- Include every file that holds the feature's logic: components, server actions, `src/lib` helpers, zod schemas, and the Supabase migrations for it. Leave out files that only mention it in passing.
- Keep the effort level the user asked for (default `high`).
- Under the command, list each file with a few words on why it's included, so the user can drop any they don't want.
- Don't run the review yourself. Give the command, and let the user run it.

# Code Style

Keep the code:

- Simple and readable
- Well-structured without over-engineering
- Optimized where it actually matters
- Easy to maintain and modify
- Free of unnecessary abstractions, hooks, utilities, or patterns unless they provide a real benefit

# Saving Data

Validate all input data with zod before saving it to Supabase — from the editor, forms, Claude (the MCP server), or anywhere else. Parse it with the matching zod schema right before the insert/update/rpc call, and don't save anything that fails. Put limits (like maximum text length) in the zod schema, so they're checked in one place.

# Click Limits (pausing a feature clicked too fast)

There is ONE system for pausing a feature when a teacher clicks it too fast (e.g. bookmarks: 20 clicks in 25 seconds → paused 10 minutes, or 1 hour if it happens again within 24 hours). Reuse it; never build a second one. To add a feature:

1. A migration that inserts its row into `click_limits` and calls `count_click('<feature>')` from that feature's trigger or database function (see `supabase/migrations/20261013000000_click_limits.sql`).
2. Add it to `CLICK_FEATURES` in `src/lib/clickLimits.ts`.
3. In the app: read the refusal with `pausedUntilFromError`, call `pauseFeature`, and disable its buttons with `useIsPaused`. The sticky notice at the bottom (`src/components/ClickPauseNotice.tsx`, in the root layout) shows by itself.

A feature's `ban_after_pauses` (in `click_limits`; bookmarks: 3) turns a chain of that many pauses, each within `repeat_within_hours` of the last, into a real ban: a `banned_users` row marked `is_automatic` (Admin → Teachers shows "Automatic") plus Supabase's login ban. Leave it empty for a feature that should never ban. See `supabase/migrations/20261014000000_click_auto_ban.sql`.

# Presentation Reviews (editors checking QuizMatter presentations)

Editors (teachers an admin trusts) review shared QuizMatter presentations; an admin publishes or sends back each review. Full design: `docs/superpowers/specs/2026-10-04-presentation-reviews-design.md`. When changing it, keep these rules:

- **Editor role:** the `editors` table and `is_editor()`. Admins give or take it in Admin → Teachers (`setEditor`). Taking it away cancels that editor's open review.
- **One round at a time** per presentation, in `presentation_reviews`: reviewing → submitted → published (or sent back to reviewing, or canceled by Stop review). While reviewing or submitted the presentation is **locked**: database triggers refuse every change to it and its slides (error `QMREV`), except hiding. Only `publish_review` gets through.
- **The reviewer's work is a draft** in `presentation_reviews.draft`, never in `presentations` / `slides`, until an admin publishes. A reviewer can't change the author, sharing, owner or "from QuizMatter".
- **The rules live in the database functions** (`start_review`, `save_review_draft`, `submit_review`, `stop_review`, `publish_review`, `send_back_review`, `set_review_open`, `review_status`, `my_reviews`, `admin_reviews`, `admin_reviewers`), each checking who is calling. Change a rule there, not only in the app. Migrations: `20261019000000_presentation_reviews.sql`, `20261020000000_review_submit_checks.sql`, `20261021000000_review_approvals.sql`.
- **In the app:** reviewer saves go through `src/lib/reviews.ts` (zod first); reads through `src/lib/reviewStatus.ts`. The editor's review mode is `review` in the store plus `ReviewControls` (Save as draft + the ⋮ menu). A submitted review opens view only (`ReviewSubmittedView`, no editor). Admin pages are under `src/app/admin/presentations/reviews`. `ReviewDraftView` and `PresentDraftButton` are shared by the reviewer's and the admin's pages; reuse them.
- **Photos in drafts count as used** in `used_photo_srcs`, so the weekly photo cleanup keeps them. Keep that if the cleanup changes.

# Loading Spinner

Whenever the user waits for something (opening a quiz, loading a page, saving, any slow action), show a spinner — always.

The app has exactly ONE spinner component, in `src/components/Spinner.tsx`. Always reuse it. Never add a second spinner, a different spinner style, or an inline copy of its markup. If it needs a new size or color, add an option to that one component instead.

# Top Loading Line

When the user clicks something that opens another page, show a thin line at the very top of the screen that grows from left to right while they wait, like YouTube — and it must show at once, on the click, not after the server answers.

- The app has exactly ONE top line component, in `src/components/TopLoadingBar.tsx` (its animation is `--animate-top-bar` in `globals.css`). Always reuse it. Never build a second one or add a package for it.
- For links, put `src/components/LinkPending.tsx` inside the `<Link>`. It uses Next.js's `useLinkStatus` to show the top line (and, if asked, the Spinner) the moment the link is clicked.
- Every page that loads slowly also gets a `loading.tsx` that shows the top line and the Spinner.

# Communication Style

When explaining things to the user (in chat replies, comments, or docs), use plain, simple, basic English — short words and short sentences over technical jargon. If a difficult or technical term is unavoidable, add a simpler synonym right after it and give a concrete example. For instance: "memoize (means: remember a result so it doesn't have to be recalculated) — e.g. caching a math answer instead of redoing the calculation every time."

# QuizMatter — Design System

**REQUIRED:** Every new feature, page, button, panel, modal, form, card, and any other part of the app MUST use this design system. This also applies to changes to existing parts. No exceptions: don't invent new colors, fonts, radii, shadows, or icon styles, and don't copy a look from somewhere else. If something you need isn't covered here, add it to `src/app/globals.css` (and to this section) in the same style, instead of hard-coding it in one place.

The source of truth is the "Modernist" design-system project in Claude Design (claude.ai/design), in its `brand/QuizMatter Brand.html`, `styles.css` and `readme.md`. In the code, every value lives in `src/app/globals.css` as a CSS variable and a Tailwind class (`bg-accent`, `rounded-card`, …). Always use those classes; never hard-code a color, radius or font in a component.

## Overall Style

Bright, rounded and friendly for kids, but clean enough to feel credible to teachers:

- **One confident violet** for the brand and main actions, a **sunny yellow** for highlights, and clear **right/wrong** colors (mint/coral). Color always means something; it is never decoration.
- **Soft and round:** 1.5px soft borders and rounded corners everywhere (8 / 14 / 24px). No square corners.
- **Chunky main buttons:** violet with a solid 4px "key" edge underneath that sinks when pressed (the `btn-press` class).
- **Easy-to-read type:** Lexend for all text; Bricolage Grotesque (extra bold, tight spacing) for headings.
- **Generous whitespace** and white cards on the light Paper background.

## Colors

| Tailwind class / CSS variable | Value | Usage |
|---|---|---|
| `bg-page` / `--bg-page` | `#FAF8FF` | Page background (Paper) |
| `bg-surface` / `--bg-surface` | `#FFFFFF` | Cards, panels |
| `border-default` / `--border-default` | `#E6E1F5` | Borders, dividers |
| `text-primary` / `--text-primary` | `#1B1530` | Text, icons (Ink) |
| `text-secondary` / `--text-secondary` | `#756E8E` | Muted text, placeholders |
| `text-header` / `--text-header` | `#9790AD` | Uppercase labels, column headers |
| `accent` / `--accent` | `#6B3DF5` | Quiz Violet: brand, main buttons, selected state, links |
| `accent-hover` / `accent-edge` / `accent-soft` | `#5A2CE0` / `#4B22C9` / `#F3EFFF` | Hover, button key edge, soft violet fill |
| `highlight` (+ `-soft`, `-strong`) | `#FFC233` | Sunny: stars, rewards, drafts, unsaved |
| `success` (+ `-soft`, `-strong`) | `#14C8A0` | Mint: correct answers, saved, published |
| `danger` (+ `-soft`, `-strong`) | `#FF5A5F` | Coral: wrong answers, errors, deleting |

- For a pill or label, use the `-soft` fill with `-strong` text (e.g. `bg-success-soft text-success-strong`).
- **Never white text on Sunny or Mint**: use ink (`text-text-primary`) or the `-strong` color.
- Use Mint and Coral only for right/wrong, success/error and delete, so they keep their meaning.
- Don't use more than two accent colors in one component.
- Slide content (colors people pick, clipart, the SVG library) is the user's own work and doesn't follow these colors.

## Typography

- **Body/UI:** Lexend (`font-sans`, the default), 14px body, 600 weight for buttons.
- **Headings:** `h1`/`h2` get Bricolage Grotesque automatically (in `globals.css`); use `font-extrabold` on them. Use `font-heading` for other display text (e.g. the logo word).
- **Labels:** 11–12px, bold, uppercase, `tracking-[0.05em]`, `text-text-header`.

## Shape

| Class | Radius | Usage |
|---|---|---|
| `rounded-card` | 24px | Cards, panels, modals |
| `rounded-button` | 14px | Buttons |
| `rounded-input` | 14px | Inputs |
| `rounded-dropdown` | 8px | Small buttons, pills, menus |

- Plain `border` is 1.5px (set by `--default-border-width`).
- Fullscreen slide change: the teacher's pick in the Effects panel, played by the `motion` library (`motion/mini`) in `startSlideEffect` in `PresentationView.tsx`. They play even when the computer asks to reduce motion, since the teacher picked one on purpose ("None" turns them off). The teacher also picks a speed from 1 to 5 (default 3); the seconds for each level are in `SLIDE_EFFECT_SECONDS` (Slide, Zoom) and `SLIDE_FADE_SECONDS` (Fade, faster) in `constants.ts`. A new effect goes in `startSlideEffect` and in `SLIDE_TRANSITIONS`.
- Shadows: almost none. The main-button key edge (`btn-press`) is the one exception.
- Main button: `rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover`.

## Icons

- **Lucide only** (`lucide-react`). Import the `…Icon` name, e.g. `import { XIcon } from "lucide-react"`, and always pass `size`. Keep Lucide's default 2px stroke. Icons take the text color (`currentColor`), usually `text-text-primary`.
- Never draw a UI icon by hand as inline SVG, and don't add another icon package.

## Logo

- `src/components/Logo.tsx` is the one logo: the "Q-Check" mark (a violet square with a white Q whose tail is a sunny check mark) plus "Quiz**Matter**". Always reuse it. `src/app/icon.svg` is the same mark for the browser tab.
- Don't recolor, rotate or outline the mark. The app name is written **QuizMatter**.

## Spacing & Layout

- Card padding: 16–20px horizontal, 12–14px vertical
- Row height: 48–56px
- Gap between sections: 16–20px
- Icon-to-label gap: 8–12px

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
