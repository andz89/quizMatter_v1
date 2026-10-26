import Link from "next/link";
import { notFound } from "next/navigation";
import { LinkPending } from "@/components/LinkPending";
import { NavBar, navLinkClass } from "@/components/NavBar";
import { getAccount } from "@/lib/account";
import { AdminMenu } from "./AdminMenu";
import { getTodoCounts } from "./todoCounts";

/**
 * Every admin page: a header and a left menu. Anyone who isn't an admin gets "page not found", so teachers
 * don't learn it exists. (The database rules still block non-admins from changing anything.)
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const { isAdmin, isSuperAdmin } = await getAccount();
  if (!isAdmin) notFound();

  // What's waiting for an admin, shown as pills in the menu. If this fails, the menu just shows no pills.
  // The page may ask too (Overview, Presentations): one call, cached for the request.
  const { data } = await getTodoCounts();
  const counts = { reviews: data?.reviews ?? 0, submissions: data?.submissions ?? 0, reports: data?.reports ?? 0 };

  return (
    <>
      <NavBar>
        <Link href="/" className={navLinkClass}>
          Home
          <LinkPending />
        </Link>
        <span aria-current="page" className={navLinkClass}>
          Admin
        </span>
      </NavBar>

      <main className="w-full px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <header className="mb-6">
          <h1 className="text-2xl font-extrabold text-text-primary">Admin</h1>
          <p className="mt-1 text-sm text-text-secondary">Things only admins can change, for every teacher.</p>
        </header>

        {/* From `lg` the menu is a column on the left; below that it's a row above the page. */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
          <div className="shrink-0 lg:sticky lg:top-6 lg:w-52">
            <AdminMenu isSuperAdmin={isSuperAdmin} counts={counts} />
          </div>
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </main>
    </>
  );
}
