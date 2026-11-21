# Shorter sign up (2026-11-21)

## Why

Sign up asked for 11 things (names, contact number, birthday, gender, educational background, field or major,
email, password twice, the agree box). Teachers found it annoying. The owner says the extra details are optional
only, so they don't belong at sign up.

## Goals

- Sign up asks only: first name, last name, email, password, confirm password, the agree box (+ Turnstile).
- Contact number, birthday, gender, educational background and field or major move to the Account page
  (Personal details) and are **optional** there: a teacher can leave them empty or clear them.

## Non-goals

- No "finish your profile" reminder after sign up (they're optional).
- The details themselves need no database change: `user_settings` already takes them empty (`''` / null birthday),
  `handle_new_user` already saves missing ones empty, and `check_birth_date` skips a null birthday.

## Added after the code review

- **Age:** sign up asks no birthday now, so the agree box carries the Terms' 18+ rule: "I'm 18 or older and I agree
  to the Terms of Use and Privacy Policy." (`AGREE_TERMS_MESSAGE` says the same).
- **Consent record** (`20261231002500_details_consent.sql`): the birthday, gender and educational background are
  sensitive, and their consent used to ride on the sign up agree box. Now `saveProfile` sends
  `details_consent_version` (`LEGAL_VERSION`) and the `stamp_details_consent` trigger keeps it with the database's
  time when those details change (a teacher can't rewrite it), and clears both when they're all empty. The Privacy
  Policy's "Your agreement" says so.
- **Half-typed birthday:** a date box with only part of a date reads as empty; the Account page refuses it
  (`validity.badInput`) instead of saving the birthday as removed.

## Approaches

1. **Drop them from sign up, optional on the Account page** (picked). Smallest change; matches "optional only".
2. Two-step sign up (account first, details on a second screen). Same number of fields, only split: still annoying.
3. A "finish your profile" box after the first login. Nags for details the owner calls optional.

## Design

- `src/lib/userSettings.ts`:
  - `profileSchema`: contact number, education level, field, birthday and gender may be empty (`""`); when filled
    they keep today's rules (7+ digits, 18–100 years old, the lists).
  - `signUpSchema` is built from the names only (first + last name), plus email, passwords, agree box.
  - `signUp` sends only names + `terms_version` as metadata.
  - `saveProfile` sends `birth_date: null` for an empty birthday (the column is a date).
- `SignUpForm.tsx`: remove the five fields and their hints; the agree box text drops the "birthday and gender /
  educational background" part.
- `AccountForms.tsx` (Personal details): those five fields lose `required`; the dropdowns get a selectable empty
  choice ("Not set") so they can be cleared; a short hint says they're optional and that saving the birthday, gender
  or educational background means agreeing to QuizMatter keeping them as the Privacy Policy says (the consent that
  used to happen at sign up).
- Privacy Policy: they're optional, given on the Account page, consent there; `LEGAL_VERSION` bumped.
- Notes: `src/app/CLAUDE.md` (signup, account), `src/lib/CLAUDE.md` if needed. `e2e/forgot-password.mjs` stops
  filling the removed fields.

## Left to the builder

Exact wording of hints and the policy lines (plain English, short).
