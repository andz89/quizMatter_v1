"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LinkPending } from "@/components/LinkPending";

export type TodoCounts = { reviews: number; submissions: number; reports: number };

type Item = { href: string; label: string; superOnly?: boolean; count?: keyof TodoCounts };

// The admin pages in groups. `superOnly` ones are only for the super admin (plain admins don't see them).
// `count` is the number of things waiting, shown as a small pill when it is more than 0.
const GROUPS: { label: string; items: Item[] }[] = [
  {
    label: "To do",
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
  { label: "", items: [{ href: "/admin/activity", label: "Admin log", superOnly: true }] },
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

/** The admin pages' menu, in groups above the page. The page you're on is highlighted. */
export function AdminMenu({ isSuperAdmin, counts }: { isSuperAdmin: boolean; counts: TodoCounts }) {
  const pathname = usePathname();

  const renderItem = ({ href, label, count }: Item) => {
    const number = count ? counts[count] : 0;
    return (
      <Link
        key={href}
        href={href}
        className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-button px-3 py-2 text-sm transition-colors ${
          isCurrent(pathname, href)
            ? "bg-bg-surface font-semibold text-text-primary shadow-[0_0_0_1px_var(--border-default)]"
            : "text-text-secondary hover:text-text-primary"
        }`}
      >
        {label}
        {number > 0 && (
          <span className="rounded-dropdown bg-highlight-soft px-1.5 text-xs font-bold text-highlight-strong">{number}</span>
        )}
        <LinkPending />
      </Link>
    );
  };

  const groups = [{ label: "", items: [OVERVIEW] }, ...GROUPS]
    .map((group) => ({ ...group, items: group.items.filter((item) => isSuperAdmin || !item.superOnly) }))
    .filter((group) => group.items.length > 0);

  return (
    // Below `sm`: one row that scrolls sideways, groups split by a line. From `sm`: each group under its label.
    <nav className="flex gap-1 overflow-x-auto p-px sm:flex-wrap sm:gap-x-6 sm:gap-y-3 sm:overflow-visible">
      {groups.map((group, index) => (
        <div
          key={index}
          className={`flex shrink-0 flex-col gap-1 sm:gap-1 ${index > 0 ? "border-l border-border-default pl-1 sm:border-l-0 sm:pl-0" : ""}`}
        >
          <span className="hidden px-3 text-[11px] font-bold uppercase tracking-[0.05em] text-text-header sm:block">
            {group.label || "\u00a0"}
          </span>
          <div className="flex gap-1">{group.items.map(renderItem)}</div>
        </div>
      ))}
    </nav>
  );
}
