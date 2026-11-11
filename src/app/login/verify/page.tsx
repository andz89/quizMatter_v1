"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LinkPending } from "@/components/LinkPending";
import { Logo } from "@/components/Logo";
import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";
import { safeNextPath } from "@/lib/nextPath";
import { codeErrorMessage } from "@/lib/secondFactor";
import { createClient } from "@/lib/supabase/client";

/**
 * The second step of an admin's login: the 6-digit code from their authenticator app. On a right code Supabase
 * gives the browser a new login at level aal2 (is_admin() is true from then on) and we go back to `?next=`.
 * Someone without a set-up app (a teacher who typed the address) is told so instead.
 */
export default function VerifyPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  // The verified factor's id; null when the account has none; undefined while asking.
  const [factorId, setFactorId] = useState<string | null | undefined>(undefined);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    supabase.auth.mfa.listFactors().then(({ data }) => {
      setFactorId(data?.totp.find((factor) => factor.status === "verified")?.id ?? null);
    });
  }, [supabase]);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId || isChecking) return;
    setIsChecking(true);
    setError("");
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, "") });
    if (error) {
      setError(codeErrorMessage(error));
      setCode("");
      setIsChecking(false);
      return;
    }
    router.push(safeNextPath(new URLSearchParams(window.location.search).get("next"), window.location.origin));
    router.refresh();
  };

  const logOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
      <Logo size={44} />
      <form onSubmit={verify} className="w-full max-w-sm rounded-card border border-border-default bg-bg-surface px-5 py-6">
        <h1 className="mb-2 text-base font-extrabold text-text-primary">Two-step login</h1>
        {factorId === undefined && (
          <div className="flex justify-center py-6">
            <Spinner size={20} />
          </div>
        )}
        {factorId === null && (
          <p className="text-sm text-text-secondary">
            This account has no authenticator app set up, so there is nothing to check here.{" "}
            <Link href="/" className="font-semibold text-accent hover:underline">
              Go to the home page.
              <LinkPending />
            </Link>
          </p>
        )}
        {factorId && (
          <>
            <p className="mb-4 text-sm text-text-secondary">Type the 6-digit code from your authenticator app.</p>
            <label htmlFor="code" className="mb-1 block text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">
              Code
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-input border border-border-default px-3 py-2 text-sm tracking-[0.2em] text-text-primary outline-none focus:border-text-secondary"
            />
            {error && <p className="mt-3 text-sm text-danger-strong">{error}</p>}
            <button
              type="submit"
              disabled={isChecking || code.replace(/\s/g, "").length < 6}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-button bg-accent btn-press px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {isChecking && <Spinner size={14} />}
              {isChecking ? "Checking…" : "Continue"}
            </button>
          </>
        )}
        <p className="mt-4 text-center text-sm text-text-secondary">
          Not you?{" "}
          <button type="button" onClick={logOut} className="font-semibold text-accent hover:underline">
            Log out
          </button>
        </p>
      </form>
      {isChecking && <TopLoadingBar />}
    </main>
  );
}
