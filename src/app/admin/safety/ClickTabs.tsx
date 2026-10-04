import Link from "next/link";
import { LinkPending } from "@/components/LinkPending";

/** Now / History above the Clicked too fast list, styled like the admin menu's tabs. Each one is its own page. */
export function ClickTabs({ active }: { active: "now" | "history" }) {
  return (
    <nav className="flex gap-1 p-px">
      <Tab href="/admin/safety" label="Now" isActive={active === "now"} />
      <Tab href="/admin/safety/history" label="History" isActive={active === "history"} />
    </nav>
  );
}

function Tab({ href, label, isActive }: { href: string; label: string; isActive: boolean }) {
  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`inline-flex items-center rounded-button px-3 py-2 text-sm transition-colors ${
        isActive
          ? "bg-bg-surface font-semibold text-text-primary shadow-[0_0_0_1px_var(--border-default)]"
          : "text-text-secondary hover:text-text-primary"
      }`}
    >
      {label}
      <LinkPending spinnerClassName="ml-2" />
    </Link>
  );
}
