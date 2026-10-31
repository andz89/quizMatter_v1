import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { LinkPending } from "@/components/LinkPending";
import { getAccount } from "@/lib/account";
import { ADMIN_ACTION_LABELS, type AdminAction } from "@/lib/adminActions";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { OverviewCharts, type OverviewRow } from "./OverviewCharts";
import { TeacherBreakdown, type BreakdownRow } from "./TeacherBreakdown";
import { getTodoCounts } from "./todoCounts";

const RANGES = [7, 30, 90];
// Anything but 7, 30 or 90 shows 30 days.
const daysSchema = z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)])).catch(30);

const TODO = [
  { key: "reviews", label: "Under review", href: "/admin/presentations/reviews" },
  { key: "submissions", label: "Submissions", href: "/admin/presentations/submissions" },
  { key: "reports", label: "Reports", href: "/admin/reports" },
] as const;

type RecentAction = { id: number; admin_name: string; action: AdminAction; target_title: string | null; created_at: string };

const sectionLabel = "text-[11px] font-bold tracking-[0.05em] text-text-header uppercase";

/**
 * Admin → Overview: what is waiting for you, how busy the app is (bars per day), how many teachers by province, age
 * group and gender, and, for the super admin, the latest admin actions. The range is `?days=7|30|90`. (../layout.tsx checks the user is an admin.)
 */
export default async function AdminOverviewPage({ searchParams }: PageProps<"/admin">) {
  const { isAdmin, isSuperAdmin } = await getAccount();
  if (!isAdmin) notFound();
  const days = daysSchema.parse((await searchParams).days);

  const supabase = await createClient();
  const [todo, overview, breakdown, recent] = await Promise.all([
    // The same call as the menu's pills (cached for the request).
    getTodoCounts(),
    supabase.rpc("admin_overview", { days }),
    supabase.rpc("admin_teacher_breakdown"),
    isSuperAdmin
      ? supabase
          .from("admin_actions")
          .select("id, admin_name, action, target_title, created_at")
          .order("created_at", { ascending: false })
          .limit(10)
      : null,
  ]);
  if (todo.error) throw todo.error;
  if (overview.error) throw overview.error;
  if (breakdown.error) throw breakdown.error;
  if (recent?.error) throw recent.error;
  const actions = (recent?.data ?? []) as RecentAction[];

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className={`mb-3 ${sectionLabel}`}>Waiting for you</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {TODO.map(({ key, label, href }) => (
            <Link
              key={key}
              href={href}
              className="rounded-card border border-border-default bg-bg-surface px-5 py-4 transition-colors hover:border-accent"
            >
              <span className="font-heading text-3xl font-extrabold text-text-primary">{todo.data[key]}</span>
              <span className="mt-1 block text-sm text-text-secondary">{label}</span>
              <LinkPending />
            </Link>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className={sectionLabel}>Activity</h2>
          <div className="flex gap-2">
            {RANGES.map((range) => (
              <Link
                key={range}
                href={`/admin?days=${range}`}
                className={`rounded-dropdown px-3 py-1 text-sm font-semibold transition-colors ${
                  range === days ? "bg-accent-soft text-accent" : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {range} days
                <LinkPending />
              </Link>
            ))}
          </div>
        </div>
        <OverviewCharts rows={overview.data as OverviewRow[]} days={days} isSuperAdmin={isSuperAdmin} />
      </section>

      <section>
        <h2 className={`mb-3 ${sectionLabel}`}>Teachers</h2>
        <TeacherBreakdown rows={breakdown.data as BreakdownRow[]} />
      </section>

      {isSuperAdmin && (
        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className={sectionLabel}>Recent admin actions</h2>
            <Link href="/admin/activity" className="text-sm font-semibold text-accent hover:underline">
              See all
              <LinkPending />
            </Link>
          </div>
          <div className="overflow-hidden rounded-card border border-border-default bg-bg-surface">
            {actions.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-text-secondary">No admin actions yet.</p>
            ) : (
              actions.map((row) => (
                <div key={row.id} className="flex flex-wrap items-baseline gap-x-3 border-b border-border-default px-5 py-3 text-sm last:border-b-0">
                  <span className="w-24 shrink-0 text-text-secondary">{formatDate(new Date(row.created_at).getTime())}</span>
                  <span className="font-semibold text-text-primary">{row.admin_name}</span>
                  <span className="text-text-secondary">{ADMIN_ACTION_LABELS[row.action] ?? row.action}</span>
                  {row.target_title && <span className="min-w-0 truncate text-text-primary">{row.target_title}</span>}
                </div>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  );
}
