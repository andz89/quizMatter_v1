"use client";

import { useTransition } from "react";
import { UndoIcon } from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/Spinner";
import { releasePause } from "./actions";

export type PausedRow = {
  userId: string;
  email: string;
  feature: string;
  // What the feature is called, e.g. "Save (bookmarks)".
  label: string;
  // "Paused for 8 more min", or "Pause ended 20 min ago, can use it again".
  status: string;
  isPausedNow: boolean;
  // Pauses in the current chain, and the time that bans (null = this feature never bans): banAfter 3 = 2 pauses,
  // then the 3rd time bans.
  streak: number;
  banAfter: number | null;
};

/**
 * Teachers paused for clicking too fast right now ("Paused"), and those whose pause is over but still counts toward an
 * automatic ban ("Free"). Release (or Reset count, when not paused) ends the pause and starts their chain again from 0.
 */
export function PausedTeachers({ rows, repeatHours }: { rows: PausedRow[]; repeatHours: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-text-secondary">
        Teachers who are paused now, or whose pause is over but still counts toward an automatic ban (for {repeatHours} hours).
      </p>
      {rows.length === 0 ? (
        <p className="rounded-card border border-border-default bg-bg-surface px-5 py-6 text-center text-sm text-text-secondary">
          Nobody clicked too fast lately.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-border-default rounded-card border border-border-default bg-bg-surface">
          {rows.map((row) => (
            <Row key={`${row.userId}:${row.feature}`} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ row }: { row: PausedRow }) {
  const [isBusy, startTransition] = useTransition();
  // The next time they reach the limit bans: shown in coral, so it stands out.
  const isLastChance = row.banAfter !== null && row.streak >= row.banAfter - 1;

  const release = () => {
    const question = row.isPausedNow
      ? `Release ${row.email}? Their pause ends now (an open page catches up within a minute) and their count starts again from 0.`
      : `Reset ${row.email}'s count? It starts again from 0.`;
    if (!confirm(question)) return;
    startTransition(async () => {
      const error = await releasePause(row.userId, row.feature);
      if (error) toast.error(error);
      else toast.success(row.isPausedNow ? `${row.email} is released.` : `${row.email}'s count is reset.`);
    });
  };

  return (
    <div className={`flex flex-wrap items-center gap-3 px-5 py-3.5 ${isBusy ? "opacity-60" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold text-text-primary">{row.email}</span>
          {row.isPausedNow ? (
            <span className={`${pillClass} bg-highlight-soft text-highlight-strong`}>Paused</span>
          ) : (
            <span className={`${pillClass} bg-success-soft text-success-strong`}>Free</span>
          )}
          {row.banAfter !== null && (
            <span className={`${pillClass} ${isLastChance ? "bg-danger-soft text-danger-strong" : "bg-bg-page text-text-secondary"}`}>
              {row.streak} of {row.banAfter - 1} {row.banAfter - 1 === 1 ? "pause" : "pauses"}
              {isLastChance && " · next time bans"}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[13px] text-text-secondary">
          {row.label} · {row.status}
        </p>
      </div>

      <div className="flex items-center gap-2">
        {isBusy && <Spinner size={16} />}
        <button
          type="button"
          onClick={release}
          disabled={isBusy}
          className="inline-flex items-center gap-2 rounded-dropdown border border-border-default bg-bg-surface px-2.5 py-1.5 text-[13px] font-semibold text-text-primary transition-colors hover:bg-bg-page disabled:opacity-60"
        >
          <UndoIcon size={14} />
          {row.isPausedNow ? "Release" : "Reset count"}
        </button>
      </div>
    </div>
  );
}

const pillClass = "rounded-dropdown px-2.5 py-1 text-[13px] leading-none font-semibold";
