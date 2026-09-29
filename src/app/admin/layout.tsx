import Link from "next/link";
import { notFound } from "next/navigation";
import { LinkPending } from "@/components/LinkPending";
import { NavBar, navLinkClass } from "@/components/NavBar";
import { getAccount } from "@/lib/account";
import { AdminMenu } from "./AdminMenu";

/**
 * Every admin page: a header and a left menu. Anyone who isn't an admin gets "page not found", so teachers
 * don't learn it exists. (The database rules still block non-admins from changing anything.)
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const { isAdmin } = await getAccount();
  if (!isAdmin) notFound();

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

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-extrabold text-text-primary">Admin</h1>
          <p className="mt-1 text-sm text-text-secondary">Things only admins can change, for every teacher.</p>
        </header>

        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <AdminMenu />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </main>
    </>
  );
}
