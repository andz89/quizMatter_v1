import { notFound } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { getAccount } from "@/lib/account";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildAdminRows } from "./adminRows";

/**
 * Admin → Admins (super admin only): who is an admin, view only. Admins are added and removed by hand in the
 * Supabase SQL editor (`public.admins`). Admins are a handful, so each account is read on its own with the secret key.
 */
export default async function AdminAdminsPage() {
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

  const admins = await admin.from("admins").select("user_id, is_super");
  if (admins.error) throw admins.error;
  const ids = admins.data.map((row) => row.user_id);

  const [accounts, settings] = await Promise.all([
    // An account that can't be read is left out (buildAdminRows skips it), so one bad row doesn't break the page.
    Promise.all(ids.map((id) => admin.auth.admin.getUserById(id))),
    admin.from("user_settings").select("user_id, display_name").in("user_id", ids),
  ]);
  if (settings.error) throw settings.error;

  const users = new Map<string, User>();
  for (const { data } of accounts) if (data.user) users.set(data.user.id, data.user);
  const names = new Map(settings.data.map((row) => [row.user_id, row.display_name ?? ""]));
  const rows = buildAdminRows(admins.data, users, names);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-secondary">
        Everyone who can open the admin pages. Add or remove admins in the Supabase SQL editor (the admins table).
      </p>
      {rows.map((row) => (
        <div key={row.id} className="rounded-card border border-border-default bg-bg-surface px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-text-primary">{row.email}</span>
            {row.name && <span className="text-sm text-text-secondary">{row.name}</span>}
            {row.isSuper ? (
              <span className={`${pillClass} bg-accent-soft text-accent`}>Super admin</span>
            ) : (
              <span className={`${pillClass} bg-bg-page text-text-secondary`}>Admin</span>
            )}
            {row.hasTwoStep ? (
              <span className={`${pillClass} bg-success-soft text-success-strong`}>Two-step on</span>
            ) : (
              <span className={`${pillClass} bg-highlight-soft text-highlight-strong`}>Two-step not set up</span>
            )}
          </div>
          <p className="mt-0.5 text-[13px] text-text-secondary">{row.meta}</p>
        </div>
      ))}
    </div>
  );
}

const pillClass = "rounded-dropdown px-2.5 py-1 text-[13px] leading-none font-semibold";
