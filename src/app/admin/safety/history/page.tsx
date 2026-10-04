import { notFound } from "next/navigation";
import { getAccount } from "@/lib/account";
import { timeAgo } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { ClickHistory, type HistoryRow } from "../ClickHistory";
import { ClickTabs } from "../ClickTabs";
import { lookUpEmails, type AdminClient, type ClickLimit } from "../data";

// The newest events shown.
const HISTORY_ROWS = 20;

/**
 * Admin → Safety → History: the newest pauses, automatic bans and admin releases (the click_history table, which has
 * no policies, so it needs the secret key).
 */
export default async function AdminSafetyHistoryPage() {
  // The layout checks too, but a layout doesn't run again on every request, so the page checks next to its data.
  if (!(await getAccount()).isAdmin) notFound();
  const admin = createAdminClient();
  if (!admin) {
    return (
      <p className="rounded-card border border-border-default bg-bg-surface px-5 py-12 text-center text-sm text-text-secondary">
        This page needs the secret key SUPABASE_SECRET_KEY on the server.
      </p>
    );
  }

  const [limits, history] = await Promise.all([
    admin.from("click_limits").select("*"),
    admin
      .from("click_history")
      .select("id, user_id, feature, kind, pause_minutes, streak, created_at")
      .order("created_at", { ascending: false })
      .limit(HISTORY_ROWS),
  ]);
  if (limits.error) throw limits.error;
  if (history.error) throw history.error;

  const rows = await buildHistoryRows(admin, history.data as HistoryEvent[], limits.data as ClickLimit[]);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">Clicked too fast</h2>
      <ClickTabs active="history" />
      <p className="text-sm text-text-secondary">
        Every pause, automatic ban and admin release, newest first (the last {HISTORY_ROWS}).
      </p>
      <ClickHistory rows={rows} />
    </section>
  );
}

type HistoryEvent = {
  id: number;
  user_id: string;
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
  const emails = await lookUpEmails(admin, events.map((event) => event.user_id));
  return events.map((event) => {
    const limit = limitByFeature.get(event.feature);
    return {
      id: event.id,
      email: emails.get(event.user_id) ?? "",
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
