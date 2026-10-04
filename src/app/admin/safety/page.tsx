import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { ShieldIcon } from "lucide-react";
import { getAccount } from "@/lib/account";
import { MAX_PHOTO_FILE_BYTES, MAX_STORED_PHOTO_BYTES } from "@/lib/constants";
import { PHOTO_TICKET_LIFETIME_MS } from "@/lib/photoTickets";
import { REFUSALS } from "@/lib/presentations";
import { MAX_PRESENTATIONS, MAX_SAVED, MAX_SLIDES, WRITES_PER_MINUTE } from "@/lib/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { timeAgo } from "@/lib/format";
import { ClickTabs } from "./ClickTabs";
import { lookUpEmails, type AdminClient, type ClickLimit } from "./data";
import { PausedTeachers, type PausedRow } from "./PausedTeachers";

/**
 * Admin → Safety: every protection against misuse that works in QuizMatter, with its numbers, how many teachers
 * are paused or banned right now, and a Release button for paused teachers. The click limits come straight from the
 * click_limits table, the rest from the app's own limits, so the page stays true when a number changes.
 * click_limits and click_rate have no policies, so they need the secret key.
 */
export default async function AdminSafetyPage() {
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

  const limits = await admin.from("click_limits").select("*").order("feature");
  if (limits.error) throw limits.error;
  const clickLimits = limits.data as ClickLimit[];

  const [banned, autoBanned, pausedRows] = await Promise.all([
    admin.from("banned_users").select("user_id", { count: "exact", head: true }),
    admin.from("banned_users").select("user_id", { count: "exact", head: true }).eq("is_automatic", true),
    buildPausedRows(admin, clickLimits),
  ]);
  if (banned.error) throw banned.error;
  if (autoBanned.error) throw autoBanned.error;

  const banningLimits = clickLimits.filter((limit) => limit.ban_after_pauses);
  // Teachers, not rows: one teacher paused on two features counts once.
  const pausedNow = new Set(pausedRows.filter((row) => row.isPausedNow).map((row) => row.userId)).size;
  const repeatHours = [...new Set(clickLimits.map((limit) => limit.repeat_within_hours))].join(" or ");
  const megabytes = (bytes: number) => `${bytes / 1024 / 1024} MB`;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-text-secondary">
        Everything that stops misuse of QuizMatter, and what the teacher sees when it happens. Admins aren&apos;t
        counted by the speed limits.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Paused now" value={pausedNow} note="Teachers who clicked a feature too fast" />
        <Stat label="Banned" value={banned.count ?? 0} note="See Admin → Teachers" />
        <Stat label="Automatic bans" value={autoBanned.count ?? 0} note="Made by the app, not an admin" />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">Clicked too fast</h2>
        <ClickTabs active="now" />
        <PausedTeachers rows={pausedRows} repeatHours={repeatHours} />
      </section>

      <Group title="Speed limits">
        <Item
          name="Save speed limit"
          where="Database"
          rule={`${WRITES_PER_MINUTE} a minute each for saving presentations and uploading photos (bookmarks use their own click limit, below)`}
          sees={`“${REFUSALS.QM429}” For photos: “You're adding photos too fast. Wait a minute and try again.”`}
        />
        {clickLimits.map((limit) => (
          <Item
            key={limit.feature}
            name={`${limit.label || limit.feature} click limit`}
            where="Database"
            rule={
              `${limit.max_clicks} clicks within ${limit.per_seconds} seconds pauses it for ${duration(limit.first_pause_minutes)}. ` +
              `If it happens again within ${limit.repeat_within_hours} hours, the pause is ${duration(limit.repeat_pause_minutes)}.` +
              (limit.ban_after_pauses ? ` ${banRule(limit.ban_after_pauses)}` : "")
            }
            sees="Its buttons grey out, and a notice at the bottom says when they work again."
          />
        ))}
      </Group>

      <Group title="Bans">
        {banningLimits.map((limit) => (
          <Item
            key={limit.feature}
            name={`Automatic ban: ${limit.label || limit.feature}`}
            where="Database"
            rule={`${banRule(limit.ban_after_pauses!)} Each time must be within ${limit.repeat_within_hours} hours of the last.`}
            sees="Banned like an admin ban. Shows as “Automatic” on Admin → Teachers, where it can be lifted with Unban."
          />
        ))}
        <Item
          name="Admin ban"
          where="Database + login"
          rule="An admin bans a teacher on Admin → Teachers, with a reason"
          sees="Can't save or add photos from that moment, and can't log in again. A login that's already open stops working within the hour."
        />
      </Group>

      <Group title="Size limits">
        <Item name="Presentations per teacher" where="Database" rule={`${MAX_PRESENTATIONS} at most`} sees="Asked to delete some first." />
        <Item name="Slides per presentation" where="Database + app" rule={`${MAX_SLIDES} at most`} sees="Adding slides is greyed out at the limit." />
        <Item name="Saved presentations" where="Database" rule={`${MAX_SAVED} at most`} sees="Asked to remove some first." />
        <Item
          name="Photo size"
          where="Browser + server"
          rule={`The file ${megabytes(MAX_PHOTO_FILE_BYTES)} at most (checked in the browser); stored ${megabytes(MAX_STORED_PHOTO_BYTES)} at most after shrinking (checked on the server)`}
          sees={`“This photo is too big (${megabytes(MAX_PHOTO_FILE_BYTES)} at most).” or “This photo is too detailed to upload. Please try a smaller one.”`}
        />
        <Item
          name="Text length"
          where="App + database"
          rule="Every text that's saved has a maximum length, checked with zod in the app. The database also checks titles, reports and photo details; slide text is only limited by the slide's total size (about 2 MB)"
          sees="The text box stops at the limit, or the save is refused."
        />
      </Group>

      <Group title="Access">
        <Item
          name="Login check"
          where="Login page + Supabase"
          rule="Cloudflare Turnstile checks it's a person, not a script. Supabase Auth checks its answer (Attack Protection in the Supabase dashboard)"
          sees="A quick “are you a person” check before logging in, usually automatic."
        />
        <Item name="Own data only" where="Database" rule="Teachers can only change their own presentations, photos and bookmarks" sees="Nothing; other people's things are read only." />
        <Item name="Reports" where="Database" rule="One report per teacher per presentation; admins can hide it (Admin → Reports)" sees="“You already reported this presentation.”" />
        <Item
          name="Photos from Claude"
          where="Server"
          rule={`Only admins can use Claude. When Claude adds a photo to the shared library, it gets a one-time upload link that stops after ${duration(PHOTO_TICKET_LIFETIME_MS / 60_000)}, so nobody can reuse it. The photo then waits for an admin's review before teachers see it.`}
          sees="Nothing; teachers can't use Claude. If a link is too old, Claude simply asks for a new one."
        />
      </Group>

      <Group title="Outside the app">
        <Item
          name="Cloudflare rate limit"
          where="Cloudflare"
          rule="Counts requests per IP address. Set in the Cloudflare dashboard (Security → WAF → Rate limiting rules), not in the code"
          sees="Cloudflare's “Error 1015 — You are being rate limited” page. Teachers sharing one school network share one IP."
        />
      </Group>
    </div>
  );
}

