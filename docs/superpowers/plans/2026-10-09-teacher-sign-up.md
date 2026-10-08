# Teacher Sign Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let teachers make their own QuizMatter account (with display name, first/last name, contact number,
educational background), confirm their email, and see/change those details later; admins see them in Admin → Teachers.

**Architecture:** The sign up form checks the fields with zod, then calls Supabase `auth.signUp` with the details
as user metadata. A database trigger copies the metadata into `user_settings` when the account is made. The
confirmation email links to a route handler (`/auth/confirm`) that verifies the link and logs the teacher in.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`), Supabase (`@supabase/ssr`, `@supabase/supabase-js`), zod 4,
Tailwind 4 with the QuizMatter design system, lucide-react, sonner. **No new packages.**

**Spec:** `docs/superpowers/specs/2026-10-09-teacher-sign-up-design.md`

## Global Constraints

- All sign up fields are required: display name, first name, last name, contact number, education level, field or major, email, password, confirm password.
- Limits: first/last name 1–35; display name 1–80; field or major 1–100; contact number 7–20 characters, only digits, spaces, `+ - ( )`, at least 7 digits; password 8–72.
- Education levels (saved value → label): `bachelor` → "Bachelor's degree", `master` → "Master's degree", `doctorate` → "Doctorate", `other` → "Other".
- Validate with zod right before every save (`signUp`, `saveProfile`). Limits live in `src/lib/userSettings.ts` only (the database repeats them as checks).
- Use only `src/components/Spinner.tsx` for spinners and `src/components/TopLoadingBar.tsx` / `LinkPending` for the top line.
- Design system classes only (`rounded-card`, `rounded-input`, `bg-accent btn-press`, `text-text-header`, …). Lucide icons with `size`.
- Every save on the Account page shows a sonner toast on success and on failure.
- Plain, simple English in all text shown to teachers.
- No test runner exists in this project and none is added (no new packages). Each task is checked with `npx tsc --noEmit` and `npm run lint`; live testing is left to the user.

## Review Focus

1. **Email already has an account** — Supabase answers "success" with no email sent; the page must show the same "Check your email" screen and never reveal that the account exists. (Task 4: no special case for it.)
2. **Teacher added by hand (no metadata)** — the trigger must still make an empty `user_settings` row and never fail the account. (Task 1: every field is `coalesce(..., '')`.)
3. **Old or reused confirmation link** — must land on `/login` with a clear message, not an error page. (Task 3 + Task 5.)
4. **Second try after a failed sign up** — a Turnstile pass works only once; the check must start over after every error. (Task 4: `setCaptchaRound` on error.)
5. **Existing teacher with empty details opens the Account page** — the "Personal details" card shows empty fields and "Pick one" in the dropdown, and Save stays usable once filled. (Task 6.)

---

## File Structure

| File | Change | What it does |
|---|---|---|
| `supabase/migrations/20261103000000_teacher_sign_up.sql` | Create | New `user_settings` columns + `handle_new_user` trigger |
| `src/lib/userSettings.ts` | Modify | Limits, education levels, `profileSchema`, `signUpSchema`, `signUp`, `saveProfile` |
| `src/lib/account.ts` | Modify | `getAccount()` also returns `profile` |
| `src/proxy.ts` | Modify | Logged-out people may open `/signup` and `/auth/confirm` |
| `src/app/auth/confirm/route.ts` | Create | The email link: verify, log in, go home |
| `src/app/signup/page.tsx` | Create | The sign up form and "Check your email" screen |
| `src/app/login/page.tsx` | Modify | "Create an account" link, not-confirmed and bad-link messages |
| `src/app/account/AccountForms.tsx`, `src/app/account/page.tsx` | Modify | "Personal details" card |
| `src/app/admin/teachers/page.tsx`, `src/app/admin/teachers/AdminTeachers.tsx` | Modify | Details line + "Not confirmed" pill |

---

### Task 1: Database columns and sign up trigger

**Files:**
- Create: `supabase/migrations/20261103000000_teacher_sign_up.sql`

**Interfaces:**
- Produces: `user_settings` columns `first_name`, `last_name`, `contact_number`, `education_level`, `education_field` (all `text not null default ''`). Metadata keys read by the trigger: `display_name`, `first_name`, `last_name`, `contact_number`, `education_level`, `education_field`.

- [ ] **Step 1: Check the names are free**

Run: `grep -rn "handle_new_user\|on_auth_user_created" supabase/migrations`
Expected: no output.

- [ ] **Step 2: Write the migration**

```sql
-- Teacher sign up (docs/superpowers/specs/2026-10-09-teacher-sign-up-design.md): the details a teacher gives when
-- they sign up. Shown on their Account page (they can change them there) and in Admin → Teachers. Empty for
-- teachers added by hand in the Supabase dashboard.
-- The limits are checked with zod first (profileSchema and signUpSchema in src/lib/userSettings.ts).

