export type HistoryRow = {
  id: number;
  email: string;
  // What the feature is called, e.g. "Save (bookmarks)".
  label: string;
  kind: "pause" | "ban" | "release";
  pauseMinutes: number | null;
  // Pauses in the chain at that moment, and the time that bans (null = this feature never bans): banAfter 3 = 2
  // pauses, then the 3rd time bans.
  streak: number | null;
  banAfter: number | null;
  // "3 hr ago", worked out on the server.
  when: string;
  time: string;
};

/** Every pause, automatic ban and admin release, newest first (the click_history table). Read only. */
export function ClickHistory({ rows }: { rows: HistoryRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-card border border-border-default bg-bg-surface px-5 py-6 text-center text-sm text-text-secondary">
        Nothing yet. Pauses, bans and releases show here from now on.
      </p>
    );
  }
  return (
    <div className="flex flex-col divide-y divide-border-default rounded-card border border-border-default bg-bg-surface">
      {rows.map((row) => (
        <div key={row.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold text-text-primary">{row.email}</span>
              <KindPill row={row} />
              {row.kind === "pause" && row.streak !== null && row.banAfter !== null && (
                <span className={`${pillClass} bg-bg-page text-text-secondary`}>
                  {row.streak} of {row.banAfter - 1} {row.banAfter - 1 === 1 ? "pause" : "pauses"}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[13px] text-text-secondary">{row.label}</p>
          </div>
          <time dateTime={row.time} className="text-[13px] text-text-secondary">
            {row.when}
          </time>
        </div>
      ))}
    </div>
  );
}

function KindPill({ row }: { row: HistoryRow }) {
  if (row.kind === "ban") return <span className={`${pillClass} bg-danger-soft text-danger-strong`}>Banned</span>;
  if (row.kind === "release") return <span className={`${pillClass} bg-bg-page text-text-secondary`}>Released by an admin</span>;
  return <span className={`${pillClass} bg-highlight-soft text-highlight-strong`}>Paused {row.pauseMinutes} min</span>;
}

const pillClass = "rounded-dropdown px-2.5 py-1 text-[13px] leading-none font-semibold";
