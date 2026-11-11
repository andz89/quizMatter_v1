import Link from "next/link";
import { notFound } from "next/navigation";
import { LinkPending } from "@/components/LinkPending";
import { NavBar, navLinkClass } from "@/components/NavBar";
import { getAccount } from "@/lib/account";
import { TwoStepSetup } from "./TwoStepSetup";

/**
 * Two-step login (admins only): set up an authenticator app. Admins land here from the admin pages until they have
 * one (src/app/admin/layout.tsx). Teachers get "page not found", like the admin pages.
 */
export default async function TwoStepPage() {
  const account = await getAccount();
  if (!account.isAdmin && account.adminRole === "none") notFound();

  return (
    <>
      <NavBar>
        <Link href="/" className={navLinkClass}>
          Home
          <LinkPending />
        </Link>
        <Link href="/account" className={navLinkClass}>
          Account
          <LinkPending />
        </Link>
      </NavBar>

      <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-extrabold text-text-primary">Two-step login</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Admins log in with their password and a code from an authenticator app (Google Authenticator, Authy, 1Password, …).
            A stolen password alone can&apos;t open the admin pages.
          </p>
        </header>
        <TwoStepSetup />
      </main>
    </>
  );
}