alter table public.user_settings
  add column first_name text not null default '' check (length(first_name) <= 35),
  add column last_name text not null default '' check (length(last_name) <= 35),
  add column contact_number text not null default '' check (length(contact_number) <= 20),
  add column education_level text not null default ''
    check (education_level in ('', 'bachelor', 'master', 'doctorate', 'other')),
  add column education_field text not null default '' check (length(education_field) <= 100);

-- The sign up page sends the details along with the new account (Supabase keeps them as user metadata). This copies
-- them into the new teacher's settings row the moment the account is made, before they confirm their email (they
-- can't write the row themselves yet: they aren't logged in). A teacher added by hand has no metadata, so their row
-- is empty. Bad values (e.g. sent straight to the Supabase API) break the checks above, and the sign up fails.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_settings
    (user_id, display_name, first_name, last_name, contact_number, education_level, education_field)
  values (
    new.id,
    trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')),
    trim(coalesce(new.raw_user_meta_data ->> 'first_name', '')),
    trim(coalesce(new.raw_user_meta_data ->> 'last_name', '')),
    trim(coalesce(new.raw_user_meta_data ->> 'contact_number', '')),
    coalesce(new.raw_user_meta_data ->> 'education_level', ''),
    trim(coalesce(new.raw_user_meta_data ->> 'education_field', ''))
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261103000000_teacher_sign_up.sql
git commit -m "Add sign up details to user settings"
```

---

### Task 2: Zod schemas, `signUp`, `saveProfile`, and `getAccount().profile`

**Files:**
- Modify: `src/lib/userSettings.ts`
- Modify: `src/lib/account.ts`

**Interfaces:**
- Consumes: Task 1's columns.
- Produces (all exported from `src/lib/userSettings.ts`):
  - `NAME_MAX_LENGTH = 35`, `CONTACT_NUMBER_MAX_LENGTH = 20`, `EDUCATION_FIELD_MAX_LENGTH = 100`, `PASSWORD_MAX_LENGTH = 72` (plus existing `DISPLAY_NAME_MAX_LENGTH`, `PASSWORD_MIN_LENGTH`)
  - `EDUCATION_LEVELS: readonly ["bachelor", "master", "doctorate", "other"]`, `type EducationLevel`, `EDUCATION_LEVEL_LABELS: Record<EducationLevel, string>`
  - `profileSchema`, `signUpSchema`
  - `type ProfileFields = { firstName: string; lastName: string; contactNumber: string; educationLevel: string; educationField: string }`
  - `type SignUpFields = ProfileFields & { displayName: string; email: string; password: string; confirmPassword: string }`
  - `signUp(fields: SignUpFields, captchaToken: string): Promise<void>` (throws Supabase `AuthError` or `ZodError`)
  - `saveProfile(fields: ProfileFields): Promise<void>` (throws)
  - `Account.profile: ProfileFields` in `src/lib/account.ts`

- [ ] **Step 1: Add messages to `passwordSchema` and a max constant**

In `src/lib/userSettings.ts` replace:

```ts
export const PASSWORD_MIN_LENGTH = 8;
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(72);
```

with:

```ts
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters for your password.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters for your password.`);
```

- [ ] **Step 2: Add the profile and sign up schemas**

In `src/lib/userSettings.ts`, after `passwordSchema`, add:

```ts
// The details a teacher gives when they sign up (and can change on the Account page).
export const NAME_MAX_LENGTH = 35;
export const CONTACT_NUMBER_MAX_LENGTH = 20;
export const EDUCATION_FIELD_MAX_LENGTH = 100;

// The Educational background dropdown. The values are saved in user_settings.education_level.
export const EDUCATION_LEVELS = ["bachelor", "master", "doctorate", "other"] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];
export const EDUCATION_LEVEL_LABELS: Record<EducationLevel, string> = {
  bachelor: "Bachelor's degree",
  master: "Master's degree",
  doctorate: "Doctorate",
  other: "Other",
};

export const profileSchema = z.object({
  firstName: z.string().trim().min(1, "Enter your first name.").max(NAME_MAX_LENGTH, `Use at most ${NAME_MAX_LENGTH} characters for your first name.`),
  lastName: z.string().trim().min(1, "Enter your last name.").max(NAME_MAX_LENGTH, `Use at most ${NAME_MAX_LENGTH} characters for your last name.`),
  // e.g. "+63 917 123 4567" or "(02) 8123-4567".
  contactNumber: z
    .string()
    .trim()
    .max(CONTACT_NUMBER_MAX_LENGTH, `Use at most ${CONTACT_NUMBER_MAX_LENGTH} characters for your contact number.`)
    .regex(/^[0-9+\-() ]*$/, "A contact number can only have digits, spaces and + - ( ).")
    .refine((number) => number.replace(/\D/g, "").length >= 7, "Enter a contact number with at least 7 digits."),
  educationLevel: z.enum(EDUCATION_LEVELS, { error: "Pick your educational background." }),
  educationField: z
    .string()
    .trim()
    .min(1, "Enter your field or major.")
    .max(EDUCATION_FIELD_MAX_LENGTH, `Use at most ${EDUCATION_FIELD_MAX_LENGTH} characters for your field or major.`),
});

export const signUpSchema = profileSchema
  .extend({
    displayName: displayNameSchema.min(1, "Enter a display name."),
    email: z.email("Enter a real email address."),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((fields) => fields.password === fields.confirmPassword, {
    error: "The two passwords don't match.",
    path: ["confirmPassword"],
  });

// What the forms hold: plain text in every box ("" in the dropdown until a level is picked).
export type ProfileFields = { [K in keyof z.input<typeof profileSchema>]: string };
export type SignUpFields = { [K in keyof z.input<typeof signUpSchema>]: string };
```

- [ ] **Step 3: Add `signUp` and `saveProfile`**

At the end of `src/lib/userSettings.ts` add:

```ts
/**
 * Makes a new account. Supabase emails a link to confirm it; the teacher can log in only after clicking it. The
 * details ride along as user metadata, and the handle_new_user trigger (20261103000000_teacher_sign_up.sql) copies
 * them into user_settings. If the email already has an account, Supabase answers the same way and sends nothing,
 * so strangers can't find out who has one. Throws if it fails.
 */
export async function signUp(fields: SignUpFields, captchaToken: string) {
  // Checked with zod first (see CLAUDE.md, "Saving Data"): bad data throws here and is never saved.
  const { email, password, displayName, firstName, lastName, contactNumber, educationLevel, educationField } =
    signUpSchema.parse(fields);
  const { error } = await createClient().auth.signUp({
    email,
    password,
    options: {
      captchaToken,
      data: {
        display_name: displayName,
        first_name: firstName,
        last_name: lastName,
        contact_number: contactNumber,
        education_level: educationLevel,
        education_field: educationField,
      },
    },
  });
  if (error) throw error;
}

/** Saves the user's personal details (creates the settings row the first time). Throws if it fails. */
export async function saveProfile(fields: ProfileFields) {
  const profile = profileSchema.parse(fields);
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Not signed in");
  const { error } = await supabase.from("user_settings").upsert({
    user_id: data.session.user.id,
    first_name: profile.firstName,
    last_name: profile.lastName,
    contact_number: profile.contactNumber,
    education_level: profile.educationLevel,
    education_field: profile.educationField,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
```

- [ ] **Step 4: Return the details from `getAccount()`**

In `src/lib/account.ts`:

Add the import at the top:

```ts
import type { ProfileFields } from "./userSettings";
```

Add to the `Account` type after `displayName: string;`:

```ts
  // First and last name, contact number and educational background ("" for each one not set).
  profile: ProfileFields;
```

Change the settings query:

```ts
    supabase
      .from("user_settings")
      .select("display_name, first_name, last_name, contact_number, education_level, education_field")
      .maybeSingle(),
```

And after `displayName: settings?.display_name ?? "",` add:

```ts
    profile: {
      firstName: settings?.first_name ?? "",
      lastName: settings?.last_name ?? "",
      contactNumber: settings?.contact_number ?? "",
      educationLevel: settings?.education_level ?? "",
      educationField: settings?.education_field ?? "",
    },
```

Also update the doc comment's first line to: "The logged-in user: id ("" if logged out), email, display name and personal details ("" if not set), …".

- [ ] **Step 5: Type check and lint**

Run: `npx tsc --noEmit` then `npm run lint`
Expected: no errors in `src/lib/userSettings.ts` or `src/lib/account.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/userSettings.ts src/lib/account.ts
git commit -m "Add sign up and personal details schemas"
```

---

### Task 3: Proxy and the email link route

**Files:**
- Modify: `src/proxy.ts`
- Create: `src/app/auth/confirm/route.ts`

**Interfaces:**
- Produces: `GET /auth/confirm?token_hash=…&type=email` → redirects to `/` (logged in) or `/login?error=confirm`. Task 5 reads `error=confirm`.

- [ ] **Step 1: Let logged-out people open the sign up pages**

In `src/proxy.ts` replace:

```ts
  const isLoginPage = request.nextUrl.pathname === "/login";

  if (!isLoggedIn && !isLoginPage) {
```

with:

```ts
  const path = request.nextUrl.pathname;
  const isLoginPage = path === "/login" || path === "/signup";
  // The link in the "Confirm signup" email: it logs the teacher in, so it must open while logged out.
  const isOpenToAll = isLoginPage || path === "/auth/confirm";

  if (!isLoggedIn && !isOpenToAll) {
```

Update the doc comment: "sends logged-out users to /login (except the sign up pages), and logged-in users away from login and sign up."

- [ ] **Step 2: Write the route**

`src/app/auth/confirm/route.ts`:

```ts
import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * The link in the "Confirm signup" email opens this (Supabase dashboard → Authentication → Emails:
 * {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email). It confirms the email, logs the teacher in
 * (the login cookies are set here) and opens the home page. An old, used or broken link goes to login with a message.
 */
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) redirect("/");
  }
  redirect("/login?error=confirm");
}
```

- [ ] **Step 3: Type check and lint**

Run: `npx tsc --noEmit` then `npm run lint`
Expected: no errors in the two files.

- [ ] **Step 4: Commit**

```bash
git add src/proxy.ts src/app/auth/confirm/route.ts
git commit -m "Add the email confirmation link route"
```

---

### Task 4: The sign up page

**Files:**
- Create: `src/app/signup/page.tsx`

**Interfaces:**
- Consumes: from `@/lib/userSettings`: `signUp`, `signUpSchema`, `SignUpFields`, `EDUCATION_LEVELS`, `EDUCATION_LEVEL_LABELS`, `NAME_MAX_LENGTH`, `DISPLAY_NAME_MAX_LENGTH`, `CONTACT_NUMBER_MAX_LENGTH`, `EDUCATION_FIELD_MAX_LENGTH`, `PASSWORD_MAX_LENGTH`. Existing `Turnstile`, `Logo`, `Spinner`, `TopLoadingBar`, `LinkPending`.

- [ ] **Step 1: Write the page**

`src/app/signup/page.tsx`:

```tsx
"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { isAuthError, isAuthRetryableFetchError } from "@supabase/supabase-js";
import { MailCheckIcon } from "lucide-react";
import { LinkPending } from "@/components/LinkPending";
import { Logo } from "@/components/Logo";
import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";
import { Turnstile, type TurnstileStatus } from "@/components/Turnstile";
import {
  CONTACT_NUMBER_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  EDUCATION_FIELD_MAX_LENGTH,
  EDUCATION_LEVEL_LABELS,
  EDUCATION_LEVELS,
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  signUp,
  signUpSchema,
  type SignUpFields,
} from "@/lib/userSettings";

const emptyFields: SignUpFields = {
  displayName: "",
  firstName: "",
  lastName: "",
  contactNumber: "",
  educationLevel: "",
  educationField: "",
  email: "",
  password: "",
  confirmPassword: "",
};

/** Sign up: a teacher makes their own account, then confirms it with the link Supabase emails them. */
export default function SignUpPage() {
  const [fields, setFields] = useState(emptyFields);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  // The address the link was sent to, once the account is made: shows "Check your email".
  const [sentTo, setSentTo] = useState<string | null>(null);
  // The "are you human?" pass, and a number that shows a fresh check when it goes up (a pass works only once).
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaRound, setCaptchaRound] = useState(0);
  const [captchaStatus, setCaptchaStatus] = useState<TurnstileStatus>("checking");

  // Back button: the browser may show its saved copy of this page with a used pass. Start over with a fresh check.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      setIsSending(false);
      setCaptchaToken(null);
      setCaptchaRound((round) => round + 1);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const update = (name: keyof SignUpFields) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFields((old) => ({ ...old, [name]: e.target.value }));

  const createAccount = async (e: FormEvent) => {
    e.preventDefault();
    if (!captchaToken) return;
    const checked = signUpSchema.safeParse(fields);
    if (!checked.success) return setError(checked.error.issues[0].message);
    setIsSending(true);
    setError(null);
    try {
      await signUp(fields, captchaToken);
      setSentTo(checked.data.email);
    } catch (err) {
      setError(signUpErrorMessage(err));
      setCaptchaToken(null);
      setCaptchaRound((round) => round + 1);
    }
    setIsSending(false);
  };

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
      <Logo size={44} />

      {sentTo ? (
        <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-card border border-border-default bg-bg-surface px-5 py-8 text-center">
          <MailCheckIcon size={36} className="text-accent" />
          <h1 className="text-lg font-extrabold text-text-primary">Check your email</h1>
          <p className="text-sm text-text-primary">
            We sent a link to <span className="font-semibold">{sentTo}</span>. Click it to finish making your account.
          </p>
          <p className="text-xs text-text-secondary">No email after a few minutes? Check your spam folder.</p>
          <Link href="/login" className="mt-2 text-sm font-semibold text-accent hover:underline">
            Back to log in
            <LinkPending />
          </Link>
        </div>
      ) : (
        <form
          onSubmit={createAccount}
          className="flex w-full max-w-md flex-col gap-4 rounded-card border border-border-default bg-bg-surface px-5 py-6"
        >
          <h1 className="text-base font-extrabold text-text-primary">Create an account</h1>

          <Field id="displayName" label="Display name" hint="Shown in your account menu, and as the Author of your presentations.">
            <input id="displayName" type="text" required maxLength={DISPLAY_NAME_MAX_LENGTH} autoComplete="nickname" placeholder="e.g. Ms. Cruz" value={fields.displayName} onChange={update("displayName")} className={inputClass} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="firstName" label="First name">
              <input id="firstName" type="text" required maxLength={NAME_MAX_LENGTH} autoComplete="given-name" value={fields.firstName} onChange={update("firstName")} className={inputClass} />
            </Field>
            <Field id="lastName" label="Last name">
              <input id="lastName" type="text" required maxLength={NAME_MAX_LENGTH} autoComplete="family-name" value={fields.lastName} onChange={update("lastName")} className={inputClass} />
            </Field>
          </div>

          <Field id="contactNumber" label="Contact number">
            <input id="contactNumber" type="tel" required maxLength={CONTACT_NUMBER_MAX_LENGTH} autoComplete="tel" placeholder="e.g. +63 917 123 4567" value={fields.contactNumber} onChange={update("contactNumber")} className={inputClass} />
          </Field>

          <Field id="educationLevel" label="Educational background">
            <select id="educationLevel" required value={fields.educationLevel} onChange={update("educationLevel")} className={inputClass}>
              <option value="" disabled>
                Pick one
              </option>
              {EDUCATION_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {EDUCATION_LEVEL_LABELS[level]}
                </option>
              ))}
            </select>
          </Field>

          <Field id="educationField" label="Field or major">
            <input id="educationField" type="text" required maxLength={EDUCATION_FIELD_MAX_LENGTH} placeholder="e.g. Secondary Education, major in English" value={fields.educationField} onChange={update("educationField")} className={inputClass} />
          </Field>

          <Field id="email" label="Email">
            <input id="email" type="email" required autoComplete="email" value={fields.email} onChange={update("email")} className={inputClass} />
          </Field>

          <Field id="password" label="Password" hint="At least 8 characters.">
            <input id="password" type="password" required maxLength={PASSWORD_MAX_LENGTH} autoComplete="new-password" value={fields.password} onChange={update("password")} className={inputClass} />
          </Field>

          <Field id="confirmPassword" label="Confirm password">
            <input id="confirmPassword" type="password" required maxLength={PASSWORD_MAX_LENGTH} autoComplete="new-password" value={fields.confirmPassword} onChange={update("confirmPassword")} className={inputClass} />
          </Field>

          <Turnstile key={captchaRound} onToken={setCaptchaToken} onStatus={setCaptchaStatus} />

          {error && <p className="text-sm text-danger-strong">{error}</p>}

          <button
            type="submit"
            disabled={isSending || !captchaToken}
            className="flex w-full items-center justify-center gap-2 rounded-button bg-accent btn-press px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {(isSending || (!captchaToken && captchaStatus === "checking")) && <Spinner size={14} />}
            {isSending
              ? "Creating your account…"
              : captchaToken
                ? "Create account"
                : captchaStatus === "needs-click"
                  ? "Tick the box above to continue"
                  : captchaStatus === "failed"
                    ? "Security check failed"
                    : "Checking you're human…"}
          </button>

          <p className="text-center text-sm text-text-secondary">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-accent hover:underline">
              Log in
              <LinkPending />
            </Link>
          </p>
        </form>
      )}
      {isSending && <TopLoadingBar />}
    </main>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-text-secondary">{hint}</p>}
    </div>
  );
}

// Plain-English words for what went wrong.
function signUpErrorMessage(error: unknown) {
  if (!isAuthError(error)) return "Something went wrong. Please try again.";
  if (error.code === "weak_password") return "Please pick a stronger password.";
  if (error.code === "signup_disabled") return "Sign up is closed right now. Please try again later.";
  if (error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit")
    return "Too many tries. Please wait a few minutes and try again.";
  if (error.code === "captcha_failed" || /captcha/i.test(error.message)) return "The security check expired. Please try again.";
  if (isAuthRetryableFetchError(error)) return "Couldn't reach the server. Check your internet and try again.";
  return "Something went wrong. Please try again.";
}

const inputClass =
  "w-full rounded-input border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary";
```

Formatting: let the editor/Prettier wrap the long `<input …>` lines the same way the login page does (one prop per line) if lint asks; behavior is unchanged.

- [ ] **Step 2: Type check and lint**

Run: `npx tsc --noEmit` then `npm run lint`
Expected: no errors in `src/app/signup/page.tsx`. If `isAuthError` is not exported from `@supabase/supabase-js`, import it from the same place `isAuthRetryableFetchError` comes from (check `node_modules/@supabase/supabase-js/dist/module/index.d.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/app/signup/page.tsx
git commit -m "Add the sign up page"
```

---

### Task 5: Login page — link to sign up and new messages

**Files:**
- Modify: `src/app/login/page.tsx`

**Interfaces:**
- Consumes: `/login?error=confirm` from Task 3; `/signup` from Task 4.

- [ ] **Step 1: Read the `error` search param**

Replace:

```tsx
import { useEffect, useState } from "react";
```

with:

```tsx
import { use, useEffect, useState } from "react";
import Link from "next/link";
```

and add `import { LinkPending } from "@/components/LinkPending";` with the other component imports.

Replace:

```tsx
// No sign up: users are added by hand in the Supabase dashboard (Authentication → Users).
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
```

with:

```tsx
// Teachers sign up on /signup; admins can still add them by hand in the Supabase dashboard (Authentication → Users).
export default function LoginPage({ searchParams }: PageProps<"/login">) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // ?error=confirm: /auth/confirm got an old, used or broken email link.
  const linkError = use(searchParams).error;
  const [error, setError] = useState<string | null>(
    linkError === "confirm" ? "This link has expired or was already used. Try logging in, or sign up again." : null,
  );
```

- [ ] **Step 2: Add the sign up link under the button**

After the closing `</button>` of the Log in button (still inside the `<form>`), add:

```tsx
          <p className="mt-4 text-center text-sm text-text-secondary">
            New to QuizMatter?{" "}
            <Link href="/signup" className="font-semibold text-accent hover:underline">
              Create an account
              <LinkPending />
            </Link>
          </p>
```

- [ ] **Step 3: Not-confirmed message**

In `loginErrorMessage`, after the `invalid_credentials` line, add:

```ts
  if (error.code === "email_not_confirmed") return "Please confirm your email first. Check your inbox for the link.";
```

- [ ] **Step 4: Type check and lint**

Run: `npx tsc --noEmit` then `npm run lint`
Expected: no errors in `src/app/login/page.tsx`. (`PageProps<"/login">` is generated by Next; it's already used in `src/app/admin/page.tsx`.)

- [ ] **Step 5: Commit**

```bash
git add src/app/login/page.tsx
git commit -m "Link login to sign up and explain unconfirmed emails"
```

---

### Task 6: Account page — "Personal details" card

**Files:**
- Modify: `src/app/account/AccountForms.tsx`
- Modify: `src/app/account/page.tsx`

**Interfaces:**
- Consumes: `saveProfile`, `profileSchema`, `ProfileFields`, `EDUCATION_LEVELS`, `EDUCATION_LEVEL_LABELS`, `NAME_MAX_LENGTH`, `CONTACT_NUMBER_MAX_LENGTH`, `EDUCATION_FIELD_MAX_LENGTH` (Task 2); `account.profile` (Task 2).
- Produces: `PersonalDetailsForm({ profile }: { profile: ProfileFields })`.

- [ ] **Step 1: Add the form**

In `src/app/account/AccountForms.tsx` change the `@/lib/userSettings` import to:

```tsx
import {
  changePassword,
  CONTACT_NUMBER_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  EDUCATION_FIELD_MAX_LENGTH,
  EDUCATION_LEVEL_LABELS,
  EDUCATION_LEVELS,
  NAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  profileSchema,
  saveDisplayName,
  saveProfile,
  type ProfileFields,
} from "@/lib/userSettings";
```

and change the react import to `import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";`.

After `ProfileForm`, add:

```tsx
/** First and last name, contact number and educational background (given at sign up). */
export function PersonalDetailsForm({ profile }: { profile: ProfileFields }) {
  const router = useRouter();
  const [fields, setFields] = useState(profile);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const isChanged = (Object.keys(profile) as (keyof ProfileFields)[]).some((key) => fields[key].trim() !== profile[key]);

  const update = (name: keyof ProfileFields) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFields((old) => ({ ...old, [name]: e.target.value }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const checked = profileSchema.safeParse(fields);
    if (!checked.success) return setError(checked.error.issues[0].message);
    setError("");
    setIsSaving(true);
    try {
      await saveProfile(fields);
      toast.success("Details saved.");
      router.refresh();
    } catch {
      toast.error("Couldn't save your details. Please try again.");
    }
    setIsSaving(false);
  };

  return (
    <Card title="Personal details" onSubmit={save}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="firstName" className={labelClass}>First name</label>
          <input id="firstName" type="text" required maxLength={NAME_MAX_LENGTH} autoComplete="given-name" value={fields.firstName} onChange={update("firstName")} className={inputClass} />
        </div>
        <div>
          <label htmlFor="lastName" className={labelClass}>Last name</label>
          <input id="lastName" type="text" required maxLength={NAME_MAX_LENGTH} autoComplete="family-name" value={fields.lastName} onChange={update("lastName")} className={inputClass} />
        </div>
      </div>
      <div>
        <label htmlFor="contactNumber" className={labelClass}>Contact number</label>
        <input id="contactNumber" type="tel" required maxLength={CONTACT_NUMBER_MAX_LENGTH} autoComplete="tel" placeholder="e.g. +63 917 123 4567" value={fields.contactNumber} onChange={update("contactNumber")} className={inputClass} />
      </div>
      <div>
        <label htmlFor="educationLevel" className={labelClass}>Educational background</label>
        <select id="educationLevel" required value={fields.educationLevel} onChange={update("educationLevel")} className={inputClass}>
          <option value="" disabled>
            Pick one
          </option>
          {EDUCATION_LEVELS.map((level) => (
            <option key={level} value={level}>
              {EDUCATION_LEVEL_LABELS[level]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="educationField" className={labelClass}>Field or major</label>
        <input id="educationField" type="text" required maxLength={EDUCATION_FIELD_MAX_LENGTH} placeholder="e.g. Secondary Education, major in English" value={fields.educationField} onChange={update("educationField")} className={inputClass} />
      </div>
      {error && <p className="text-sm text-danger-strong">{error}</p>}
      <button type="submit" disabled={isSaving || !isChanged} className={buttonClass}>
        {isSaving && <Spinner size={14} />}
        Save details
      </button>
    </Card>
  );
}
```

- [ ] **Step 2: Show it on the page**

In `src/app/account/page.tsx`:
- Import: `import { PasswordForm, PersonalDetailsForm, ProfileForm } from "./AccountForms";`
- Doc comment: `/** Account settings: display name, personal details and password. */`
- Subtitle: `Your name, details and password.`
- Between `<ProfileForm … />` and `<PasswordForm />` add: `<PersonalDetailsForm profile={account.profile} />`

- [ ] **Step 3: Type check and lint**

Run: `npx tsc --noEmit` then `npm run lint`
Expected: no errors in the two files.

- [ ] **Step 4: Commit**

```bash
git add src/app/account/AccountForms.tsx src/app/account/page.tsx
git commit -m "Add personal details to the Account page"
```

---

### Task 7: Admin → Teachers — details line and "Not confirmed" pill

**Files:**
- Modify: `src/app/admin/teachers/page.tsx`
- Modify: `src/app/admin/teachers/AdminTeachers.tsx`

**Interfaces:**
- Consumes: Task 1 columns; `EDUCATION_LEVEL_LABELS`, `EDUCATION_LEVELS`, `type EducationLevel` (Task 2).
- Produces: `TeacherRow.details: string`, `TeacherRow.isConfirmed: boolean`.

- [ ] **Step 1: Load the details**

In `src/app/admin/teachers/page.tsx`:

Add import: `import { EDUCATION_LEVEL_LABELS, EDUCATION_LEVELS, type EducationLevel } from "@/lib/userSettings";`

Replace the comment `// Teachers are added by hand, so one page of 1,000 is plenty.` with
`// One page of 1,000 is plenty for now (teachers who sign up count too).`

Change the settings query to:

```ts
    admin
      .from("user_settings")
      .select("user_id, display_name, first_name, last_name, contact_number, education_level, education_field"),
```

Replace `settings.data as { user_id: string; display_name: string | null }[],` with `settings.data as Settings[],`.

Add after the `Ban` type:

```ts
type Settings = {
  user_id: string;
  display_name: string;
  first_name: string;
  last_name: string;
  contact_number: string;
  education_level: string;
  education_field: string;
};

/** "Ana Cruz · +63 917 123 4567 · Master's degree in English" ("" when the teacher gave no details). */
function detailsLine(row: Settings) {
  const level = EDUCATION_LEVELS.includes(row.education_level as EducationLevel)
    ? EDUCATION_LEVEL_LABELS[row.education_level as EducationLevel]
    : "";
  // "Other" alone says nothing, so show just the field.
  const education =
    level && row.education_field && row.education_level !== "other" ? `${level} in ${row.education_field}` : row.education_field || level;
  return joinParts([`${row.first_name} ${row.last_name}`.trim(), row.contact_number, education]);
}
```

In `buildRows`: change the `settings` parameter type to `Settings[]`, and replace
`const names = new Map(settings.map((row) => [row.user_id, row.display_name ?? ""]));` with
`const settingsByUser = new Map(settings.map((row) => [row.user_id, row]));`.

In the `.map` callback, next to `const ban = banByUser.get(user.id);`, add
`const settingsRow = settingsByUser.get(user.id);`, and in the returned object replace `name: names.get(user.id) ?? "",` with:

```ts
        name: settingsRow?.display_name ?? "",
        details: settingsRow ? detailsLine(settingsRow) : "",
        // Signed up but hasn't clicked the link in the email yet.
        isConfirmed: Boolean(user.email_confirmed_at),
```

- [ ] **Step 2: Show them**

In `src/app/admin/teachers/AdminTeachers.tsx`, add to `TeacherRow` after `name: string;`:

```ts
  // "Ana Cruz · +63 917 123 4567 · Master's degree in English" ("" if none given).
  details: string;
  // False until they click the link in the sign up email.
  isConfirmed: boolean;
```

After the `{row.name && …}` span, add:

```tsx
            {!row.isConfirmed && <span className={`${pillClass} bg-highlight-soft text-highlight-strong`}>Not confirmed</span>}
```

Before `<p className="mt-0.5 text-[13px] text-text-secondary">{row.meta}</p>`, add:

```tsx
          {row.details && <p className="mt-0.5 text-[13px] text-text-primary">{row.details}</p>}
```

- [ ] **Step 3: Type check and lint**

Run: `npx tsc --noEmit` then `npm run lint`
Expected: no errors in the two files.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/teachers/page.tsx src/app/admin/teachers/AdminTeachers.tsx
git commit -m "Show teachers' details and unconfirmed emails in Admin → Teachers"
```

---

### Task 8: Final check

- [ ] **Step 1:** Run `npx tsc --noEmit` and `npm run lint` on the whole project. Fix errors in files this plan changed.
- [ ] **Step 2:** `git diff e93b37a..HEAD -- src supabase` and read it next to the spec: every spec item done, nothing extra, zod before both saves, only the one Spinner / TopLoadingBar, design system classes only, toasts on Account saves.
- [ ] **Step 3:** Tell the user what passed or failed, and list the five Supabase dashboard steps from the spec (sign ups + confirm email on, email template link, URL configuration, own SMTP sender, run the migration). Leave live testing to the user.
