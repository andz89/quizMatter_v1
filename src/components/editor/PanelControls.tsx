"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

// Space kept between the panel and its button, and between the panel and the bottom of its area.
const PANEL_EDGE_GAP = 12;

// Where a panel that doesn't fit below its button goes: this far below the top of its area.
const PANEL_TOP_GAP = 25;

// Closes whichever tool panel is open right now, so only one is open at a time.
let closeOpenPanel: (() => void) | null = null;

/** A toolbar icon button that opens a small settings panel below it (e.g. Rotate, Set time, Edit numbers).
 * If the panel doesn't fit below, it moves up to 25px from the top of its area. */
export function ToolPanelButton({
  title,
  icon,
  wide = false,
  buttonClassName = "h-8 w-8 rounded-dropdown text-text-primary hover:bg-bg-page aria-expanded:bg-bg-page",
  panelWidthClassName,
  closeOnAnyClick = false,
  openAbove = false,
  children,
}: {
  title: string;
  icon: ReactNode;
  // Wider panel for controls that need more room (e.g. rows of number chips).
  wide?: boolean;
  // Button size and look (e.g. a big card button); aria-expanded: styles it while the panel is open.
  buttonClassName?: string;
  // Overrides the panel's width (e.g. "w-auto" to fit its content).
  panelWidthClassName?: string;
  // Close on the next click anywhere, even inside the panel — for pick-one menus (e.g. Add slide).
  closeOnAnyClick?: boolean;
  // Always open just above the button — for a button at the bottom of its area (e.g. the workspace's Add slide).
  openAbove?: boolean;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  // The panel's top, in px from the button's top; null until measured (then it sits just below the button).
  const [panelTop, setPanelTop] = useState<number | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Measured before paint, so the panel never flashes in the wrong place. The panel opens below the
  // button when it fits. If not, it moves up to sit 25px below the top of the box that cuts it off
  // (e.g. the scrolling slide area).
  useLayoutEffect(() => {
    if (!isOpen || openAbove) {
      setPanelTop(null);
      return;
    }
    const panel = panelRef.current;
    const button = buttonRef.current;
    if (!panel || !button) return;
    let clipTop = 0;
    let clipBottom = window.innerHeight;
    for (let el = panel.parentElement; el; el = el.parentElement) {
      if (getComputedStyle(el).overflowY !== "visible") {
        const box = el.getBoundingClientRect();
        clipTop = Math.max(clipTop, box.top);
        clipBottom = Math.min(clipBottom, box.bottom);
        break;
      }
    }
    const b = button.getBoundingClientRect();
    const below = b.bottom + PANEL_EDGE_GAP;
    const fitsBelow = below + panel.offsetHeight + PANEL_EDGE_GAP <= clipBottom;
    setPanelTop((fitsBelow ? below : clipTop + PANEL_TOP_GAP) - b.top);
  }, [isOpen, openAbove]);

  // Opening this panel closes the one that was open before it.
  useEffect(() => {
    if (!isOpen) return;
    const close = () => setIsOpen(false);
    closeOpenPanel?.();
    closeOpenPanel = close;
    return () => {
      if (closeOpenPanel === close) closeOpenPanel = null;
    };
  }, [isOpen]);

  // Listens on window, so a choice's own onClick runs first and then the panel closes. Clicks on
  // the toggle button are skipped — it opens/closes the panel itself.
  useEffect(() => {
    if (!isOpen || !closeOnAnyClick) return;
    const handleClick = (e: MouseEvent) => {
      if (!buttonRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [isOpen, closeOnAnyClick]);
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        title={title}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className={`flex shrink-0 items-center justify-center ${buttonClassName}`}
      >
        {icon}
      </button>
      {isOpen && (
        <div
          ref={panelRef}
          style={
            openAbove
              ? { bottom: `calc(100% + ${PANEL_EDGE_GAP}px)` }
              : { top: panelTop ?? `calc(100% + ${PANEL_EDGE_GAP}px)` }
          }
          className={`absolute left-1/2 z-30 flex -translate-x-1/2 flex-col gap-3 rounded-card border border-border-default bg-bg-surface px-4 py-3 ${panelWidthClassName ?? (wide ? "w-72" : "w-60")}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** Small uppercase label above a group of controls. */
export function PanelLabel({ children }: { children: ReactNode }) {
  return <span className="text-xs font-semibold uppercase tracking-[0.05em] text-text-header">{children}</span>;
}

/** Big centered value at the top of a panel, e.g. "3:45" or "3/4". */
export function PanelReadout({ children }: { children: ReactNode }) {
  return <span className="text-center text-base font-semibold text-text-primary tabular-nums">{children}</span>;
}

export function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="self-end text-xs font-semibold text-accent hover:opacity-80">
      Reset
    </button>
  );
}

interface PanelSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  // Shown after the value; defaults to degrees.
  unit?: string;
  onChange: (value: number) => void;
}

export function PanelSlider({ label, value, min, max, unit = "°", onChange }: PanelSliderProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex justify-between text-xs font-semibold uppercase tracking-[0.05em] text-text-header">
        {label}
        <span className="font-normal normal-case tracking-normal text-text-secondary">
          {value}
          {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--accent)]"
      />
    </label>
  );
}

/** A small pill button that's filled violet while on — used for AM/PM, step sizes, hidden numbers, etc. */
export function ToggleChip({
  active,
  onClick,
  className = "",
  children,
}: {
  active: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-dropdown border py-1 text-xs font-semibold ${
        active ? "border-accent bg-accent text-white" : "border-border-default text-text-primary hover:bg-bg-page"
      } ${className}`}
    >
      {children}
    </button>
  );
}
