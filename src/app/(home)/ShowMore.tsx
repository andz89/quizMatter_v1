"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LinkPending } from "@/components/LinkPending";
import { MAX_SHOWN, PAGE_SIZE } from "../homeSearch";

/**
 * "Show more": the same page with 20 more cards (`shown` in the link), keeping the scroll. Hidden once all show, or
 * at the most allowed. Admin → Presentations passes its own `step` and `max`.
 */
export function ShowMore({
  shown,
  total,
  step = PAGE_SIZE,
  max = MAX_SHOWN,
}: {
  shown: number;
  total: number;
  step?: number;
  max?: number;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  if (shown >= total || shown >= max) return null;
  const next = new URLSearchParams(params ?? undefined);
  next.set("shown", String(shown + step));
  return (
    <div className="mt-6 flex flex-col items-center gap-2">
      <Link
        href={`${pathname}?${next}`}
        scroll={false}
        className="flex items-center gap-2 rounded-button border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary hover:bg-bg-page"
      >
        Show more
        <LinkPending spinnerClassName="ml-1" />
      </Link>
      <p className="text-[13px] text-text-secondary">
        Showing {shown} of {total}
      </p>
    </div>
  );
}
