"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIcon } from "lucide-react";
import { LinkPending } from "@/components/LinkPending";

export type HomeTab = "mine" | "quizmatter" | "reviewed" | "saved" | "teachers";

// The home page's tabs, in this order.
const TABS: { id: HomeTab; label: string; href: string }[] = [
  { id: "mine", label: "My presentations", href: "/" },
  { id: "quizmatter", label: "From QuizMatter", href: "/quizmatter" },
  // Editors only.
  { id: "reviewed", label: "My reviews", href: "/reviews" },
  { id: "saved", label: "Saved", href: "/saved" },
  { id: "teachers", label: "Other teachers", href: "/teachers" },
];

/** The home page's tabs, each a link to its own page. The open one comes from the address ("/search" has none). */
export function HomeTabs({ counts, isEditor }: { counts: Record<HomeTab, number>; isEditor: boolean }) {
  const pathname = usePathname();
  const picked = TABS.find((tab) => tab.href === pathname)?.id;
  const tabs = TABS.filter((tab) => isEditor || tab.id !== "reviewed");

  return (
    <>
      {/* Phones: the tabs fold into a burger menu. */}
      <TabMenu tabs={tabs} counts={counts} picked={picked} />
      <nav className="hidden max-w-full gap-1 overflow-x-auto rounded-button bg-bg-surface p-1 sm:flex">
        {tabs.map(({ id, label, href }) => (
          <Link
            key={id}
            href={href}
            aria-current={picked === id ? "page" : undefined}
            className={`flex shrink-0 items-center gap-2 rounded-dropdown px-3 py-1.5 text-[13px] font-semibold transition-colors ${
              picked === id ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {label}
            <span
              className={`rounded-dropdown px-1.5 text-[11px] ${
                picked === id ? "bg-white/20 text-white" : "bg-bg-page text-text-secondary"
              }`}
            >
              {counts[id]}
            </span>
            <LinkPending />
          </Link>
        ))}
      </nav>
    </>
  );
}

/**
 * The tabs on phones: a burger button with the open tab's name and count, opening a list of every tab. Closes on a
 * pick, a click outside, or Esc.
 */
function TabMenu({
  tabs,
  counts,
  picked,
}: {
  tabs: { id: HomeTab; label: string; href: string }[];
  counts: Record<HomeTab, number>;
  picked: HomeTab | undefined;
}) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(pathname);
  // Close the menu once the new page opens (not on the click, so the top line stays until then).
  if (openedAt !== pathname) {
    setOpenedAt(pathname);
    setIsOpen(false);
  }
  const menuRef = useRef<HTMLDivElement>(null);
  const pickedLabel = tabs.find(({ id }) => id === picked)?.label ?? "Search results";

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={menuRef} className="relative sm:hidden">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label="Choose a list"
        aria-expanded={isOpen}
        className="flex items-center gap-2 rounded-button border border-border-default bg-bg-surface px-3 py-2 text-[13px] font-semibold text-text-primary"
      >
        <MenuIcon size={16} />
        {pickedLabel}
        {picked && <span className="rounded-dropdown bg-bg-page px-1.5 text-[11px] text-text-secondary">{counts[picked]}</span>}
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 z-50 mt-1 w-56 rounded-card border border-border-default bg-bg-surface p-2">
          {tabs.map(({ id, label, href }) => (
            <Link
              key={id}
              href={href}
              aria-current={picked === id ? "page" : undefined}
              className={`flex w-full items-center gap-3 rounded-dropdown px-3 py-2 text-left text-sm transition-colors ${
                picked === id ? "bg-accent-soft font-semibold text-accent" : "text-text-primary hover:bg-accent-soft hover:text-accent"
              }`}
            >
              <span className="flex-1">{label}</span>
              <span className="rounded-dropdown bg-bg-page px-1.5 text-[11px] text-text-secondary">{counts[id]}</span>
              <LinkPending />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
