"use client";

import { useState, useSyncExternalStore } from "react";
import { LayoutGridIcon, ListIcon } from "lucide-react";

export type View = "list" | "grid";

/**
 * The List / Grid choice of an admin page (List by default), remembered in this browser under `key`.
 * The server's page is always List; the browser then shows the saved choice.
 */
export function useView(key: string) {
  const saved = useSyncExternalStore<View>(
    noChanges,
    () => (readSaved(key) === "grid" ? "grid" : "list"),
    () => "list"
  );
  // Picked on this page (it wins over the saved choice).
  const [picked, setPicked] = useState<View | null>(null);

  const changeView = (next: View) => {
    setPicked(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // Not remembered, but still switched.
    }
  };

  return [picked ?? saved, changeView] as const;
}

// The saved choice only changes through changeView, which also sets state, so nothing to listen to.
const noChanges = () => () => {};

function readSaved(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    // Storage blocked (e.g. a private window): List.
    return null;
  }
}

const OPTIONS = [
  { id: "list", label: "List", Icon: ListIcon },
  { id: "grid", label: "Grid", Icon: LayoutGridIcon },
] as const;

/** Two buttons to switch between the List and Grid views. */
export function ViewToggle({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  return (
    <div className="flex gap-1">
      {OPTIONS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={view === id}
          onClick={() => onChange(id)}
          className={`flex items-center gap-1.5 rounded-button px-2.5 py-1.5 text-[13px] transition-colors ${
            view === id
              ? "bg-bg-surface font-semibold text-text-primary shadow-[0_0_0_1px_var(--border-default)]"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          <Icon size={14} />
          {label}
        </button>
      ))}
    </div>
  );
}
