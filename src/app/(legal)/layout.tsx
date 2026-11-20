import type { ReactNode } from "react";
import { LoggedOutBar } from "@/components/LoggedOutBar";
import { NavBar } from "@/components/NavBar";
import { getAccount } from "@/lib/account";

/**
 * The Privacy and Terms pages (linked from the footer). Open to logged-out visitors too (see src/proxy.ts), so they
 * get a plain top bar with a Log in link instead of the account menu.
 */
export default async function LegalLayout({ children }: { children: ReactNode }) {
  const account = await getAccount();
  return (
    <>
      {account.id ? <NavBar /> : <LoggedOutBar />}
      <main className="mx-auto w-full max-w-2xl px-4 py-10">
        <article className="rounded-card border border-border-default bg-bg-surface px-5 py-8">{children}</article>
      </main>
    </>
  );
}
