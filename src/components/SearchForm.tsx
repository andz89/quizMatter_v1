"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { SearchIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { SEARCH_MAX_LENGTH } from "@/lib/search";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";
import { TopLoadingBar } from "./TopLoadingBar";

/**
 * A search box with its search options in a Modal (the sliders button opens it, and the box hides meanwhile;
 * `children` are the modal's rows, made with SearchField; the modal's Search keeps the box's text, or empties it
 * with `optionsClearQuery`). Nothing happens while typing: Enter or Search calls onSearch, which puts the search in
 * the page link so the server can look it up in the database. Used by the home page and Admin → Photos.
 */
export function SearchForm({
  query,
  onQueryChange,
  placeholder,
  hasOptions,
  isPending,
  onSearch,
  onClear,
  optionsClearQuery = false,
  onClearText,
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
  // Runs the search with this main text (the ✕ button passes "", before the cleared box's state has updated).
  onSearch: (query: string) => void;
  onClear: () => void;
  // The modal's Search empties the box and searches without its text (the home page: the modal has no Title row,
  // so a title nobody can see there isn't searched). Off: the modal's Search keeps the box's text.
  optionsClearQuery?: boolean;
  // What the box's ✕ does instead of searching again without the text (the home page: leave the search, like
  // "Clear search"). Not given: it empties the box and runs onSearch("").
  onClearText?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  // The modal is drawn outside this form (Modal portals into <body>), so it has its own form; its footer's Search
  // button points at it by id.
  const optionsFormId = useId();
  const search = (e: FormEvent) => {
    e.preventDefault();
    setIsOpen(false);
    onSearch(query);
  };
  const searchOptions = (e: FormEvent) => {
    // React passes a portal's events up its own tree, so without this the page's form would search a second time
    // (with the box's old text).
    e.stopPropagation();
    if (!optionsClearQuery) return search(e);
    e.preventDefault();
    setIsOpen(false);
    onQueryChange("");
    onSearch("");
  };

  return (
    <form role="search" onSubmit={search} className={`relative w-full ${className}`}>
      {isPending && <TopLoadingBar />}

      {/* Hidden (keeping its room) while the options modal is open: the modal has every field. */}
      <div className={`relative ${isOpen ? "invisible" : ""}`}>
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
          // The browser's own ✕ only empties the box, so it's hidden and ours (below) also runs the search.
          className={`w-full rounded-card border border-border-default bg-bg-surface py-3 pl-11 ${query ? "pr-46" : "pr-36"} text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary [&::-webkit-search-cancel-button]:hidden`}
        />
        <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
          {query && (
            <button
              type="button"
              onClick={() => {
                onQueryChange("");
                if (onClearText) onClearText();
                else onSearch("");
              }}
              aria-label="Clear search text"
              title="Clear search text"
              className="rounded-dropdown p-2 text-text-primary transition-colors hover:bg-accent-soft"
            >
              <XIcon size={16} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            aria-haspopup="dialog"
            aria-label="Search options"
            title="Search options"
            className={`rounded-dropdown p-2 transition-colors hover:bg-accent-soft ${hasOptions ? "text-accent" : "text-text-primary"}`}
          >
            <SlidersHorizontalIcon size={16} />
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="flex items-center gap-2 rounded-button bg-accent px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-70"
          >
            {isPending && <Spinner size={14} />}
            Search
          </button>
        </div>
      </div>

      {isOpen && (
        <Modal
          title="Search options"
          onClose={() => setIsOpen(false)}
          footer={
            <>
              <button
                type="button"
                onClick={onClear}
                className="rounded-button px-4 py-2 text-sm font-semibold text-text-secondary hover:text-text-primary"
              >
                Clear
              </button>
              <button
                type="submit"
                form={optionsFormId}
                disabled={isPending}
                className="btn-press flex items-center gap-2 rounded-button bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-70"
              >
                {isPending && <Spinner size={14} />}
                Search
              </button>
            </>
          }
        >
          {/* Enter in any field searches too. */}
          <form id={optionsFormId} onSubmit={searchOptions} className="grid grid-cols-1 items-center gap-x-4 gap-y-3 sm:grid-cols-[140px_1fr]">
            {children}
            {/* A form needs a submit button for Enter to send it; the footer's is outside this box. */}
            <button type="submit" hidden />
          </form>
        </Modal>
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
