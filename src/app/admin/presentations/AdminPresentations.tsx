"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Spinner } from "@/components/Spinner";
import { FluidSlidePreview } from "@/components/presentation/FluidSlidePreview";
import { CANVAS_WIDTH, CANVAS_HEIGHT, getSlideNumbers } from "@/lib/constants";
import { joinParts } from "@/lib/format";
import type { Slide } from "@/lib/schema";
import { removePresentations } from "../../actions";
import { setShared } from "./actions";
import { SearchIcon, Trash2Icon } from "lucide-react";

export type AdminPresentationRow = {
  id: string;
  title: string;
  // Grade, subject ("" if none), shown under the title and searched too.
  meta: string;
  isShared: boolean;
  // Drawn as the row's picture. null = no picture (Claude's drafts, or a slide that didn't pass the schema).
  firstSlide: Slide | null;
  // Set on a draft Claude sent that isn't saved yet: "checking" = Claude is still checking it (can't open yet).
  claudeDraft?: "ready" | "checking" | "unfinished";
  slideCount: number;
  createdAt: number;
  updatedAt: number;
  createdLabel: string;
  updatedLabel: string;
};

type Sort = "updatedAt" | "createdAt";

const SORTS: { id: Sort; label: string }[] = [
  { id: "updatedAt", label: "Last changed" },
  { id: "createdAt", label: "Newest" },
];

// Picture, title, status, slides, date, share button, trash. On phones: picture, title, then the rest in one cell.
const COLUMNS =
  "grid-cols-[64px_minmax(0,1fr)_auto] sm:grid-cols-[96px_minmax(0,1fr)_88px_56px_104px_112px_36px]";

/**
 * The admin's QuizMatter presentations as a table, sorted by date changed or created, with a search box. Each
 * row can be shared with every teacher (or made a draft again) and deleted. Claude's drafts that aren't saved yet
 * are listed too: they open in the editor, and Save makes them QuizMatter presentations.
 */
