"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

/** Which way a row can still scroll, so only the arrows that do something show. */
const rowArrows = (row: HTMLElement) => ({
  back: row.scrollLeft > 0,
  forward: row.scrollLeft + row.clientWidth < row.scrollWidth - 1,
});

/**
 * A titled row that scrolls sideways with < > arrows (like Canva's), with "See all" if `onSeeAll` is given.
 * Used by the Photos panel (a row per category) and the Presentations panel (a row per subject).
 */
export function ScrollRow({
  name,
  icon,
  onSeeAll,
  children,
}: {
  name: string;
  // A small icon before the name (e.g. the star of a favorite category).
  icon?: ReactNode;
  onSeeAll?: () => void;
  children: ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [arrows, setArrows] = useState({ back: false, forward: false });

  // Checked again when the panel's width changes (the row) or when items come or go (the content).
  useEffect(() => {
    const row = rowRef.current;
    const content = contentRef.current;
    if (!row || !content) return;
    const observer = new ResizeObserver(() => setArrows(rowArrows(row)));
    observer.observe(row);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const scroll = (direction: 1 | -1) => {
    const row = rowRef.current;
    row?.scrollBy({ left: direction * row.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-1 text-[13px] font-semibold text-text-primary">
          {icon}
          <span className="truncate">{name}</span>
        </h3>
        {onSeeAll && (
          <button type="button" onClick={onSeeAll} className="shrink-0 text-xs font-semibold text-accent hover:underline">
            See all
          </button>
        )}
      </div>
      {/* Stretched over the panel's padding (.side-panel: 20px left, 8px right), so the items run to the panel's
          edges while they scroll; the same padding inside keeps the first one in line with the title. */}
      <div className="relative -mr-2 -ml-5">
        <div
          ref={rowRef}
          onScroll={(e) => setArrows(rowArrows(e.currentTarget))}
          className="overflow-x-auto pr-2 pl-5 [scrollbar-width:none]"
        >
          <div ref={contentRef} className="flex w-max min-w-full gap-2">
            {children}
          </div>
        </div>
        {arrows.back && <RowArrow side="back" onClick={() => scroll(-1)} />}
        {arrows.forward && <RowArrow side="forward" onClick={() => scroll(1)} />}
      </div>
    </section>
  );
}

function RowArrow({ side, onClick }: { side: "back" | "forward"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={side === "back" ? "Back" : "More"}
      className={`absolute top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border-default bg-bg-surface text-text-primary hover:bg-bg-page ${
        side === "back" ? "left-2" : "right-2"
      }`}
    >
      {side === "back" ? <ChevronLeftIcon size={16} /> : <ChevronRightIcon size={16} />}
    </button>
  );
}
