"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LinkPending } from "@/components/LinkPending";

const TABS = [
  { label: "Announcements", href: "/admin/announcements" },
  { label: "Photos", href: "/admin/announcements/photos" },
];

/** Admin → Announcements' two tabs (the look of the home page's tabs), each a link to its own page. */
export function AnnouncementTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-button bg-bg-surface p-1">
      {TABS.map(({ label, href }) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href ? "page" : undefined}
          className={`flex shrink-0 items-center rounded-dropdown px-3 py-1.5 text-[13px] font-semibold transition-colors ${
            pathname === href ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary"
          }`}
        >
          {label}
          <LinkPending />
        </Link>
      ))}
    </nav>
  );
}
