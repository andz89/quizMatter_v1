import type { ReactNode } from "react";
import Link from "next/link";
import { getAccount } from "@/lib/account";
import { AccountMenu } from "./AccountMenu";
import { LinkPending } from "./LinkPending";
import { Logo } from "./Logo";

/** Style for links in the bar. `aria-current="page"` marks the page you're on in violet. */
export const navLinkClass =
  "rounded-dropdown px-2.5 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-accent-soft hover:text-accent aria-[current=page]:text-accent";

/**
 * The white bar across the top of every page: the logo (a link home) on the left; the page's links and main
 * button (`children`), then the account menu, on the right. Server only (it looks up the logged-in user).
 */
export async function NavBar({ children }: { children?: ReactNode }) {
  const account = await getAccount();
  return (
    <nav className="border-b border-border-default bg-bg-surface">
      <div className="flex w-full items-center gap-2 px-4 py-3 sm:px-6">
        <Link href="/" className="mr-auto" aria-label="QuizMatter home">
          <Logo />
          <LinkPending />
        </Link>
        {children}
        <span className="ml-1">
          <AccountMenu account={account} />
        </span>
      </div>
    </nav>
  );
}
