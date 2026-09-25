"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// No sign up: users are added by hand in the Supabase dashboard (Authentication → Users).
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const logIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setIsLoggingIn(false);
      return;
    }
    // Back to the page the proxy sent us from (only paths on this site, never another domain).
    const next = new URLSearchParams(window.location.search).get("next");
    router.push(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
    router.refresh();
  };

  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <form onSubmit={logIn} className="w-full max-w-sm rounded-card border border-border-default bg-bg-surface px-5 py-6">
        <h1 className="mb-5 text-base font-semibold text-text-primary">Log in to quizMatter</h1>

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

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={isLoggingIn}
          className="mt-5 w-full rounded-button bg-accent-navy px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {isLoggingIn ? "Logging in…" : "Log in"}
        </button>
      </form>
    </main>
  );
}

const inputClass =
  "w-full rounded-input border border-border-default px-3 py-2 text-sm text-text-primary outline-none focus:border-text-secondary";
