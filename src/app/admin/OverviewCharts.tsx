export type OverviewRow = { series: string; day: string; total: number };

// The charts in order. People charts are skipped for a plain admin.
const CHARTS = [
  { series: "presentations", title: "New presentations" },
  { series: "publishes", title: "Teachers' publishes" },
  { series: "likes", title: "Likes", note: "Counted from Oct 23, 2026." },
  { series: "saves", title: "Saves", note: "Counted from Oct 23, 2026." },
  { series: "reports", title: "Reports", note: "Counted from Oct 23, 2026." },
  { series: "submissions", title: "Submissions" },
  { series: "reviews", title: "Reviews submitted", note: "Latest round of each presentation only." },
  { series: "signups", title: "New teachers" },
  { series: "logins", title: "Teachers who logged in", note: "Each teacher's last login only." },
  { series: "pauses", title: "Click pauses" },
  { series: "bans", title: "Automatic bans" },
];

// Only the super admin gets these (the database sends them to nobody else).
const PEOPLE = ["signups", "logins", "pauses", "bans"];

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Oct 12" from "2026-10-12" (UTC, so no time zone shift). */
function label(isoDay: string): string {
  return new Date(`${isoDay}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

/** The last `days` UTC days ending today, as "YYYY-MM-DD". */
function lastDays(days: number): string[] {
  const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  return Array.from({ length: days }, (_, i) => new Date(today - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

/** The Monday of a day's week, as "YYYY-MM-DD". */
function mondayOf(isoDay: string): string {
  const time = new Date(`${isoDay}T00:00:00Z`).getTime();
  const sinceMonday = (new Date(time).getUTCDay() + 6) % 7;
  return new Date(time - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

/** Bars for one series: one per day, or one per week (Monday start) for 90 days. Days with no rows count 0. */
function buildBars(rows: OverviewRow[], days: number) {
  const perDay = new Map(rows.map((row) => [row.day, Number(row.total)]));
  const bars: { key: string; text: string; total: number }[] = [];
  for (const day of lastDays(days)) {
    const total = perDay.get(day) ?? 0;
    if (days < 90) {
      bars.push({ key: day, text: label(day), total });
      continue;
    }
    const week = mondayOf(day);
    const last = bars[bars.length - 1];
    if (last && last.key === week) last.total += total;
    else bars.push({ key: week, text: `Week of ${label(week)}`, total });
  }
  return bars;
}

/**
 * One card per series: its title, the total for the range, and a bar for each day (or week). Hovering a bar shows
 * its date and number; the tallest bar shows its number, and the first and last dates sit under the bars.
 * Plain server markup (the hover is CSS only).
 */
export function OverviewCharts({ rows, days, isSuperAdmin }: { rows: OverviewRow[]; days: number; isSuperAdmin: boolean }) {
  return (
    <>
      <p className="mb-3 text-sm text-text-secondary">
        Each bar is one {days < 90 ? "day" : "week"}. Taller means more. Point at a bar to see its number.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {CHARTS.map(({ series, title, note }) => {
          if (PEOPLE.includes(series) && !isSuperAdmin) return null;
          const bars = buildBars(rows.filter((row) => row.series === series), days);
          const max = Math.max(...bars.map((bar) => bar.total));
          const sum = bars.reduce((all, bar) => all + bar.total, 0);
          // Only the first tallest bar gets its number written on it.
          const peak = bars.findIndex((bar) => bar.total === max);
          return (
            <div key={series} className="rounded-card border border-border-default bg-bg-surface px-5 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">{title}</h3>
                <span className="font-heading text-2xl font-extrabold text-text-primary">{sum}</span>
              </div>
              {sum === 0 ? (
                <div className="mt-3 flex h-24 items-center justify-center border-b border-border-default text-sm text-text-secondary">
                  Nothing yet in this time.
                </div>
              ) : (
                <div className="mt-3 flex h-24 items-end gap-[2px] border-b border-border-default pt-5">
                  {bars.map((bar, index) => (
                    // The whole column is the hover target, so thin bars are easy to point at.
                    <div key={bar.key} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
                      <div
                        className="relative shrink-0 rounded-t-[4px] bg-accent group-hover:bg-accent-hover"
                        style={{ height: bar.total > 0 ? `${Math.max((bar.total / max) * 100, 4)}%` : 0 }}
                      >
                        {index === peak && (
                          <span className="absolute inset-x-0 bottom-full pb-0.5 text-center text-[11px] font-semibold text-text-primary group-hover:invisible">
                            {bar.total}
                          </span>
                        )}
                      </div>
                      <span
                        className={`pointer-events-none absolute -top-2 z-10 hidden -translate-y-full whitespace-nowrap rounded-dropdown border border-border-default bg-bg-surface px-2 py-1 text-xs text-text-primary group-hover:block ${
                          index < bars.length / 3 ? "left-0" : index > (bars.length * 2) / 3 ? "right-0" : "left-1/2 -translate-x-1/2"
                        }`}
                      >
                        {bar.text}: <strong>{bar.total}</strong>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-1 flex justify-between text-[11px] text-text-secondary">
                <span>{bars[0].text}</span>
                <span>{days < 90 ? "Today" : "This week"}</span>
              </div>
              {note && <p className="mt-2 text-xs text-text-secondary">{note}</p>}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-text-secondary">Days in UTC.</p>
    </>
  );
}
