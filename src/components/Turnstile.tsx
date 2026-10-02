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
      scriptLoad = null; // try again next time
      reject();
    };
    document.head.appendChild(script);
  });
  return scriptLoad;
}

/**
 * Cloudflare Turnstile, the "are you human?" check. `onToken` gets a one-time pass once the check is done (most
 * people just see a tick), and null when the pass expires or the check fails. Supabase checks the pass at login
 * (Authentication → Attack Protection). A pass works once: give this a new `key` to get a fresh one.
 */
export function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [failedToLoad, setFailedToLoad] = useState(false);

  useEffect(() => {
    let widgetId: string | undefined;
    let isCancelled = false;
    loadScript().then(
      () => {
        if (isCancelled || !boxRef.current || !window.turnstile) return;
        widgetId = window.turnstile.render(boxRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          size: "flexible",
          theme: "light",
          callback: (token: string) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
        });
      },
      () => setFailedToLoad(true),
    );
    return () => {
      isCancelled = true;
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [onToken]);

  if (failedToLoad) {
    return <p className="text-sm text-danger-strong">Couldn&apos;t load the security check. Please reload the page.</p>;
  }
  return <div ref={boxRef} className="min-h-[65px]" />;
}