type Streak = { user_id: string; feature: string; paused_until: string; pause_streak: number };

/**
 * The Paused teachers table: paused now (first), or paused before and still counting toward an automatic ban (the
 * pause ended less than `repeat_within_hours` ago). Times are counted from now, so the server's time zone doesn't
 * matter.
 */
async function buildPausedRows(admin: AdminClient, limits: ClickLimit[]): Promise<PausedRow[]> {
  const now = Date.now();
  // Only chains that may still count: the pause ended less than the longest repeat_within_hours ago.
  const longestRepeatHours = Math.max(0, ...limits.map((limit) => limit.repeat_within_hours));
  const { data, error } = await admin
    .from("click_rate")
    .select("user_id, feature, paused_until, pause_streak")
    .gt("pause_streak", 0)
    .gt("paused_until", new Date(now - longestRepeatHours * 3_600_000).toISOString());
  if (error) throw error;
  const streaks = data as Streak[];

  const limitByFeature = new Map(limits.map((limit) => [limit.feature, limit]));
  const current = streaks.filter((row) => {
    const limit = limitByFeature.get(row.feature);
    return limit && Date.parse(row.paused_until) > now - limit.repeat_within_hours * 3_600_000;
  });
  const emails = await lookUpEmails(admin, current.map((row) => row.user_id));

  return current
    .map((row) => {
      const limit = limitByFeature.get(row.feature)!;
      const until = Date.parse(row.paused_until);
      const isPausedNow = until > now;
      return {
        userId: row.user_id,
        email: emails.get(row.user_id) ?? "",
        feature: row.feature,
        label: limit.label || row.feature,
        status: isPausedNow
          ? `Paused for ${Math.ceil((until - now) / 60_000)} more min`
          : `Pause ended ${timeAgo(until, now).toLowerCase()}, can use it again`,
        isPausedNow,
        streak: row.pause_streak,
        banAfter: limit.ban_after_pauses,
      };
    })
    .sort((a, b) => Number(b.isPausedNow) - Number(a.isPausedNow) || b.streak - a.streak);
}

/**
 * The automatic ban, in words. The time that reaches `banAfter` bans instead of pausing (count_click), so there are
 * only banAfter − 1 pauses before it.
 */
function banRule(banAfter: number): string {
  if (banAfter === 1) return "Reaching the limit bans the teacher at once.";
  const pauses = banAfter - 1;
  return `Reaching the limit ${banAfter} times in a row bans the teacher (the first ${pauses === 1 ? "time only pauses" : `${pauses} times only pause`}).`;
}

/** 10 → "10 minutes", 60 → "1 hour", 120 → "2 hours". */
function duration(minutes: number): string {
  if (minutes % 60 === 0) return minutes === 60 ? "1 hour" : `${minutes / 60} hours`;
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

function Stat({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="rounded-card border border-border-default bg-bg-surface px-5 py-3.5">
      <p className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">{label}</p>
      <p className="mt-1 font-heading text-2xl font-extrabold text-text-primary">{value}</p>
      <p className="text-[13px] text-text-secondary">{note}</p>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">{title}</h2>
      <div className="flex flex-col divide-y divide-border-default rounded-card border border-border-default bg-bg-surface">
        {children}
      </div>
    </section>
  );
}

/** One protection: its name, where it runs, the rule, and what the teacher sees. */
function Item({ name, where, rule, sees }: { name: string; where: string; rule: string; sees: string }) {
  return (
    <div className="flex gap-3 px-5 py-3.5">
      <ShieldIcon size={16} className="mt-0.5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-text-primary">{name}</span>
          <span className="rounded-dropdown bg-bg-page px-2.5 py-1 text-[12px] leading-none font-semibold text-text-secondary">
            {where}
          </span>
        </div>
        <p className="mt-1 text-sm text-text-primary">{rule}</p>
        <p className="mt-0.5 text-[13px] text-text-secondary">Teacher sees: {sees}</p>
      </div>
    </div>
  );
}
