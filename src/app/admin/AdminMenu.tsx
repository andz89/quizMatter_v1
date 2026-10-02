"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LinkPending } from "@/components/LinkPending";

// The admin pages. Add more here (e.g. teachers, usage numbers).
const ITEMS = [
  { href: "/admin", label: "Photos" },
  { href: "/admin/presentations", label: "Presentations" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/teachers", label: "Teachers" },
  { href: "/admin/cleanup", label: "Photo cleanup" },
];

/** The admin pages' menu, a row of tabs above the page. The page you're on is highlighted. */
export function AdminMenu() {
  const pathname = usePathname();
  return (
    // On narrow phones the row scrolls sideways instead of breaking the page.
    <nav className="flex gap-1 overflow-x-auto p-px">
      {ITEMS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={`shrink-0 whitespace-nowrap rounded-button px-3 py-2 text-sm transition-colors ${
            pathname === href
              ? "bg-bg-surface font-semibold text-text-primary shadow-[0_0_0_1px_var(--border-default)]"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          {label}
          <LinkPending />
        </Link>
      ))}
    </nav>
  );
}
