import type { ReactNode } from "react";
import Link from "next/link";
import { LinkPending } from "@/components/LinkPending";
import { Logo } from "@/components/Logo";
import { NavBar, navLinkClass } from "@/components/NavBar";
import { getAccount } from "@/lib/account";

/**
 * The Privacy and Terms pages (linked from the footer). Open to logged-out visitors too (see src/proxy.ts), so they
 * get a plain top bar with a Log in link instead of the account menu.
 */
export default async function LegalLayout({ children }: { children: ReactNode }) {
  const account = await getAccount();
  return (
    <>
      {account.id ? (
        <NavBar />
      ) : (
        <nav className="border-b border-border-default bg-bg-surface">
          <div className="flex w-full items-center gap-2 px-4 py-3 sm:px-6">
            <Link href="/login" className="mr-auto" aria-label="QuizMatter login">
              <Logo />
              <LinkPending />
            </Link>
            <Link href="/login" className={navLinkClass}>
              Log in
              <LinkPending />
            </Link>
          </div>
        </nav>
      )}
      <main className="mx-auto w-full max-w-2xl px-4 py-10">
        <article className="rounded-card border border-border-default bg-bg-surface px-5 py-8">{children}</article>
      </main>
    </>
  );
}
