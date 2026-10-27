"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRightIcon, ExternalLinkIcon, HeartIcon } from "lucide-react";
import { FACEBOOK_URL } from "@/lib/support";
import { KeepFreeModal } from "./KeepFree";
import { LinkPending } from "./LinkPending";
import { Logo } from "./Logo";
import { SupportEmail } from "./SupportEmail";

const linkClass = "text-sm font-semibold text-text-primary transition-colors hover:text-accent";
const smallLinkClass = "font-semibold text-text-secondary transition-colors hover:text-accent";

// The editor fills the whole screen, so it has no footer.
const isEditorPage = (path: string) => path === "/presentation/new" || /^\/presentation\/[^/]+\/edit$/.test(path);
// Logged-out pages don't ask for support.
const isLoginPage = (path: string) => path === "/login" || path === "/signup";

function Dot({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`size-1 rounded-full bg-border-default ${className}`} />;
}

/**
 * The footer under every page but the editor (in the root layout). Computers: one row, the logo, © and the
 * Privacy / Terms links on the left, "Keep QuizMatter free" (not on login / sign up), Facebook and the support email
 * on the right. Tablets and phones: all of it centered and stacked, with a short line about QuizMatter.
 */
export function Footer() {
  const path = usePathname();
  const [isKeepFreeOpen, setIsKeepFreeOpen] = useState(false);
  if (path && isEditorPage(path)) return null;

  return (
    <footer className="mt-auto border-t border-border-default bg-bg-surface">
      {/* Stacked in this order on small screens; `lg:order-*` makes the one row on computers. */}
      <div className="flex w-full flex-col items-center gap-3 px-4 py-6 text-center sm:px-6 lg:flex-row lg:gap-4 lg:py-4 lg:text-left">
        <Logo size={22} />
        <p className="text-sm text-text-secondary lg:hidden">Fun quizzes and lessons for the classroom.</p>
        <div className="flex flex-wrap items-center justify-center gap-3 lg:order-3 lg:ml-auto">
          {path && !isLoginPage(path) && (
            <>
              <button
                type="button"
                onClick={() => setIsKeepFreeOpen(true)}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent transition-colors hover:text-accent-hover"
              >
                <HeartIcon size={14} />
                QuizMatter is free. Help keep it running
                <ArrowRightIcon size={14} />
              </button>
              <Dot className="hidden sm:block" />
            </>
          )}
          <a href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1.5 ${linkClass}`}>
            Facebook
            <ExternalLinkIcon size={14} />
          </a>
          {/* Phones put the email on its own line, so no dot there. */}
          <Dot className="hidden sm:block" />
          <span className="text-sm">
            <SupportEmail />
          </span>
        </div>
        {isKeepFreeOpen && <KeepFreeModal onClose={() => setIsKeepFreeOpen(false)} />}
        <div className="flex items-center gap-3 text-xs text-text-secondary lg:order-2">
          © {new Date().getFullYear()} QuizMatter
          <Dot />
          <Link href="/privacy" className={smallLinkClass}>
            Privacy
            <LinkPending />
          </Link>
          <Dot />
          <Link href="/terms" className={smallLinkClass}>
            Terms
            <LinkPending />
          </Link>
        </div>
      </div>
    </footer>
  );
}
