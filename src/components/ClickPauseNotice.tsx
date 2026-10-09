"use client";

import { useEffect } from "react";
import { BanIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { CLICK_FEATURES, checkPauses, usePausedList } from "@/lib/clickLimits";

// While something is paused, how often to ask again, so an admin's Release reaches an open page.
const RECHECK_MS = 60_000;

/**
 * The sticky notice at the bottom of the screen while a feature is paused for clicking too fast (see
 * src/lib/clickLimits.ts). It's in the root layout once. It asks the database which features are paused when a page
 * first loads, after logging in, when the teacher comes back to the tab, and every minute while one is paused (an
 * admin may have released it). A refused click (QMBLK) also pauses one. It goes away by itself when the pause ends.
 */
export function ClickPauseNotice() {
  const paused = usePausedList();
  const isPaused = paused.length > 0;

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") checkPauses();
    };
    checkPauses();
    const { data: auth } = createClient().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") checkPauses();
    });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      auth.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!isPaused) return;
    const timer = setInterval(checkPauses, RECHECK_MS);
    return () => clearInterval(timer);
  }, [isPaused]);

  if (paused.length === 0) return null;

  return (
    <div role="status" className="fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      {paused.map(([feature, until]) => (
        <div
          key={feature}
          className="flex w-full max-w-md items-center gap-3 rounded-card border border-border-default bg-bg-surface px-5 py-3"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger-strong">
            <BanIcon size={16} />
          </span>
          <p className="text-sm text-text-primary">
            <span className="font-semibold">
              {CLICK_FEATURES[feature].pausedText} is paused until{" "}
              {new Date(until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </span>{" "}
            because you clicked too fast. It turns back on by itself.
          </p>
        </div>
      ))}
    </div>
  );
}
