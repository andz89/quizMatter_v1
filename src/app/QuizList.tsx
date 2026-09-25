"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { discardDraft } from "./actions";

export type QuizRow = {
  id: string;
  title: string;
  // "draft" = sent by Claude, not saved yet (it lives in the drafts database for a day).
  status: "saved" | "draft";
  slideCount: number;
  sortTime: number;
  dateLabel: string;
  note?: string;
};

type Filter = "all" | "saved" | "draft";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "saved", label: "Saved" },
  { id: "draft", label: "Drafts" },
];

/** The quiz list: saved quizzes and Claude's drafts together, with a filter and a search box. */
export function QuizList({ rows }: { rows: QuizRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const query = search.trim().toLowerCase();
  const shown = rows.filter(
    (row) => (filter === "all" || row.status === filter) && row.title.toLowerCase().includes(query),
  );
  const countOf = (id: Filter) => (id === "all" ? rows.length : rows.filter((row) => row.status === id).length);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`rounded-button px-3 py-1.5 text-sm transition-colors ${
                filter === id
                  ? "bg-bg-surface font-semibold text-text-primary shadow-[0_0_0_1px_var(--border-default)]"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {label} <span className="font-normal text-text-secondary">({countOf(id)})</span>
            </button>
          ))}
        </div>

        <label className="relative ml-auto w-full sm:w-64">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-primary">
            <SearchIcon />
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search quizzes"
            aria-label="Search quizzes"
            className="w-full rounded-input border border-border-default bg-bg-surface py-2 pr-3 pl-9 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary"
          />
        </label>
      </div>

      <div className="overflow-hidden rounded-card border border-border-default bg-bg-surface">
        <div className="hidden grid-cols-[minmax(0,1fr)_96px_64px_112px_36px] items-center gap-4 border-b border-border-default px-5 py-3 text-[11px] font-bold tracking-[0.05em] text-text-header uppercase sm:grid">
          <span>Title</span>
          <span>Status</span>
          <span>Slides</span>
          <span>Updated</span>
          <span />
        </div>

        {shown.length === 0 ? (
          <EmptyState hasQuizzes={rows.length > 0} search={search.trim()} />
        ) : (
          shown.map((row) => <QuizListRow key={row.id} row={row} />)
        )}
      </div>
    </>
  );
}

function QuizListRow({ row }: { row: QuizRow }) {
  const [isDiscarding, startDiscarding] = useTransition();
  const href = row.status === "draft" ? `/quiz/new?draft=${row.id}` : `/quiz/${row.id}`;

  const discard = () => {
    if (!confirm(`Discard "${row.title}"? Claude's draft will be deleted.`)) return;
    startDiscarding(() => discardDraft(row.id));
  };

  return (
    // The link stretches over the whole row (its ::after), so the row clicks through to the quiz while
    // the Discard button, sitting above it, stays its own button.
    <div
      className={`relative grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-border-default px-5 py-3 transition-colors last:border-b-0 hover:bg-bg-page sm:grid-cols-[minmax(0,1fr)_96px_64px_112px_36px] ${
        isDiscarding ? "opacity-50" : ""
      }`}
    >
      <div className="min-w-0">
        <Link href={href} className="block truncate text-sm text-text-primary after:absolute after:inset-0">
          {row.title}
        </Link>
        {row.note && <p className="mt-0.5 truncate text-[13px] text-text-secondary">{row.note}</p>}
        {/* On phones the other columns are hidden, so their facts go under the title. */}
        <p className="mt-0.5 text-[13px] text-text-secondary sm:hidden">
          {row.slideCount} {row.slideCount === 1 ? "slide" : "slides"} · {row.dateLabel}
        </p>
      </div>

      <div className="flex items-center gap-2 sm:contents">
        <StatusPill status={row.status} />
        <span className="hidden text-sm text-text-primary sm:block">{row.slideCount}</span>
        <span className="hidden text-sm text-text-secondary sm:block">{row.dateLabel}</span>
        <span className="relative flex justify-end">
          {row.status === "draft" && (
            <button
              type="button"
              onClick={discard}
              disabled={isDiscarding}
              title="Discard draft"
              aria-label={`Discard ${row.title}`}
              className="rounded-dropdown p-1.5 text-text-primary transition-colors hover:bg-border-default"
            >
              <TrashIcon />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: QuizRow["status"] }) {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-dropdown px-2.5 py-1 text-[13px] leading-none font-semibold text-white ${
        status === "saved" ? "bg-accent-green" : "bg-accent-orange"
      }`}
    >
      {status === "saved" ? "Saved" : "Draft"}
    </span>
  );
}

function EmptyState({ hasQuizzes, search }: { hasQuizzes: boolean; search: string }) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-sm font-semibold text-text-primary">
        {hasQuizzes ? (search ? `No quizzes match “${search}”` : "Nothing here yet") : "No quizzes yet"}
      </p>
      <p className="mt-1 text-sm text-text-secondary">
        {hasQuizzes
          ? "Try another search or filter."
          : "Click “+ New quiz” to make one, or ask Claude to send you one."}
      </p>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4M6.75 6.75v4M9.25 6.75v4" />
    </svg>
  );
}
