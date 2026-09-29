"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LinkPending } from "@/components/LinkPending";

// The admin pages. Add more here (e.g. teachers, usage numbers).
const ITEMS = [
  { href: "/admin", label: "Photos" },
  { href: "/admin/presentations", label: "Presentations" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/cleanup", label: "Photo cleanup" },
];

/** The admin pages' left menu (a row on phones). The page you're on is highlighted. */
export function AdminMenu() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 sm:w-44 sm:shrink-0 sm:flex-col">
      {ITEMS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={`rounded-button px-3 py-2 text-sm transition-colors ${
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
