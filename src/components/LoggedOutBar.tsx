import Link from "next/link";
import { LinkPending } from "@/components/LinkPending";
import { Logo } from "@/components/Logo";
import { navLinkClass } from "@/components/NavBar";

/**
 * The top bar for logged-out visitors on the pages they may open (the public home, Privacy, Terms, a published
 * presentation's public preview): the logo (to the public home) and Log in, instead of the account menu.
 */
export function LoggedOutBar() {
  return (
    <nav className="border-b border-border-default bg-bg-surface">
      <div className="flex w-full items-center gap-2 px-4 py-3 sm:px-6">
        <Link href="/" className="mr-auto" aria-label="QuizMatter home">
          <Logo />
          <LinkPending />
        </Link>
        <Link href="/login" className={navLinkClass}>
          Log in
          <LinkPending />
        </Link>
      </div>
    </nav>
  );
}
