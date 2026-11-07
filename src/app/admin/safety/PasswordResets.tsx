import { timeAgo } from "@/lib/format";
import { RESET_REQUESTS_PER_ADDRESS, RESETS_PER_DAY } from "@/lib/passwords";
import { lookUpEmails, lookUpNames, type AdminClient } from "./data";
import { countResets, startOfManilaDay, type ResetCount } from "./resets";

// Each list shows this many; the rest are only counted ("and 4 more"). Only the shown teachers' emails are looked up.
const SHOWN = 20;
// Rows read per list, newest first. The daily account cleanup keeps only a day of rows, so this is far more than a
// normal day has.
const READ_MAX = 5000;

type ResetListRow = {
  key: string;
  // The teacher's name (else their email), or the internet address.
  title: string;
  // The teacher's email when the title is their name.
  subtitle: string;
  count: number;
  // "5 min ago" for the newest one, worked out on the server.
  when: string;
  time: string;
};
type ResetList = { rows: ResetListRow[]; more: number };
export type PasswordResetLists = { emails: ResetList; requests: ResetList };

/**
 * Today's reset emails per teacher (password_reset_sends, from midnight in the Philippines) and the last hour's
 * requests per internet address (password_reset_requests), as may_send_password_reset counts them
 * (20261231001000_password_reset_limit.sql). Neither table has policies, so this needs the secret key. Null when they
 * can't be read (e.g. that migration isn't on this database yet), so the rest of Safety still opens.
 */
export async function loadPasswordResets(admin: AdminClient): Promise<PasswordResetLists | null> {
  const now = Date.now();
  const [sends, requests] = await Promise.all([
    admin
      .from("password_reset_sends")
      .select("user_id, sent_at")
      .gte("sent_at", startOfManilaDay(now))
      .order("sent_at", { ascending: false })
      .limit(READ_MAX),
    admin
      .from("password_reset_requests")
      .select("ip, created_at")
      .gt("created_at", new Date(now - 60 * 60_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(READ_MAX),
  ]);
  if (sends.error || requests.error) {
    console.error("Admin → Safety: couldn't load the password resets", sends.error ?? requests.error);
    return null;
  }

  const teachers = countResets(sends.data.map((row) => ({ key: row.user_id, at: row.sent_at })));
  // An IPv6 address is saved as its network (2001:db8:5:6::/64): one home or school counts as one address.
  const addresses = countResets(requests.data.map((row) => ({ key: String(row.ip), at: row.created_at })));
  const shownIds = teachers.slice(0, SHOWN).map((teacher) => teacher.key);
  const [names, emails] = await Promise.all([lookUpNames(admin, shownIds), lookUpEmails(admin, shownIds)]);

  const toRow = (count: ResetCount, title: string, subtitle = ""): ResetListRow => ({
    key: count.key,
    title,
    subtitle,
    count: count.count,
    when: timeAgo(Date.parse(count.lastAt), now),
    time: count.lastAt,
  });
  return {
    emails: {
      rows: teachers.slice(0, SHOWN).map((teacher) => {
        const email = emails.get(teacher.key) ?? "";
        const name = names.get(teacher.key) ?? "";
        return toRow(teacher, name || email, name ? email : "");
      }),
      more: Math.max(0, teachers.length - SHOWN),
    },
    requests: {
      rows: addresses.slice(0, SHOWN).map((address) => toRow(address, address.key)),
      more: Math.max(0, addresses.length - SHOWN),
    },
  };
}

/** Admin → Safety's "Password resets": who asked for a new password lately, next to Forgot password's two limits. Read only. */
export function PasswordResets({ lists }: { lists: PasswordResetLists | null }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">Password resets</h2>
      <p className="text-sm text-text-secondary">
        Who asked for a new password lately. There&apos;s nothing to release: a teacher&apos;s count starts again at
        midnight (Philippine time), an address&apos;s after an hour.
      </p>
      {lists === null ? (
        <p className="rounded-card border border-border-default bg-bg-surface px-5 py-6 text-center text-sm text-text-secondary">
          Couldn&apos;t load the password resets. Is the password_reset_limit migration on this database?
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <ResetCard
            title="Reset emails today"
            note={`Each teacher gets ${RESETS_PER_DAY} a day. Only emails really sent count; more than ${RESETS_PER_DAY} means someone skipped the Forgot password page.`}
            limit={RESETS_PER_DAY}
            list={lists.emails}
            empty="No reset emails today."
          />
          <ResetCard
            title="Requests in the last hour"
            note={`Each internet address can ask ${RESET_REQUESTS_PER_ADDRESS} times an hour, also for an email with no account. On IPv6 a whole network (…/64) counts as one.`}
            limit={RESET_REQUESTS_PER_ADDRESS}
            list={lists.requests}
            empty="No requests in the last hour."
          />
        </div>
      )}
    </section>
  );
}

function ResetCard({ title, note, limit, list, empty }: { title: string; note: string; limit: number; list: ResetList; empty: string }) {
  return (
    <div className="flex flex-col rounded-card border border-border-default bg-bg-surface">
      <div className="border-b border-border-default px-5 py-3.5">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        <p className="mt-0.5 text-[13px] text-text-secondary">{note}</p>
      </div>
      {list.rows.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-text-secondary">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-default">
          {list.rows.map((row) => (
            <li key={row.key} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <span className="truncate text-sm font-semibold text-text-primary">{row.title}</span>
                {row.subtitle && <span className="truncate text-[13px] text-text-secondary">{row.subtitle}</span>}
                <span className={`${pillClass} bg-bg-page text-text-secondary`}>
                  {row.count} of {limit}
                </span>
                {row.count > limit ? (
                  <span className={`${pillClass} bg-danger-soft text-danger-strong`}>Over the limit</span>
                ) : (
                  row.count === limit && <span className={`${pillClass} bg-highlight-soft text-highlight-strong`}>Limit reached</span>
                )}
              </div>
              <time dateTime={row.time} className="text-[13px] text-text-secondary">
                {row.when}
              </time>
            </li>
          ))}
        </ul>
      )}
      {list.more > 0 && <p className="border-t border-border-default px-5 py-3 text-[13px] text-text-secondary">and {list.more} more</p>}
    </div>
  );
}

const pillClass = "rounded-dropdown px-2.5 py-1 text-[13px] leading-none font-semibold";
