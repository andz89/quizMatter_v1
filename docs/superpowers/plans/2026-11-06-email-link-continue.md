# Email Link Continue Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email links (sign up and reset) are used only when the teacher clicks Continue, a logged-in visitor is told
to log out first, and Set a new password shows whose account it is.

**Architecture:** `src/app/auth/confirm/route.ts` becomes a server page that checks the link with zod and shows a
Continue form (or a "log out first" card); a server action does `verifyOtp` and the redirects. The link rules are
plain functions in `src/lib/emailLinks.ts` (unit-tested). `/set-password` becomes a server page that passes the
email to its client form.

**Tech Stack:** Next.js server pages + server actions (read
`node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md` first), Supabase SSR clients
(`src/lib/supabase/server.ts`, `client.ts`), zod, Playwright e2e on local Docker.

**Spec:** `docs/superpowers/specs/2026-11-06-email-link-continue-design.md`

## Global Constraints

- Work on `dev`, commit per task, **do not push**. Local Docker only for tests (`npx -y supabase@latest start`,
  `npm run e2e:dev`).
- No email template change, no database change, no new package.
- Zod checks the link's two fields on the page **and** again in the server action.
- Design system as in `src/app/forgot-password/page.tsx` (same card, button, Spinner, `TopLoadingBar`,
  `LinkPending` in links).
- Exact words:
  - Heading "One more step"; "Click Continue to set a new password." (`recovery`); "Click Continue to finish making
    your account." (`email`); button "Continue".
  - Logged in: "You're logged in as **{email}**. To use this link, log out first."; button "Log out"; link "Go to
    home".
  - Set a new password: "For **{email}**" under the heading.
- Every change updates its notes in the same commit (`src/app/CLAUDE.md`, `e2e/CLAUDE.md`, `src/lib/CLAUDE.md`).

## Review Focus

1. A scanner (plain GET) opens the link before the teacher → the teacher's Continue still works (Task 2 e2e).
2. The Continue form is sent while logged in (a stale tab after logging in elsewhere) → no account swap, back to the
   "log out first" card (Task 2: the action re-checks the login; e2e posts nothing extra, so it's checked in the
   final review).
3. A link with a `type` we don't send (e.g. `magiclink`, `invite`) or a 500-character hash → `/login?error=confirm`
   (Task 1 unit test + Task 2 e2e).
