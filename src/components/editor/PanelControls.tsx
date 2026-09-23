"use client";

import { useState, type ReactNode } from "react";

/** A toolbar icon button that opens a small settings panel below it (e.g. Rotate, Set time, Edit numbers). */
export function ToolPanelButton({
  title,
  icon,
  wide = false,
  children,
}: {
  title: string;
  icon: ReactNode;
  // Wider panel for controls that need more room (e.g. rows of number chips).
  wide?: boolean;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        title={title}
        onClick={() => setIsOpen((open) => !open)}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page ${isOpen ? "bg-bg-page" : ""}`}
      >
        {icon}
      </button>
      {isOpen && (
        <div
          className={`absolute left-1/2 top-full z-30 mt-3 flex -translate-x-1/2 flex-col gap-3 rounded-card border border-border-default bg-bg-surface px-4 py-3 ${wide ? "w-72" : "w-60"}`}
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
    <button type="button" onClick={onClick} className="self-end text-xs font-semibold text-accent-green hover:opacity-80">
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
        className="w-full accent-[var(--accent-navy)]"
      />
    </label>
  );
}

/** A small pill button that's filled navy while on — used for AM/PM, step sizes, hidden numbers, etc. */
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
        active ? "border-accent-navy bg-accent-navy text-white" : "border-border-default text-text-primary hover:bg-bg-page"
      } ${className}`}
    >
      {children}
    </button>
  );
}
