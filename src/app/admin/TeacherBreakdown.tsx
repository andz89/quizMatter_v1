import { GENDER_LABELS, type Gender } from "@/lib/userSettings";

// One row of admin_teacher_breakdown (20261220000000_age_gender_address.sql): how many teachers have this label.
// label "" = not given. total is a bigint, which can come back as a string.
export type BreakdownRow = { kind: "province" | "age" | "gender"; label: string; total: number | string };

type Bar = { label: string; total: number };

const AGE_GROUPS = ["18–24", "25–34", "35–44", "45–54", "55+"];
// Provinces shown by name; the rest are summed as "Others".
const TOP_PROVINCES = 10;

/** The rows of one kind as bars, "Not given" last. */
function barsOf(rows: BreakdownRow[], kind: BreakdownRow["kind"]): Bar[] {
  const found = rows.filter((row) => row.kind === kind).map((row) => ({ label: row.label, total: Number(row.total) }));
  const given = found.filter((bar) => bar.label !== "");
  const notGiven = found.find((bar) => bar.label === "");
  let bars: Bar[];
  if (kind === "age") {
    bars = AGE_GROUPS.map((label) => ({ label, total: given.find((bar) => bar.label === label)?.total ?? 0 }));
  } else if (kind === "gender") {
    bars = given.map((bar) => ({ ...bar, label: GENDER_LABELS[bar.label as Gender] ?? bar.label }));
  } else {
    const sorted = given.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
    bars = sorted.slice(0, TOP_PROVINCES);
    const others = sorted.slice(TOP_PROVINCES).reduce((sum, bar) => sum + bar.total, 0);
    if (others > 0) bars.push({ label: "Others", total: others });
  }
  if (notGiven) bars.push({ label: "Not given", total: notGiven.total });
  return bars;
}

const CARDS = [
  { kind: "province", title: "By province" },
  { kind: "age", title: "By age group" },
  { kind: "gender", title: "By gender" },
] as const;

/** Admin → Overview's Teachers section: counts by province, age group and gender (no names). */
export function TeacherBreakdown({ rows }: { rows: BreakdownRow[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {CARDS.map(({ kind, title }) => {
        const bars = barsOf(rows, kind);
        const max = Math.max(1, ...bars.map((bar) => bar.total));
        return (
          <div key={kind} className="rounded-card border border-border-default bg-bg-surface px-5 py-4">
            <h3 className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">{title}</h3>
            <ul className="mt-3 flex flex-col gap-2">
              {bars.map((bar) => (
                <li key={bar.label} className="text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-text-primary">{bar.label}</span>
                    <span className="font-semibold text-text-primary">{bar.total}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-dropdown bg-accent-soft">
                    <div className="h-full rounded-dropdown bg-accent" style={{ width: `${(bar.total / max) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
