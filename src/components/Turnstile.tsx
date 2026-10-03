"use client";

import { useEffect, useRef, useState } from "react";
import { TURNSTILE_SITE_KEY } from "@/lib/constants";

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// Loaded once, the first time a check is shown. "render=explicit": we place the check ourselves (below).
let scriptLoad: Promise<void> | null = null;
function loadScript() {
  scriptLoad ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      scriptLoad = null; // try again next time
      reject();
    };
    document.head.appendChild(script);
  });
  return scriptLoad;
}

// Cloudflare waits about 2 minutes before it says a check froze (error 300030). We give up sooner.
const CHECK_TIMEOUT_MS = 15_000;

/** What the check is doing, so the page can show the right words on its button. */
export type TurnstileStatus = "checking" | "needs-click" | "failed" | "passed";

/**
 * Cloudflare Turnstile, the "are you human?" check. `onToken` gets a one-time pass once the check is done (most
 * people just see a tick), and null when the pass expires or the check fails. Supabase checks the pass at login
 * (Authentication → Attack Protection). A pass works once: give this a new `key` to get a fresh one.
 */
export function Turnstile({
  onToken,
  onStatus,
}: {
  onToken: (token: string | null) => void;
  onStatus?: (status: TurnstileStatus) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);
  // Kept in refs so a new function from the parent doesn't restart the check.
  const onTokenRef = useRef(onToken);
  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    onTokenRef.current = onToken;
    onStatusRef.current = onStatus;
  });
  // Why the check failed (a Cloudflare error code, or "load" when the script didn't load), or null.
  const [failure, setFailure] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let isCancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopTimer = () => clearTimeout(timer);
    const startTimer = () => {
      stopTimer();
      timer = setTimeout(() => fail("timeout"), CHECK_TIMEOUT_MS);
    };
    const fail = (reason: string) => {
      stopTimer();
      setFailure(reason);
      onTokenRef.current(null);
      onStatusRef.current?.("failed");
    };
    onStatusRef.current?.("checking");
    loadScript().then(
      () => {
        if (isCancelled) return;
        if (!boxRef.current || !window.turnstile) return fail("not-ready");
        startTimer();
        widgetIdRef.current = window.turnstile.render(boxRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          size: "flexible",
          theme: "light",
          retry: "never", // show a failure at once (with our Try again button) instead of retrying quietly for minutes
          callback: (token: string) => {
            stopTimer();
            setFailure(null);
            onTokenRef.current(token);
            onStatusRef.current?.("passed");
          },
          "expired-callback": () => {
            onTokenRef.current(null);
            onStatusRef.current?.("checking");
          },
          // The user is clicking: no time limit while they do.
          "before-interactive-callback": () => {
            stopTimer();
            onStatusRef.current?.("needs-click");
          },
          "after-interactive-callback": () => onStatusRef.current?.("checking"),
          "error-callback": (code: string) => {
            fail(code || "unknown");
            return true; // we show the error ourselves
          },
        });
      },
      () => {
        if (!isCancelled) fail("load");
      },
    );
    return () => {
      isCancelled = true;
      stopTimer();
      if (widgetIdRef.current) window.turnstile?.remove(widgetIdRef.current);
      widgetIdRef.current = undefined;
    };
  }, [loadAttempt]);

  const tryAgain = () => {
    setFailure(null);
    onStatusRef.current?.("checking");
    setLoadAttempt((attempt) => attempt + 1);
  };

  return (
    <div>
      {failure !== "load" && <div ref={boxRef} className="min-h-[65px]" />}
      {failure && (
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-sm text-danger-strong">
            {failure === "load"
              ? "Couldn't load the security check."
              : failure === "timeout"
                ? "The security check is taking too long."
                : `The security check didn't work (code ${failure}).`}
          </p>
          <button
            type="button"
            onClick={tryAgain}
            className="shrink-0 rounded-dropdown border border-border-default px-3 py-1 text-sm font-semibold text-text-primary hover:bg-accent-soft"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
