"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LinkPending } from "@/components/LinkPending";

// The admin pages. `superOnly` ones are only for the super admin (plain admins don't see them).
const ITEMS = [
  { href: "/admin", label: "Photos" },
  { href: "/admin/presentations", label: "Presentations" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/teachers", label: "Teachers", superOnly: true },
  { href: "/admin/editors", label: "Editors" },
  { href: "/admin/safety", label: "Safety", superOnly: true },
  { href: "/admin/cleanup", label: "Photo cleanup", superOnly: true },
];

// "/admin" is only its own page; the others also cover the pages inside them (e.g. Safety → History).
const isCurrent = (pathname: string | null, href: string) =>
  pathname === href || (href !== "/admin" && !!pathname?.startsWith(`${href}/`));

/** The admin pages' menu, a row of tabs above the page. The page you're on is highlighted. */
export function AdminMenu({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const pathname = usePathname();
  return (
    // On narrow phones the row scrolls sideways instead of breaking the page.
    <nav className="flex gap-1 overflow-x-auto p-px">
      {ITEMS.filter((item) => isSuperAdmin || !item.superOnly).map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={`shrink-0 whitespace-nowrap rounded-button px-3 py-2 text-sm transition-colors ${
            isCurrent(pathname, href)
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
