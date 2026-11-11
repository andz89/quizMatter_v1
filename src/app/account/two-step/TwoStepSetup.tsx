"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LinkPending } from "@/components/LinkPending";
import { Spinner } from "@/components/Spinner";
import { codeErrorMessage } from "@/lib/secondFactor";
import { createClient } from "@/lib/supabase/client";

type State =
  | { step: "loading" }
  | { step: "on" }
  | { step: "setup"; factorId: string; qrCode: string; secret: string }
  | { step: "failed"; message: string };

/**
 * Sets up the authenticator app: Supabase makes a new factor (a QR code and its secret), the admin scans it and
 * types the first code, and the factor turns verified. That first check also lifts this login to aal2, so the
 * admin pages open right after. An unfinished earlier try (an unverified factor) is removed first, or Supabase
 * refuses a second one with the same name. Once it's on, the page only says so (to start over, the super admin
 * removes the factor in the Supabase dashboard: Authentication → Users → the account).
 */
export function TwoStepSetup() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<State>({ step: "loading" });
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  // Once only: in development React runs the effect twice, which would make two factors (the second refused).
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) return setState({ step: "failed", message: "Couldn't read your login settings. Please reload the page." });
      if (factors.totp.some((factor) => factor.status === "verified")) return setState({ step: "on" });
      for (const factor of factors.totp) await supabase.auth.mfa.unenroll({ factorId: factor.id });
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "QuizMatter" });
      if (enrollError || !data) return setState({ step: "failed", message: "Couldn't start the set-up. Please reload the page." });
      setState({ step: "setup", factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    })();
  }, [supabase]);

  const turnOn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state.step !== "setup" || isChecking) return;
    setIsChecking(true);
    setError("");
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: state.factorId, code: code.replace(/\s/g, "") });
    if (error) {
      setError(codeErrorMessage(error));
      setCode("");
      setIsChecking(false);
      return;
    }
    toast.success("Two-step login is on.");
    router.push("/admin");
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4 rounded-card border border-border-default bg-bg-surface p-5">
      {state.step === "loading" && (
        <div className="flex justify-center py-6">
          <Spinner size={20} />
        </div>
      )}
      {state.step === "failed" && <p className="text-sm text-danger-strong">{state.message}</p>}
      {state.step === "on" && (
        <>
          <p className="inline-flex w-fit rounded-dropdown bg-success-soft px-2 py-1 text-xs font-bold text-success-strong">
            Two-step login is on
          </p>
          <p className="text-sm text-text-secondary">Every login asks for a code from your authenticator app after the password.</p>
          <Link href="/admin" className="w-fit rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover">
            Go to Admin
            <LinkPending />
          </Link>
        </>
      )}
      {state.step === "setup" && (
        <form onSubmit={turnOn} className="flex flex-col gap-4">
          <h2 className="text-lg font-extrabold text-text-primary">Set up your authenticator app</h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-text-primary">
            <li>Open your authenticator app and add an account by scanning this code.</li>
            <li>Type the 6-digit code the app shows, then click Turn on.</li>
          </ol>
          {/* eslint-disable-next-line @next/next/no-img-element -- Supabase's own QR picture (an SVG data address). */}
          <img
            src={state.qrCode}
            alt="QR code for the authenticator app"
            width={200}
            height={200}
            className="rounded-dropdown border border-border-default bg-white"
          />
          <p className="text-sm text-text-secondary">
            Can&apos;t scan? Type this key into the app instead:{" "}
            <code data-testid="totp-secret" className="rounded-dropdown bg-accent-soft px-1.5 py-0.5 text-xs text-text-primary">
              {state.secret}
            </code>
          </p>
          <div>
            <label htmlFor="code" className="mb-1 block text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">
              Code from the app
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full max-w-xs rounded-input border border-border-default px-3 py-2 text-sm tracking-[0.2em] text-text-primary outline-none focus:border-text-secondary"
            />
          </div>
          {error && <p className="text-sm text-danger-strong">{error}</p>}
          <button
            type="submit"
            disabled={isChecking || code.replace(/\s/g, "").length < 6}
            className="flex w-fit items-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {isChecking && <Spinner size={14} />}
            Turn on
          </button>
        </form>
      )}
    </div>
  );
}
