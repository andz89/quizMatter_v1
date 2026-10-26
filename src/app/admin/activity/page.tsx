import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { FormPending } from "@/components/FormPending";
import { LinkPending } from "@/components/LinkPending";
import { getAccount } from "@/lib/account";
import { ADMIN_ACTION_LABELS, adminActionSchema, type AdminAction } from "@/lib/adminActions";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 50;

type Row = {
  id: number;
  admin_id: string | null;
  admin_name: string;
  action: AdminAction;
  target_type: string;
  target_id: string | null;
  target_title: string;
  details: { reason?: string; note?: string; feature?: string; count?: number; old_name?: string } | null;
  created_at: string;
};

// A bad value in the address is ignored.
const adminSchema = z.uuid().optional().catch(undefined);
const actionSchema = adminActionSchema.optional().catch(undefined);
const pageSchema = z.coerce.number().int().min(1).max(100000).catch(1);

const selectClass = "rounded-input border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary";
const headerClass = "px-4 py-3 text-[11px] font-bold tracking-[0.05em] text-text-header uppercase";

// "Oct 23, 2026, 3:40 PM" (same time zone as the other dates in the app).
function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });
}

function detailsText(row: Row): string {
  const d = row.details;
  if (!d) return "";
  if (row.action === "category_renamed" && d.old_name) return `was ${d.old_name}`;
  if (d.reason) return d.reason;
  if (d.note) return d.note;
  if (d.feature) return d.feature;
  if (d.count !== undefined) return String(d.count);
  return "";
}

/**
 * Admin → Admin log (super admin only): every admin action, newest first, 50 a page. Filters are `?admin=<id>`,
 * `?action=<key>` and `?page=<n>`. (The database also refuses anyone but the super admin.)
 */
export default async function AdminActivityPage({ searchParams }: PageProps<"/admin/activity">) {
  if (!(await getAccount()).isSuperAdmin) notFound();
  const params = await searchParams;
  const admin = adminSchema.parse(params.admin);
  const action = actionSchema.parse(params.action);
  const page = pageSchema.parse(params.page);

  const supabase = await createClient();
  let query = supabase.from("admin_actions").select("*").order("created_at", { ascending: false }).order("id", { ascending: false });
  if (admin) query = query.eq("admin_id", admin);
  if (action) query = query.eq("action", action);
  // One extra row tells us whether there is a next page.
  const from = (page - 1) * PAGE_SIZE;
  const [log, names] = await Promise.all([
    query.range(from, from + PAGE_SIZE),
    // Reads the newest rows only (the API caps how many rows one read returns).
    supabase
      .from("admin_actions")
      .select("admin_id, admin_name")
      .not("admin_id", "is", null)
      .order("created_at", { ascending: false }),
  ]);
  if (log.error) throw log.error;
  if (names.error) throw names.error;
  const all = log.data as Row[];
  const rows = all.slice(0, PAGE_SIZE);
  const hasNext = all.length > PAGE_SIZE;

  const admins = [...new Map(names.data.map((r) => [r.admin_id as string, r.admin_name as string]))].sort((a, b) =>
    a[1].localeCompare(b[1]),
  );

  // Link a presentation only if it still exists.
  const presentationIds = [
    ...new Set(rows.filter((r) => r.target_type === "presentation" && r.target_id).map((r) => r.target_id as string)),
  ];
  const existing = new Set<string>();
  if (presentationIds.length > 0) {
    const { data, error } = await supabase.from("presentations").select("id").in("id", presentationIds);
    if (error) throw error;
    for (const p of data) existing.add(p.id);
  }

  const pageHref = (n: number) => {
    const q = new URLSearchParams();
    if (admin) q.set("admin", admin);
    if (action) q.set("action", action);
    q.set("page", String(n));
    return `/admin/activity?${q}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <Form action="/admin/activity" className="flex flex-wrap items-center gap-2">
        <select name="admin" defaultValue={admin ?? ""} aria-label="Admin" className={selectClass}>
          <option value="">All admins</option>
          {admins.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select name="action" defaultValue={action ?? ""} aria-label="Action" className={selectClass}>
          <option value="">All actions</option>
          {Object.entries(ADMIN_ACTION_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
        >
          Filter
        </button>
        <FormPending />
      </Form>

      <div className="overflow-x-auto rounded-card border border-border-default bg-bg-surface">
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-text-secondary">No admin actions yet.</p>
        ) : (
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-border-default">
                <th className={headerClass}>When</th>
                <th className={headerClass}>Admin</th>
                <th className={headerClass}>Action</th>
                <th className={headerClass}>What</th>
                <th className={headerClass}>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border-default last:border-b-0">
                  <td className="px-4 py-3 whitespace-nowrap text-text-secondary">{formatWhen(row.created_at)}</td>
                  <td className="px-4 py-3 font-semibold text-text-primary">{row.admin_name}</td>
                  <td className="px-4 py-3 text-text-secondary">{ADMIN_ACTION_LABELS[row.action] ?? row.action}</td>
                  <td className="px-4 py-3 text-text-primary">
                    {row.target_type === "presentation" && row.target_id && existing.has(row.target_id) ? (
                      <Link href={`/presentation/${row.target_id}`} className="font-semibold text-accent hover:underline">
                        {row.target_title}
                        <LinkPending />
                      </Link>
                    ) : (
                      row.target_title
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{detailsText(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(page > 1 || hasNext) && (
        <div className="flex justify-between text-sm font-semibold">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="text-accent hover:underline">
              Previous
              <LinkPending />
            </Link>
          ) : (
            <span />
          )}
          {hasNext && (
            <Link href={pageHref(page + 1)} className="text-accent hover:underline">
              Next
              <LinkPending />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
