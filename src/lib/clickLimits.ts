import { create } from "zustand";
import { createClient } from "./supabase/client";

/**
 * Features the database pauses for a while when a teacher clicks them too fast (see the click_limits migration).
 * `pausedText` finishes the sentence "… is paused until 3:45 PM" on the notice at the bottom of the screen.
 * A new feature also needs its row in click_limits and a count_click('<feature>') call in the database.
 */
export const CLICK_FEATURES = {
  saved: { pausedText: "Saving presentations" },
  share: { pausedText: "Sharing presentations" },
  publish: { pausedText: "Publishing presentations" },
  create: { pausedText: "Making new presentations" },
  display_name: { pausedText: "Changing your display name" },
} as const;

export type ClickFeature = keyof typeof CLICK_FEATURES;

/** When the pause ends (Unix ms), if the database refused because the feature is paused (QMBLK); else null. */
export function pausedUntilFromError(error: { code?: string; details?: string } | null): number | null {
  if (error?.code !== "QMBLK") return null;
  const until = Number(error.details);
  return Number.isFinite(until) ? until : null;
}

// The paused features and when each pause ends (Unix ms). Shared by every button, so they all grey out at once.
const usePausedFeatures = create<Partial<Record<ClickFeature, number>>>(() => ({}));

/** Pauses the feature until `until` (Unix ms); it un-pauses by itself when the time is up. */
export function pauseFeature(feature: ClickFeature, until: number) {
  usePausedFeatures.setState({ [feature]: until });
  setTimeout(() => {
    // A newer, longer pause may have replaced this one.
    if (usePausedFeatures.getState()[feature] === until) usePausedFeatures.setState({ [feature]: undefined });
  }, until - Date.now());
}

/** Replaces every pause with what the database says now (`until` in Unix ms), e.g. after an admin's Release. */
export function setPausedFeatures(paused: [ClickFeature, number][]) {
  usePausedFeatures.setState(
    Object.fromEntries((Object.keys(CLICK_FEATURES) as ClickFeature[]).map((feature) => [feature, undefined])),
  );
  for (const [feature, until] of paused) pauseFeature(feature, until);
}

/** Asks the database which features are paused for me, and shows exactly those. */
export async function checkPauses() {
  const supabase = createClient();
  // getSession reads the login cookie without asking the server: logged-out pages (login) skip the question.
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  const { data: rows, error } = await supabase.rpc("my_paused_features");
  if (error) return;
  setPausedFeatures(
    ((rows ?? []) as { feature: string; paused_until: string }[])
      .filter((row) => row.feature in CLICK_FEATURES)
      .map((row) => [row.feature as ClickFeature, Date.parse(row.paused_until)]),
  );
}

/** Same as useIsPaused, read once (e.g. right after a refused save). */
export function isPaused(feature: ClickFeature): boolean {
  return usePausedFeatures.getState()[feature] !== undefined;
}

/** True while the feature is paused: its buttons are greyed out. */
export function useIsPaused(feature: ClickFeature): boolean {
  return usePausedFeatures((paused) => paused[feature] !== undefined);
}

/** Every paused feature and when its pause ends, for the notice at the bottom of the screen. */
export function usePausedList(): [ClickFeature, number][] {
  const paused = usePausedFeatures();
  return (Object.entries(paused) as [ClickFeature, number | undefined][]).filter(
    (entry): entry is [ClickFeature, number] => entry[1] !== undefined
  );
}
