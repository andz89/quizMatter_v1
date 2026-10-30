"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LinkPending } from "@/components/LinkPending";
import type { TodoCounts } from "./todoCounts";

type Item = { href: string; label: string; superOnly?: boolean; count?: keyof TodoCounts };

// The admin pages in groups. `superOnly` ones are only for the super admin (plain admins don't see them).
// `count` is the number of things waiting, shown as a small pill when it is more than 0.
const GROUPS: { label: string; items: Item[] }[] = [
  {
    label: "Waiting for you",
    items: [
      { href: "/admin/presentations/reviews", label: "Under review", count: "reviews" },
      { href: "/admin/presentations/submissions", label: "Submissions", count: "submissions" },
      { href: "/admin/reports", label: "Reports", count: "reports" },
    ],
  },
  {
    label: "Library",
    items: [
      { href: "/admin/presentations", label: "Presentations" },
      { href: "/admin/photos", label: "Photos" },
      { href: "/admin/cleanup", label: "Photo cleanup", superOnly: true },
      { href: "/admin/data-check", label: "Data check", superOnly: true },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/admin/teachers", label: "Teachers", superOnly: true },
      { href: "/admin/editors", label: "Editors" },
      { href: "/admin/safety", label: "Safety", superOnly: true },
    ],
  },
  {
    label: "",
    items: [
      { href: "/admin/activity", label: "Admin log", superOnly: true },
      { href: "/admin/maintenance", label: "Maintenance", superOnly: true },
    ],
  },
];

const OVERVIEW: Item = { href: "/admin", label: "Overview" };

// "/admin" is only its own page; the others also cover the pages inside them (e.g. Safety → History).
// Presentations is not current on its reviews / submissions pages, which have their own items.
const isCurrent = (pathname: string | null, href: string) => {
  if (pathname === href) return true;
  if (href === "/admin" || !pathname?.startsWith(`${href}/`)) return false;
  if (href === "/admin/presentations") {
    return !pathname.startsWith("/admin/presentations/reviews") && !pathname.startsWith("/admin/presentations/submissions");
  }
  return true;
};

/** The admin pages' menu: a column on the left of the page, in groups. The page you're on is highlighted. */
export function AdminMenu({ isSuperAdmin, counts }: { isSuperAdmin: boolean; counts: TodoCounts }) {
  const pathname = usePathname();

  const renderItem = ({ href, label, count }: Item) => {
    const number = count ? counts[count] : 0;
    return (
      <Link
        key={href}
        href={href}
        className={`flex shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-button px-3 py-2 text-sm transition-colors ${
          isCurrent(pathname, href)
            ? "bg-accent-soft font-semibold text-accent"
            : "text-text-secondary hover:bg-bg-page hover:text-text-primary"
        }`}
      >
        {label}
        {number > 0 && (
          <span className="rounded-dropdown bg-highlight px-2 py-0.5 text-[12px] font-semibold text-text-primary">{number}</span>
        )}
        <LinkPending />
      </Link>
    );
  };

  const groups = [{ label: "", items: [OVERVIEW] }, ...GROUPS]
    .map((group) => ({ ...group, items: group.items.filter((item) => isSuperAdmin || !item.superOnly) }))
    .filter((group) => group.items.length > 0);

  return (
    // Below `lg`: one row above the page that scrolls sideways, groups split by a line, no labels.
    // From `lg`: a column on the left; each named group is a card with its label on top.
    <nav className="flex gap-1 overflow-x-auto p-px lg:flex-col lg:gap-3 lg:overflow-visible">
      {groups.map((group, index) => (
        <div
          key={index}
          className={`flex shrink-0 gap-1 lg:flex-col ${index > 0 ? "border-l border-border-default pl-1 lg:pl-0" : ""} ${
            group.label ? "lg:rounded-card lg:border lg:border-border-default lg:bg-bg-surface lg:p-2" : "lg:border-l-0"
          }`}
        >
          {group.label && (
            <span className="hidden px-3 pt-1 pb-1 text-[11px] font-bold uppercase tracking-[0.05em] text-accent lg:block">
              {group.label}
            </span>
          )}
          {group.items.map(renderItem)}
        </div>
      ))}
    </nav>
  );
}
