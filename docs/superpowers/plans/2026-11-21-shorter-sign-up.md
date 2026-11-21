# Shorter Sign Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign up asks only names, email, password twice and the agree box; the other details become optional on the Account page.

**Architecture:** Only app code changes (zod schemas, two forms, the Privacy Policy). The database already accepts the details empty.

**Tech Stack:** Next.js, zod, Supabase Auth, Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-11-21-shorter-sign-up-design.md`

## Global Constraints

- Zod before every save; limits stay in `profileSchema`.
- Design system classes only; Lucide icons only; the one Spinner.
- Privacy Policy change ⇒ bump `LEGAL_VERSION` (`src/lib/legal.ts`) to `2026-11-21` in the same commit.
- Folder notes (`src/app/CLAUDE.md`, `src/lib/CLAUDE.md`) stay true.

## Review Focus

- An empty birthday on the Account page must save as `null`, not `""` (the column is a date) — e2e: save with an empty birthday works.
- Clearing a filled gender / education level back to "Not set" must save `""` — the dropdown's empty option is selectable.
- A filled but bad contact number (e.g. "12") is still refused with today's words.
- A filled birthday under 18 is still refused.
- An older open sign up tab that still sends the old metadata keeps working (`handle_new_user` still reads them) — no change needed, just don't touch the database.

---

### Task 1: Optional details in the schemas

**Files:**
- Modify: `src/lib/userSettings.ts` (`profileSchema`, `signUpSchema`, `SignUpFields`, `signUp`, `saveProfile`)

**Interfaces:**
- Produces: `profileSchema` (same keys; contactNumber / educationLevel / educationField / birthDate / gender accept `""`); `signUpSchema(blockedDomains)` with keys `firstName, lastName, email, password, confirmPassword, agreeTerms`; `SignUpFields` follows.

- [ ] Step 1: `profileSchema`: each of the five accepts `""` (`.or(z.literal(""))` / a refine that passes on `""`), otherwise today's rule and words.
- [ ] Step 2: `signUpSchema`: start from `profileSchema.pick({ firstName: true, lastName: true })`.
- [ ] Step 3: `signUp` sends only `first_name`, `last_name`, `terms_version`.
- [ ] Step 4: `saveProfile` sends `birth_date: profile.birthDate || null`.
- [ ] Step 5: `npx tsc --noEmit` shows errors only in `SignUpForm.tsx` (fixed in Task 2).

### Task 2: The forms, the policy and the notes

**Files:**
- Modify: `src/app/signup/SignUpForm.tsx`, `src/app/account/AccountForms.tsx`, `src/app/(legal)/privacy/page.tsx`, `src/lib/legal.ts`, `src/app/CLAUDE.md`, `src/lib/CLAUDE.md`, `e2e/forgot-password.mjs`, `e2e/CLAUDE.md` if it names the fields

- [ ] Step 1: Sign up form: remove the five fields, their hints and the unused imports; agree text ends at "Privacy Policy."
- [ ] Step 2: Account Personal details: drop `required` on the five; dropdown empty option "Not set" (not disabled); one hint: "Optional. Saving your birthday, gender or educational background means you agree to QuizMatter keeping them as the Privacy Policy says."
- [ ] Step 3: Privacy Policy: contact number, birthday/gender, education are optional, added on the Account page, consent given when saved there; can be cleared there. `LEGAL_VERSION = "2026-11-21"`.
- [ ] Step 4: `e2e/forgot-password.mjs`: stop filling the removed fields.
- [ ] Step 5: Notes updated.
- [ ] Step 6: `npx tsc --noEmit`, `npm run lint`, `npm test` pass; `npm run e2e:dev` + `node e2e/forgot-password.mjs` passes; a quick e2e check of the Account page saving with empty birthday and gender.
- [ ] Step 7: Commit.
