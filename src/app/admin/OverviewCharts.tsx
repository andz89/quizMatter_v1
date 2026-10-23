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

/** One card per series: its title, the total for the range, and a bar for each day (or week). Plain server markup. */
export function OverviewCharts({ rows, days, isSuperAdmin }: { rows: OverviewRow[]; days: number; isSuperAdmin: boolean }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {CHARTS.map(({ series, title, note }) => {
          const own = rows.filter((row) => row.series === series);
          if (PEOPLE.includes(series) && !isSuperAdmin) return null;
          const bars = buildBars(own, days);
          const max = Math.max(...bars.map((bar) => bar.total));
          const sum = bars.reduce((all, bar) => all + bar.total, 0);
          return (
            <div key={series} className="rounded-card border border-border-default bg-bg-surface px-5 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">{title}</h3>
                <span className="font-heading text-2xl font-extrabold text-text-primary">{sum}</span>
              </div>
              <div className="mt-3 flex h-24 items-end gap-px border-b border-border-default">
                {bars.map((bar) => (
                  <div
                    key={bar.key}
                    title={`${bar.text}: ${bar.total}`}
                    className="min-w-0 flex-1 rounded-t-[4px] bg-accent"
                    style={{ height: bar.total > 0 ? `${Math.max((bar.total / max) * 100, 4)}%` : 0 }}
                  />
                ))}
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
