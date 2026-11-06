# Email links: a Continue button (and the forgot password follow-ups)

Follow-up to `2026-11-06-forgot-password-design.md`, from its final review.

## Why

1. **Mail scanners use up our links.** `/auth/confirm` checks the token the moment the link is opened (a GET).
   Outlook's "Safe Links" (common on DepEd's Microsoft email) and other school mail filters open every link before
   the teacher does, so the token is used up and the teacher only ever sees "expired". This hits both the sign up
   email and the reset email.
2. **Logged in, a link does nothing and says nothing.** Today it quietly opens home.
3. **A forwarded reset link opens someone else's account** without the page saying whose.

## What the teacher sees

### `/auth/confirm` (both emails; the email templates and their link stay the same)

- **Logged out, link looks right** (`token_hash` present, `type` is `email` or `recovery`): a card with the logo,
  the heading "One more step", the words "Click Continue to set a new password." (`recovery`) or "Click Continue to
  finish making your account." (`email`), and a **Continue** button (Spinner + top line while it works). Opening the
  page uses nothing up; only the button does.
- **Continue:** checks the link and logs the teacher in, then opens `/set-password` (`recovery`) or home (`email`),
  as today. A used, old or broken token → `/login?error=reset` (`recovery`) or `/login?error=confirm` (`email`),
  as today.
- **Link missing its parts** (no `token_hash`, or a `type` we don't send): straight to `/login?error=confirm`, no
  button.
- **Logged in:** the card says "You're logged in as **a@b.com**. To use this link, log out first.", with a **Log
  out** button and a "Go to home" link. Log out logs out (like the account menu: `signOut()`, then
  `forgetAnnouncements()`) and reloads the same page, which then shows Continue. The link is never used while logged
  in, so it can't swap the browser into another account.

### `/set-password`

- Under the heading: "For **a@b.com**" (the logged-in account's email), so a teacher who opened someone else's link
  sees it isn't theirs.

## How it works

- `src/app/auth/confirm/route.ts` is replaced by a page (a folder can't have both):
  - `src/app/auth/confirm/page.tsx` (server): reads `token_hash` and `type` from the page link, checks them with zod
    (`emailLinkSchema`: `token_hash` a non-empty string, at most 200 characters; `type` `email` | `recovery`); a bad
    one → `redirect("/login?error=confirm")`. Reads the login (`getClaims`): logged in → the "log out first" card
    (email from the claims); else the Continue card with a `<form action={openEmailLink}>` and two hidden inputs.
  - `src/app/auth/confirm/actions.ts` (`"use server"`): `openEmailLink(formData)` — zod-parses the two fields again
    (`emailLinkSchema`; bad → `/login?error=confirm`), re-checks the login (logged in → back to the same
    `/auth/confirm?…`, which shows the "log out first" card), `verifyOtp`, then the same redirects as today.
  - The Continue button and the Log out button are small client parts (`useFormStatus` for the Spinner on Continue;
    Log out uses the browser client) in `src/app/auth/confirm/ConfirmButtons.tsx`.
  - `emailLinkSchema` lives in a new `src/lib/emailLinks.ts` (only zod, so tests load it), with the destinations as
    a plain function `emailLinkDestination(type, ok)` → `"/set-password"` | `"/"` |
    `"/login?error=reset"` | `"/login?error=confirm"`.
- **Proxy:** `/auth/confirm` stays open to all (logged in or out). Its server action is a POST to the same address,
  so it passes too. During maintenance it's closed like every page.
- **`/set-password`:** `page.tsx` becomes a server page that reads the email from the login (`getClaims`) and
  renders the form (moved to `SetPasswordForm.tsx`, client) with it.
- **No database change, no email template change, no new package.**

## Checks the user does (no code)

- Supabase → Authentication → Rate Limits: "emails per hour" (the project's whole email budget, sign up included;
  with Resend it can be raised, e.g. 100).
- Supabase → Authentication → email sign-in settings: "Require current password when updating" **off** (it would
  refuse Set a new password). "Secure password change" can stay on (a reset link is a fresh login).
- After deploying to the dev preview (live Supabase): ask for a reset twice quickly → both "Check your email"; finish
  one reset from a real inbox (ideally a DepEd / Outlook one) → Set a new password works.

## Notes

- `src/app/CLAUDE.md`: the `auth/confirm` text (a page with Continue, why; logged in → log out first), and
  `set-password/` ("For <email>").
- Root `CLAUDE.md` map: nothing new (same folders).
- `e2e/CLAUDE.md`: the test's new checks.

## Testing

- `src/lib/emailLinks.test.ts`: `emailLinkSchema` (good link; missing hash; unknown type; hash over 200) and
  `emailLinkDestination` (all four results).
- `e2e/forgot-password.mjs`:
  - Opening a reset link (logged out) shows Continue and **doesn't use it up**: a plain `fetch` of the link first
    (like a scanner), then the browser opens it, clicks Continue → `/set-password`.
  - `/set-password` shows "For <the teacher's email>".
  - Logged in as someone else: the card names that account; the link isn't used; Log out → the Continue card → it
    works.
  - The used link → Continue → `/login?error=reset` (as today, now after the click).
  - A sign up (`type=email`) link from the API's `generate_link` → Continue → home.
  - A link with no `token_hash` → `/login?error=confirm`.
- `npx tsc --noEmit`, `npm run lint`, `npm test`.

## Not in this change

- The hourly email limit, the live error shapes and the live password setting: checks above, no code.
- No change to the emails themselves.
