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
import { lockedUntil, recordTry, SIGN_UP_ADDRESS_MESSAGE, SIGN_UP_LIMIT, tryAgainAfter } from "@/lib/browserLimits";
import {
  CONTACT_NUMBER_MAX_LENGTH,
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
    // Too many accounts made on this browser lately (src/lib/browserLimits.ts). Checked before sending, so the
    // "are you human?" pass isn't used up.
    const until = lockedUntil(SIGN_UP_LIMIT);
    if (until) return setError(`You've made several accounts on this browser. Please try again after ${tryAgainAfter(until)}.`);
    const checked = signUpSchema.safeParse(fields);
    if (!checked.success) return setError(checked.error.issues[0].message);
    setIsSending(true);
    setError(null);
    try {
      await signUp(fields, captchaToken);
      recordTry(SIGN_UP_LIMIT);
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
          className="flex w-full max-w-2xl flex-col gap-4 rounded-card border border-border-default bg-bg-surface px-5 py-6"
        >
          <h1 className="text-base font-extrabold text-text-primary">Create an account</h1>

          {/* Phones: one column. Wider screens: two, with Email across both. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="firstName" label="First name">
              <input
                id="firstName"
                type="text"
                required
                maxLength={NAME_MAX_LENGTH}
                autoComplete="given-name"
                value={fields.firstName}
                onChange={update("firstName")}
                className={inputClass}
              />
            </Field>
            <Field id="lastName" label="Last name">
              <input
                id="lastName"
                type="text"
                required
                maxLength={NAME_MAX_LENGTH}
                autoComplete="family-name"
                value={fields.lastName}
                onChange={update("lastName")}
                className={inputClass}
              />
            </Field>
            <p className="-mt-2 text-xs text-text-secondary sm:col-span-2">
              This is your display name. You can change it once later on the Account page.
            </p>
            <Field id="contactNumber" label="Contact number">
              <input
                id="contactNumber"
                type="tel"
                required
                maxLength={CONTACT_NUMBER_MAX_LENGTH}
                autoComplete="tel"
                placeholder="e.g. +63 917 123 4567"
                value={fields.contactNumber}
                onChange={update("contactNumber")}
                className={inputClass}
              />
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
              <input
                id="educationField"
                type="text"
                required
                maxLength={EDUCATION_FIELD_MAX_LENGTH}
                placeholder="e.g. Secondary Education, major in English"
                value={fields.educationField}
                onChange={update("educationField")}
                className={inputClass}
              />
            </Field>
            <Field id="email" label="Email" className="sm:col-span-2">
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={fields.email}
                onChange={update("email")}
                className={inputClass}
              />
            </Field>
            <Field id="password" label="Password" hint="At least 8 characters.">
              <input
                id="password"
                type="password"
                required
                maxLength={PASSWORD_MAX_LENGTH}
                autoComplete="new-password"
                value={fields.password}
                onChange={update("password")}
                className={inputClass}
              />
            </Field>
            <Field id="confirmPassword" label="Confirm password">
              <input
                id="confirmPassword"
                type="password"
                required
                maxLength={PASSWORD_MAX_LENGTH}
                autoComplete="new-password"
                value={fields.confirmPassword}
                onChange={update("confirmPassword")}
                className={inputClass}
              />
            </Field>
          </div>

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

function Field({
  id,
  label,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
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
  // The sign up limit per internet address (hook_before_user_created): its own words say it best.
  if (error.message.includes(SIGN_UP_ADDRESS_MESSAGE)) return error.message;
  // Supabase's emails per hour ran out (Authentication → Rate Limits).
  if (error.code === "over_email_send_rate_limit") return "We can't send more sign up emails right now. Please try again in an hour.";
  if (error.code === "over_request_rate_limit") return "Too many tries. Please wait a few minutes and try again.";
  if (error.code === "captcha_failed" || /captcha/i.test(error.message)) return "The security check expired. Please try again.";
  if (isAuthRetryableFetchError(error)) return "Couldn't reach the server. Check your internet and try again.";
  return "Something went wrong. Please try again.";
}

const inputClass =
  "w-full rounded-input border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary";
