"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { SearchIcon, SlidersHorizontalIcon } from "lucide-react";
import { SEARCH_MAX_LENGTH } from "@/lib/search";
import { Spinner } from "./Spinner";
import { TopLoadingBar } from "./TopLoadingBar";

/**
 * A search box with a Gmail-style panel of search options under it (the sliders button opens it; `children` are
 * the panel's rows, made with SearchField). Nothing happens while typing: Enter or Search calls onSearch, which
 * puts the search in the page link so the server can look it up in the database. Used by the home page and
 * Admin → Photos.
 */
export function SearchForm({
  query,
  onQueryChange,
  placeholder,
  hasOptions,
  isPending,
  onSearch,
  onClear,
  className = "",
  children,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  placeholder: string;
  // Any option besides the main text is set, so the sliders button shows it.
  hasOptions: boolean;
  // While the results load: the top line and the Spinner show.
  isPending: boolean;
  onSearch: () => void;
  onClear: () => void;
  className?: string;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Like a menu: a click outside the box or Escape closes the panel.
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!formRef.current?.contains(e.target as Node)) setIsOpen(false);
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
    <form
      ref={formRef}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        setIsOpen(false);
        onSearch();
      }}
      className={`relative w-full ${className}`}
    >
      {isPending && <TopLoadingBar />}

      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-text-primary">
          <SearchIcon size={16} />
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          maxLength={SEARCH_MAX_LENGTH}
          placeholder={placeholder}
          aria-label={placeholder}
          className={`w-full rounded-card border border-border-default bg-bg-surface py-3 pl-11 ${isOpen ? "pr-14" : "pr-36"} text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary`}
        />
        <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            aria-expanded={isOpen}
            aria-label="Search options"
            title="Search options"
            className={`rounded-dropdown p-2 transition-colors hover:bg-accent-soft ${hasOptions || isOpen ? "text-accent" : "text-text-primary"}`}
          >
            <SlidersHorizontalIcon size={16} />
          </button>
          {/* The open panel has its own Search button, so this one hides until the panel closes. */}
          {!isOpen && (
            <button
              type="submit"
              disabled={isPending}
              className="flex items-center gap-2 rounded-button bg-accent px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-70"
            >
              {isPending && <Spinner size={14} />}
              Search
            </button>
          )}
        </div>
      </div>

      {isOpen && (
        <div className="absolute top-full right-0 left-0 z-30 mt-2 rounded-card border border-border-default bg-bg-surface px-5 py-4">
          <div className="grid grid-cols-1 items-center gap-x-4 gap-y-3 sm:grid-cols-[140px_1fr]">{children}</div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClear}
              className="rounded-button px-4 py-2 text-sm font-semibold text-text-secondary hover:text-text-primary"
            >
              Clear
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="btn-press flex items-center gap-2 rounded-button bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-70"
            >
              {isPending && <Spinner size={14} />}
              Search
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

/** One row of the search options panel: a label, then its box. */
export function SearchField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="contents">
      <span className="text-sm text-text-secondary">{label}</span>
      {children}
    </label>
  );
}

const optionInputClass =
  "w-full rounded-input border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-text-secondary";

export function SearchTextInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} maxLength={SEARCH_MAX_LENGTH} className={optionInputClass} />;
}

export function SearchSelect<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} className={optionInputClass}>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
