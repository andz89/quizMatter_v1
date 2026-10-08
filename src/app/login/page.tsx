"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isAuthRetryableFetchError, type AuthError } from "@supabase/supabase-js";
import { LinkPending } from "@/components/LinkPending";
import { Logo } from "@/components/Logo";
import { LoginAbout } from "@/components/LoginAbout";
import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";
import { Turnstile, type TurnstileStatus } from "@/components/Turnstile";
import { createClient } from "@/lib/supabase/client";

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
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  // The "are you human?" pass, and a number that shows a fresh check when it goes up (a pass works only once).
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaRound, setCaptchaRound] = useState(0);
  const [captchaStatus, setCaptchaStatus] = useState<TurnstileStatus>("checking");

  // Back button after logging in: the browser may show its saved copy of this page, still "Logging in…" with a
  // used pass. Start over with a fresh check.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      setIsLoggingIn(false);
      setCaptchaToken(null);
      setCaptchaRound((round) => round + 1);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const logIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!captchaToken) return;
    setIsLoggingIn(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({ email, password, options: { captchaToken } });
    if (error) {
      setError(loginErrorMessage(error));
      setIsLoggingIn(false);
      setCaptchaToken(null);
      setCaptchaRound((round) => round + 1);
      return;
    }
    router.push(nextPath());
    router.refresh();
  };

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
      {/* Phones: centered. Wide screens: left edge lines up with the two columns below. */}
      <div className="flex w-full justify-center md:max-w-[52rem] md:justify-start">
        <Logo size={44} />
      </div>
      {/* Phones: login first, about below. Wide screens: about on the left, login on the right. */}
      <div className="flex w-full flex-col items-center gap-10 md:flex-row-reverse md:items-center md:justify-center md:gap-16">
        <form onSubmit={logIn} className="w-full max-w-sm rounded-card border border-border-default bg-bg-surface px-5 py-6">
          <h1 className="mb-5 text-base font-extrabold text-text-primary">Log in</h1>

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

          <label htmlFor="password" className="mt-4 mb-1 block text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">Password</label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />

          <div className="mt-4">
            <Turnstile key={captchaRound} onToken={setCaptchaToken} onStatus={setCaptchaStatus} />
          </div>

          {error && <p className="mt-3 text-sm text-danger-strong">{error}</p>}

          <button
            type="submit"
            disabled={isLoggingIn || !captchaToken}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-button bg-accent btn-press px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {(isLoggingIn || (!captchaToken && captchaStatus === "checking")) && <Spinner size={14} />}
            {isLoggingIn
              ? "Logging in…"
              : captchaToken
                ? "Log in"
                : captchaStatus === "needs-click"
                  ? "Tick the box above to continue"
                  : captchaStatus === "failed"
                    ? "Security check failed"
                    : "Checking you're human…"}
          </button>

          <p className="mt-4 text-center text-sm text-text-secondary">
            New to QuizMatter?{" "}
            <Link href="/signup" className="font-semibold text-accent hover:underline">
              Create an account
              <LinkPending />
            </Link>
          </p>
        </form>
        <LoginAbout />
      </div>
      {isLoggingIn && <TopLoadingBar />}
    </main>
  );
}

// Plain-English words for what went wrong.
function loginErrorMessage(error: AuthError) {
  if (error.code === "user_banned") return "This account is blocked. Contact QuizMatter if you think this is a mistake."; // Admin → Teachers
  if (error.code === "invalid_credentials") return "Wrong email or password.";
  if (error.code === "email_not_confirmed") return "Please confirm your email first. Check your inbox for the link.";
  if (error.code === "captcha_failed" || /captcha/i.test(error.message)) return "The security check expired. Please try again.";
  if (isAuthRetryableFetchError(error)) return "Couldn't reach the server. Check your internet and try again.";
  return "Something went wrong. Please try again.";
}

// Back to the page the proxy sent us from: only a page on this site, never another domain (e.g. "/\evil.com").
function nextPath() {
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next) return "/";
  const url = new URL(next, window.location.origin);
  return url.origin === window.location.origin ? url.pathname + url.search + url.hash : "/";
}

const inputClass =
  "w-full rounded-input border border-border-default px-3 py-2 text-sm text-text-primary outline-none focus:border-text-secondary";
