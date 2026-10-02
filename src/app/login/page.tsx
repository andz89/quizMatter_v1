"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { LoginAbout } from "@/components/LoginAbout";
import { Spinner } from "@/components/Spinner";
import { Turnstile } from "@/components/Turnstile";
import { createClient } from "@/lib/supabase/client";

// No sign up: users are added by hand in the Supabase dashboard (Authentication → Users).
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  // The "are you human?" pass, and a number that shows a fresh check when it goes up (a pass works only once).
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaRound, setCaptchaRound] = useState(0);

  const logIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!captchaToken) return;
    setIsLoggingIn(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({ email, password, options: { captchaToken } });
    if (error) {
      setError(error.message);
      setIsLoggingIn(false);
      setCaptchaToken(null);
      setCaptchaRound((round) => round + 1);
      return;
    }
    // Back to the page the proxy sent us from (only paths on this site, never another domain).
    const next = new URLSearchParams(window.location.search).get("next");
    router.push(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
    router.refresh();
  };

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
      <Logo size={36} />
      {/* Phones: login first, about below. Wide screens: about on the left, login on the right. */}
      <div className="flex w-full flex-col items-center gap-10 md:flex-row-reverse md:items-center md:justify-center md:gap-16">
        <form onSubmit={logIn} className="w-full max-w-sm rounded-card border border-border-default bg-bg-surface px-5 py-6">
          <h1 className="mb-5 text-base font-extrabold text-text-primary">Log in</h1>

          <label className="mb-1 block text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">Email</label>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />

          <label className="mt-4 mb-1 block text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">Password</label>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />

          <div className="mt-4">
            <Turnstile key={captchaRound} onToken={setCaptchaToken} />
          </div>

          {error && <p className="mt-3 text-sm text-danger-strong">{error}</p>}

          <button
            type="submit"
            disabled={isLoggingIn || !captchaToken}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-button bg-accent btn-press px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {(isLoggingIn || !captchaToken) && <Spinner size={14} />}
            {isLoggingIn ? "Logging in…" : captchaToken ? "Log in" : "Checking you're human…"}
          </button>
        </form>
        <LoginAbout />
      </div>
    </main>
  );
}

const inputClass =
  "w-full rounded-input border border-border-default px-3 py-2 text-sm text-text-primary outline-none focus:border-text-secondary";