4. Log out on the "log out first" card → the same link's Continue card, and the link works (Task 2 e2e).
5. `/set-password` for an account with no email in its login claims → the line is left out, the form still works
   (Task 3: render the line only when there's an email).

---

### Task 1: Link rules in `src/lib/emailLinks.ts`

**Files:**
- Create: `src/lib/emailLinks.ts`, `src/lib/emailLinks.test.ts`
- Modify: `src/lib/CLAUDE.md` (one bullet)

**Interfaces:**
- Produces:
  - `EMAIL_LINK_TYPES = ["email", "recovery"] as const`; `type EmailLinkType`
  - `emailLinkSchema = z.object({ token_hash: z.string().min(1).max(200), type: z.enum(EMAIL_LINK_TYPES) })`
  - `emailLinkDestination(type: EmailLinkType, ok: boolean): string` → ok: `recovery` `"/set-password"`, `email`
    `"/"`; not ok: `recovery` `"/login?error=reset"`, `email` `"/login?error=confirm"`
  - `BAD_LINK_DESTINATION = "/login?error=confirm"`

- [ ] **Step 1: Failing tests** (`node:test`, like `src/lib/passwords.test.ts`):
  - `emailLinkSchema.safeParse({ token_hash: "abc", type: "recovery" }).success` → `true`
  - missing `token_hash` → `false`; `token_hash: ""` → `false`; `"x".repeat(201)` → `false`
  - `type: "magiclink"` → `false`
  - `emailLinkDestination("recovery", true)` → `"/set-password"`; `("email", true)` → `"/"`;
    `("recovery", false)` → `"/login?error=reset"`; `("email", false)` → `"/login?error=confirm"`
- [ ] **Step 2:** `npm test` → FAIL (module not found).
- [ ] **Step 3:** Write `emailLinks.ts` (only `zod`).
- [ ] **Step 4:** `npm test` → all PASS.
- [ ] **Step 5: Commit** `git add src/lib/emailLinks.ts src/lib/emailLinks.test.ts src/lib/CLAUDE.md` →
  `git commit -m "Email link rules in their own file"`

### Task 2: `/auth/confirm` page with Continue

**Files:**
- Delete: `src/app/auth/confirm/route.ts`
- Create: `src/app/auth/confirm/page.tsx` (server), `src/app/auth/confirm/actions.ts`,
  `src/app/auth/confirm/ConfirmButtons.tsx` (client)
- Modify: `e2e/forgot-password.mjs` (new checks; old ones that opened the link now click Continue)
- Modify: `src/app/CLAUDE.md` (the `auth/confirm` text in the sign up part), `e2e/CLAUDE.md`, `src/proxy.ts`
  comment (it's now a page)

**Interfaces:**
- Consumes: `emailLinkSchema`, `emailLinkDestination`, `BAD_LINK_DESTINATION`, `EmailLinkType` (Task 1).
- Produces:
  - `openEmailLink(formData: FormData): Promise<void>` in `actions.ts` (`"use server"`)
  - `ContinueButton()` and `LogOutButton()` in `ConfirmButtons.tsx`
  - e2e helper `continueLink(page, url)`: `page.goto(url)`, click "Continue", wait for navigation.

- [ ] **Step 1: Update the e2e test first.**
  - Add `continueLink(page, url)` and use it wherever a reset link was opened (part 1's page link, part 2's link,
    the reused link). The "logged in as someone else" check becomes: the card says "You're logged in as
    {teacher.email}", there is no Continue button.
  - New checks:
    - "a scanner opening the link doesn't use it up": `await fetch(resetLink)` (plain GET, follows redirects) before
      the browser's `continueLink` → still `/set-password`.
    - "the link page shows Continue and the reset words": text "Click Continue to set a new password." visible.
    - "Log out, then the link works": in the logged-in context, click "Log out" → the Continue card shows → click
      Continue → `/set-password` for the resetter. (Use a fresh reset link for this check, so the order of the
      existing checks stays.)
    - "a link with no token_hash goes to login": `APP/auth/confirm?type=recovery` → URL has `error=confirm`.
    - "a link with an unknown type goes to login": `type=magiclink` → `error=confirm`.
    - "a sign up link continues home": `api("/auth/v1/admin/generate_link", { method: "POST", body:
      JSON.stringify({ type: "magiclink", email: <a new teacher's email> }) })` → its `hashed_token` (top level or
      under `properties`) → `continueLink(.../auth/confirm?token_hash=…&type=email)` → `APP/`, and the words "Click
      Continue to finish making your account." were shown first. (`magiclink` because local sign up needs no
      confirmation; Supabase checks both with `type=email`.)
- [ ] **Step 2:** `node e2e/forgot-password.mjs` → the new checks FAIL (no Continue button; the GET uses the link).
- [ ] **Step 3: `page.tsx`.** `searchParams` → `emailLinkSchema.safeParse({ token_hash, type })`; bad →
  `redirect(BAD_LINK_DESTINATION)`. `getClaims()`: logged in → the card with the claims' `email` and
  `<LogOutButton />` + "Go to home" `Link`; else the card with the type's words and
  `<form action={openEmailLink}>` holding two hidden inputs (`token_hash`, `type`) and `<ContinueButton />`. Layout
  like the forgot password page (`main`, `Logo`, `rounded-card`). Doc comment: why it's a button (mail scanners).
- [ ] **Step 4: `actions.ts`.** `openEmailLink(formData)`: parse `{ token_hash, type }` from the form with
  `emailLinkSchema` (bad → `redirect(BAD_LINK_DESTINATION)`); logged in (`getClaims`) → `redirect` back to
  `/auth/confirm?token_hash=…&type=…` (built with `URLSearchParams`); else `verifyOtp({ type, token_hash })` →
  `redirect(emailLinkDestination(type, !error))`.
- [ ] **Step 5: `ConfirmButtons.tsx`.** `ContinueButton`: the main button style, `useFormStatus().pending` →
  disabled, `Spinner` + `TopLoadingBar`, "Continue". `LogOutButton`: plain (secondary) button; on click
  `createClient().auth.signOut()`, `forgetAnnouncements()` (as `src/components/AccountMenu.tsx` does), then
  `router.refresh()`; Spinner while it works.
- [ ] **Step 6:** Delete `route.ts`; update the proxy comment and the notes.
- [ ] **Step 7:** `node e2e/forgot-password.mjs` → all PASS; `npx tsc --noEmit`, `npm run lint` clean.
- [ ] **Step 8: Commit** → `git commit -m "Email links: a Continue button (mail scanners can't use them up)"`

### Task 3: "For {email}" on Set a new password

**Files:**
- Create: `src/app/set-password/SetPasswordForm.tsx` (the current page's client code, moved)
- Modify: `src/app/set-password/page.tsx` (server: reads the email, renders the form)
- Modify: `e2e/forgot-password.mjs`, `src/app/CLAUDE.md` (`set-password/`)

**Interfaces:**
- Produces: `SetPasswordForm({ email }: { email: string | null })`.

- [ ] **Step 1: e2e check** "Set a new password says whose account": after the resetter's Continue →
  `/set-password`, the text `For ${resetter.email}` is visible.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Move the client code to `SetPasswordForm.tsx` (`"use client"` there); `page.tsx` (server) reads
  `getClaims()`'s `email` (string, else `null`) and renders `<SetPasswordForm email={…} />`. The form shows
  `For <span className="font-semibold">{email}</span>` (`text-sm text-text-secondary`) under the heading only when
  `email` is set.
- [ ] **Step 4:** run → all PASS; `npx tsc --noEmit`, `npm run lint`, `npm test` clean.
- [ ] **Step 5: Commit** → `git commit -m "Set a new password shows whose account it is"`

### Task 4: Final check

- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test`, `node e2e/forgot-password.mjs` → all pass.
- [ ] `git diff 855dc70..HEAD` next to the spec: everything done, nothing extra, notes true.
- [ ] Tell the user the three checks they do (rate limit, "Require current password" off, a live reset from an
  Outlook / DepEd inbox on the preview), and that no template change is needed.
