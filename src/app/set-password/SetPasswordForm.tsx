"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isAuthError, isAuthRetryableFetchError } from "@supabase/supabase-js";
import { toast } from "sonner";
import { LinkPending } from "@/components/LinkPending";
import { Logo } from "@/components/Logo";
import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";
import { clearLock, LOGIN_LIMIT } from "@/lib/browserLimits";
import { newPasswordSchema, PASSWORD_MAX_LENGTH, SAME_PASSWORD_MESSAGE } from "@/lib/passwords";
import { setNewPassword } from "@/lib/userSettings";

/** The Set a new password form (page.tsx gives it the logged-in account's email, shown as "For …"). */
export function SetPasswordForm({ email }: { email: string | null }) {
  const router = useRouter();
  const [fields, setFields] = useState({ password: "", confirmPassword: "" });
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const checked = newPasswordSchema.safeParse(fields);
    if (!checked.success) return setError(checked.error.issues[0].message);
    setIsSaving(true);
    setError(null);
    try {
      await setNewPassword(checked.data);
      // Too many wrong tries may have locked login on this browser: that's why they came here.
      clearLock(LOGIN_LIMIT);
      toast.success("Password changed.");
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(setPasswordErrorMessage(err));
      setIsSaving(false);
    }
  };

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
      <Logo size={44} />
      <form onSubmit={save} className="w-full max-w-sm rounded-card border border-border-default bg-bg-surface px-5 py-6">
        <div className="mb-5">
          <h1 className="text-base font-extrabold text-text-primary">Set a new password</h1>
          {/* Whose account the link logged in to, so a forwarded link is easy to spot. */}
          {email && (
            <p className="mt-1 text-sm text-text-secondary">
              For <span className="font-semibold">{email}</span>
            </p>
          )}
        </div>

        <label htmlFor="password" className={labelClass}>New password</label>
        <input
          id="password"
          type="password"
          required
          maxLength={PASSWORD_MAX_LENGTH}
          autoComplete="new-password"
          value={fields.password}
          onChange={(e) => setFields((old) => ({ ...old, password: e.target.value }))}
          className={inputClass}
        />

        <label htmlFor="confirmPassword" className={`mt-4 ${labelClass}`}>Confirm password</label>
        <input
          id="confirmPassword"
          type="password"
          required
          maxLength={PASSWORD_MAX_LENGTH}
          autoComplete="new-password"
          value={fields.confirmPassword}
          onChange={(e) => setFields((old) => ({ ...old, confirmPassword: e.target.value }))}
          className={inputClass}
        />

        {error && <p className="mt-3 text-sm text-danger-strong">{error}</p>}

        <button
          type="submit"
          disabled={isSaving}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-button bg-accent btn-press px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
        >
          {isSaving && <Spinner size={14} />}
          {isSaving ? "Saving…" : "Save password"}
        </button>

        {/* The link logged them in, so someone who remembered their password can just go on. */}
        <div className="mt-4 text-center">
          <Link href="/" className="text-sm font-semibold text-accent hover:underline">
            Go to home
            <LinkPending />
          </Link>
        </div>
      </form>
      {isSaving && <TopLoadingBar />}
    </main>
  );
}

// Plain-English words for what went wrong.
function setPasswordErrorMessage(error: unknown) {
  if (!isAuthError(error)) return "Couldn't change your password. Please try again.";
  if (error.code === "same_password") return SAME_PASSWORD_MESSAGE;
  if (error.code === "weak_password") return "Please pick a stronger password.";
  if (isAuthRetryableFetchError(error)) return "Couldn't reach the server. Check your internet and try again.";
  return "Couldn't change your password. Please try again.";
}

const labelClass = "mb-1 block text-[11px] font-bold tracking-[0.05em] text-text-header uppercase";
const inputClass =
  "w-full rounded-input border border-border-default px-3 py-2 text-sm text-text-primary outline-none focus:border-text-secondary";