export function AdminPresentations({ rows }: { rows: AdminPresentationRow[] }) {
  const [sort, setSort] = useState<Sort>("updatedAt");
  const [search, setSearch] = useState("");

  const query = search.trim().toLowerCase();
  const shown = rows
    .filter((row) =>
      `${row.title} ${row.meta} ${row.isShared ? "shared" : "draft"}`
        .toLowerCase()
        .includes(query),
    )
    .sort((a, b) => b[sort] - a[sort]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {SORTS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={sort === id}
              onClick={() => setSort(id)}
              className={`rounded-button px-3 py-1.5 text-sm transition-colors ${
                sort === id
                  ? "bg-bg-surface font-semibold text-text-primary shadow-[0_0_0_1px_var(--border-default)]"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="relative ml-auto w-full sm:w-64">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-primary">
            <SearchIcon size={16} />
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search presentations"
            aria-label="Search presentations"
            className="w-full rounded-input border border-border-default bg-bg-surface py-2 pr-3 pl-9 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary"
          />
        </label>
      </div>

      <div className="overflow-hidden rounded-card border border-border-default bg-bg-surface">
        <div
          className={`grid ${COLUMNS} items-center gap-4 border-b border-border-default px-5 py-3 text-[11px] font-bold tracking-[0.05em] text-text-header uppercase`}
        >
          <span />
          <span>Title</span>
          <span className="hidden sm:block">Status</span>
          <span className="hidden sm:block">Slides</span>
          <span className="hidden sm:block">
            {sort === "updatedAt" ? "Changed" : "Created"}
          </span>
          <span className="hidden sm:block" />
          <span className="hidden sm:block" />
        </div>

        {shown.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm font-semibold text-text-primary">
              {rows.length === 0
                ? "No QuizMatter presentations yet"
                : `No presentations match “${search.trim()}”`}
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              {rows.length === 0
                ? "Click “+ New presentation” to make one for every teacher."
                : "Try another search."}
            </p>
          </div>
        ) : (
          shown.map((row) => (
            <Row
              key={row.id}
              row={row}
              dateLabel={
                sort === "updatedAt" ? row.updatedLabel : row.createdLabel
              }
            />
          ))
        )}
      </div>
    </>
  );
}

function Row({
  row,
  dateLabel,
}: {
  row: AdminPresentationRow;
  dateLabel: string;
}) {
  const [isSharing, startSharing] = useTransition();
  const [isRemoving, startRemoving] = useTransition();

  const toggleShared = () =>
    startSharing(async () => {
      if (!(await setShared(row.id, !row.isShared)))
        toast.error("Couldn't change it. Please try again.");
      else if (row.isShared)
        toast.success("Back to a draft — only you can see it.");
      else toast.success("Shared — every teacher has it now.");
    });

  const isClaudeDraft = row.claudeDraft !== undefined;
  const isChecking = row.claudeDraft === "checking";

  const remove = () => {
    const question = isClaudeDraft
      ? `Discard "${row.title}"? Claude's draft will be deleted.`
      : `Delete "${row.title}"? Teachers won't see it anymore. This can't be undone.`;
    if (!confirm(question)) return;
    startRemoving(async () => {
      const removed = isClaudeDraft
        ? await removePresentations([], [row.id])
        : await removePresentations([row.id], []);
      if (removed)
        toast.success(
          isClaudeDraft ? "Draft discarded." : "Presentation deleted.",
        );
      else toast.error("Couldn't delete it. Please try again.");
    });
  };

  return (
    // The link stretches over the whole row (its ::after); the buttons sit above it (z-10).
    <div
      className={`relative grid min-h-14 ${COLUMNS} items-center gap-x-4 border-b border-border-default px-5 py-3 transition-colors last:border-b-0 ${isChecking ? "" : "hover:bg-bg-page"} ${
        isRemoving ? "opacity-50" : ""
      }`}
    >
      <div
        className="relative overflow-hidden rounded-dropdown border border-border-default"
        style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
      >
        {row.firstSlide ? (
          // The first slide, so a question there is number 1 (unless taken out of the numbers).
          <FluidSlidePreview
            slide={row.firstSlide}
            questionNumber={getSlideNumbers([row.firstSlide]).get(
              row.firstSlide.id,
            )}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-bg-page">
            {isChecking && <Spinner size={12} />}
          </div>
        )}
      </div>

      <div className="min-w-0">
        {isChecking ? (
          <span className="block truncate text-sm text-text-secondary">
            {row.title}
          </span>
        ) : (
          <Link
            href={
              isClaudeDraft
                ? `/presentation/new?draft=${row.id}`
                : `/presentation/${row.id}/edit`
            }
            // Opens in a new tab, so the list stays open in this one.
            target="_blank"
            className="block truncate text-sm text-text-primary after:absolute after:inset-0"
          >
            {row.title}
          </Link>
        )}
        {(row.meta || isClaudeDraft) && (
          <p className="mt-0.5 truncate text-[13px] text-text-secondary">
            {joinParts([
              row.meta,
              isClaudeDraft &&
                (isChecking
                  ? "From Claude · checking the layout"
                  : "From Claude · not saved yet"),
            ])}
          </p>
        )}
        {/* On phones the other columns are hidden, so their facts go under the title. */}
        <p className="mt-0.5 text-[13px] text-text-secondary sm:hidden">
          {row.slideCount} {row.slideCount === 1 ? "slide" : "slides"} ·{" "}
          {dateLabel}
        </p>
      </div>

      <div className="flex items-center gap-2 sm:contents">
        {isChecking ? (
          <span className="inline-flex w-fit items-center gap-1.5 rounded-dropdown border border-border-default bg-bg-page px-2.5 py-1 text-[13px] leading-none font-semibold text-text-secondary">
            <Spinner size={12} />
            Checking…
          </span>
        ) : (
          <span
            className={`inline-flex w-fit items-center rounded-dropdown px-2.5 py-1 text-[13px] leading-none font-semibold ${
              row.isShared
                ? "bg-accent-soft text-accent"
                : "bg-highlight-soft text-highlight-strong"
            }`}
          >
            {row.isShared ? "Shared" : isClaudeDraft ? "Not saved" : "Draft"}
          </span>
        )}
        <span className="hidden text-sm text-text-primary sm:block">
          {row.slideCount}
        </span>
        <span className="hidden text-sm text-text-secondary sm:block">
          {dateLabel}
        </span>
        {/* A draft from Claude must be opened and saved before it can be shared. */}
        {isClaudeDraft ? (
          <span className="hidden sm:block" />
        ) : (
          <button
            type="button"
            onClick={toggleShared}
            disabled={isSharing || isRemoving}
            className="relative z-10 flex items-center justify-center gap-2 rounded-dropdown border border-border-default bg-bg-surface px-2.5 py-1.5 text-[13px] font-semibold text-text-primary transition-colors hover:bg-bg-page disabled:opacity-60"
          >
            {isSharing && <Spinner size={12} />}
            {row.isShared ? "Make draft" : "Share"}
          </button>
        )}
        <span className="relative z-10 flex justify-end">
          {isRemoving ? (
            <span className="flex p-1.5">
              <Spinner size={16} />
            </span>
          ) : (
            <button
              type="button"
              onClick={remove}
              title="Delete presentation"
              aria-label={`Delete ${row.title}`}
              className="rounded-dropdown p-1.5 text-text-primary transition-colors hover:bg-border-default"
            >
              <Trash2Icon size={16} />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
