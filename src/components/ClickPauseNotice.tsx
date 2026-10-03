"use client";

import { useEffect } from "react";
import { BanIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { CLICK_FEATURES, pauseFeature, usePausedList, type ClickFeature } from "@/lib/clickLimits";

/**
 * The sticky notice at the bottom of the screen while a feature is paused for clicking too fast (see
 * src/lib/clickLimits.ts). It's in the root layout once: when a page first loads it asks the database which features
 * are paused, and after that a refused click (QMBLK) pauses one. It goes away by itself when the pause ends.
 */
export function ClickPauseNotice() {
  const paused = usePausedList();

  useEffect(() => {
    const supabase = createClient();
    // getSession reads the login cookie without asking the server: logged-out pages (login) skip the question.
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const { data: rows } = await supabase.rpc("my_paused_features");
      for (const row of (rows ?? []) as { feature: string; paused_until: string }[]) {
        if (row.feature in CLICK_FEATURES) pauseFeature(row.feature as ClickFeature, Date.parse(row.paused_until));
      }
    });
  }, []);

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
