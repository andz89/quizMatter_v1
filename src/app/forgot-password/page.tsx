"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { isAuthError, isAuthRetryableFetchError } from "@supabase/supabase-js";
import { MailCheckIcon } from "lucide-react";
import { LinkPending } from "@/components/LinkPending";
import { Logo } from "@/components/Logo";
import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";
import { Turnstile, type TurnstileStatus } from "@/components/Turnstile";
import { resetEmailSchema } from "@/lib/passwords";
import { createClient } from "@/lib/supabase/client";

/**
 * Forgot password: the teacher types their email and Supabase sends the "Reset Password" email, whose link opens
 * /auth/confirm (type=recovery) and then /set-password. The page shows "Check your email" for every email, also one
 * with no account (Supabase answers the same and sends nothing), so it never tells who has an account.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  // The address the link was sent to: shows "Check your email".
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

  const sendLink = async (e: FormEvent) => {
    e.preventDefault();
    if (!captchaToken) return;
    const checked = resetEmailSchema.safeParse(email);
    if (!checked.success) return setError(checked.error.issues[0].message);
    setIsSending(true);
    setError(null);
    const { error } = await createClient().auth.resetPasswordForEmail(checked.data, { captchaToken });
    if (error) {
      setError(resetErrorMessage(error));
      setCaptchaToken(null);
      setCaptchaRound((round) => round + 1);
    } else {
      setSentTo(checked.data);
    }
    setIsSending(false);
  };

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
      <Logo size={44} />

      {sentTo ? (
        <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-card border border-border-default bg-bg-surface px-5 py-8 text-center">
          <MailCheckIcon size={36} className="text-accent" />
          <h1 className="text-lg font-extrabold text-text-primary">Check your email</h1>
          <p className="text-sm text-text-primary">
            We sent a link to <span className="font-semibold">{sentTo}</span>.
          </p>
          <p className="text-xs text-text-secondary">No email after a few minutes? Check your spam folder.</p>
          <BackToLogin />
        </div>
      ) : (
        <form onSubmit={sendLink} className="w-full max-w-sm rounded-card border border-border-default bg-bg-surface px-5 py-6">
          <h1 className="text-base font-extrabold text-text-primary">Forgot password</h1>
          <p className="mt-1 mb-5 text-sm text-text-secondary">Type your email</p>

          <label htmlFor="email" className="mb-1 block text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />

          <div className="mt-4">
            <Turnstile key={captchaRound} onToken={setCaptchaToken} onStatus={setCaptchaStatus} />
          </div>

          {error && <p className="mt-3 text-sm text-danger-strong">{error}</p>}

          <button
            type="submit"
            disabled={isSending || !captchaToken}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-button bg-accent btn-press px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {(isSending || (!captchaToken && captchaStatus === "checking")) && <Spinner size={14} />}
            {isSending
              ? "Sending…"
              : captchaToken
                ? "Send link"
                : captchaStatus === "needs-click"
                  ? "Tick the box above to continue"
                  : captchaStatus === "failed"
                    ? "Security check failed"
                    : "Checking you're human…"}
          </button>

          <div className="mt-4 text-center">
            <BackToLogin />
          </div>
        </form>
      )}
      {isSending && <TopLoadingBar />}
    </main>
  );
}

function BackToLogin() {
  return (
    <Link href="/login" className="text-sm font-semibold text-accent hover:underline">
      Back to log in
      <LinkPending />
    </Link>
  );
}

// Plain-English words for what went wrong.
function resetErrorMessage(error: unknown) {
  if (!isAuthError(error)) return "Something went wrong. Please try again.";
  if (error.code === "captcha_failed" || /captcha/i.test(error.message)) return "The security check expired. Please try again.";
  // This email asked less than a minute ago ("…you can only request this after 42 seconds").
  if (/after \d+ seconds?/i.test(error.message)) return "We just sent a link. Please wait a minute before asking again.";
  // Supabase's emails per hour ran out (Authentication → Rate Limits).
  if (error.code === "over_email_send_rate_limit") return "We can't send more emails right now. Please try again in an hour.";
  if (error.code === "over_request_rate_limit") return "Too many tries. Please wait a few minutes and try again.";
  if (isAuthRetryableFetchError(error)) return "Couldn't reach the server. Check your internet and try again.";
  return "Something went wrong. Please try again.";
}

const inputClass =
  "w-full rounded-input border border-border-default px-3 py-2 text-sm text-text-primary outline-none focus:border-text-secondary";
