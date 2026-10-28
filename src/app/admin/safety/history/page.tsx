import { notFound } from "next/navigation";
import { ShowMore } from "@/app/(home)/ShowMore";
import { parseShown } from "@/app/homeSearch";
import { getAccount } from "@/lib/account";
import { timeAgo } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { ClickHistory, type HistoryRow } from "../ClickHistory";
import { ClickTabs } from "../ClickTabs";
import { lookUpNames, type AdminClient, type ClickLimit } from "../data";

/**
 * Admin → Safety → History: every pause, automatic ban and admin release, newest first, 20 at a time ("Show more",
 * `?shown=`). The click_history table has no policies, so it needs the secret key. Each row saved the email when it
 * was written, so a deleted account's rows still say who it was (20261213000000_click_history_keeps_email.sql).
 */
export default async function AdminSafetyHistoryPage({ searchParams }: PageProps<"/admin/safety/history">) {
  // The layout checks too, but a layout doesn't run again on every request, so the page checks next to its data.
  if (!(await getAccount()).isSuperAdmin) notFound();
  const admin = createAdminClient();
  if (!admin) {
    return (
      <p className="rounded-card border border-border-default bg-bg-surface px-5 py-12 text-center text-sm text-text-secondary">
        This page needs the secret key SUPABASE_SECRET_KEY on the server.
      </p>
    );
  }
  const shown = parseShown(await searchParams);

  const [limits, history] = await Promise.all([
    admin.from("click_limits").select("*"),
    admin
      .from("click_history")
      .select("id, user_id, email, feature, kind, pause_minutes, streak, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(0, shown - 1),
  ]);
  if (limits.error) throw limits.error;
  if (history.error) throw history.error;

  const rows = await buildHistoryRows(admin, history.data as HistoryEvent[], limits.data as ClickLimit[]);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">Clicked too fast</h2>
      <ClickTabs active="history" />
      <p className="text-sm text-text-secondary">
        Every pause, automatic ban and admin release, newest first. Kept for a year, also after an account is deleted.
      </p>
      <ClickHistory rows={rows} />
      <ShowMore shown={shown} total={history.count ?? 0} />
    </section>
  );
}

type HistoryEvent = {
  id: number;
  // Empty once the account is deleted.
  user_id: string | null;
  email: string | null;
  feature: string;
  kind: HistoryRow["kind"];
  pause_minutes: number | null;
  streak: number | null;
  created_at: string;
};

/** The list's rows. Times are counted from now, so the server's time zone doesn't matter. */
async function buildHistoryRows(admin: AdminClient, events: HistoryEvent[], limits: ClickLimit[]): Promise<HistoryRow[]> {
  const now = Date.now();
  const limitByFeature = new Map(limits.map((limit) => [limit.feature, limit]));
  const names = await lookUpNames(admin, events.flatMap((event) => (event.user_id ? [event.user_id] : [])));
  return events.map((event) => {
    const limit = limitByFeature.get(event.feature);
    return {
      id: event.id,
      email: event.email ?? "(no email)",
      name: (event.user_id && names.get(event.user_id)) || "",
      isDeleted: event.user_id === null,
      label: limit?.label || event.feature,
      kind: event.kind,
      pauseMinutes: event.pause_minutes,
      streak: event.streak,
      banAfter: limit?.ban_after_pauses ?? null,
      when: timeAgo(Date.parse(event.created_at), now),
      time: event.created_at,
    };
  });
}
