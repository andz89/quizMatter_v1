"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Spinner } from "@/components/Spinner";
import { removePresentations } from "../actions";
import { FolderIcon, GlobeIcon, SearchIcon, Trash2Icon } from "lucide-react";

export type PresentationRow = {
  id: string;
  title: string;
  // Grade, subject… ("" if none), shown under the title and searched too.
  meta: string;
  // Full grade names when the meta line shortens Kindergarten to "K" (shown as its tooltip).
  metaTitle?: string;
  // "draft" = sent by Claude, not saved yet (it lives in the drafts database for a day).
  status: "saved" | "draft";
  // A draft Claude is still checking: shown as "Checking…" and not openable until the final version comes.
  checking?: boolean;
  // Shown after the meta line as a green "Published" with a globe icon.
  isPublished?: boolean;
  slideCount: number;
  sortTime: number;
  dateLabel: string;
  note?: string;
  // Which of my folders it's in, if any (see the folders migration).
  folderId?: string;
};

// The folder filter: every folder, no folder, or one folder's id.
const ALL_FOLDERS = "";
const NO_FOLDER = "none";

type Filter = "all" | "saved" | "draft";

// Checkbox, title, folder, status, slides, updated, trash. On phones: checkbox, title, then the rest in one cell.
const COLUMNS = "grid-cols-[16px_minmax(0,1fr)_auto] sm:grid-cols-[16px_minmax(0,1fr)_120px_96px_64px_112px_36px]";

/** Deletes saved presentations and discards drafts in one call. False if anything failed. */
function removeRows(rows: PresentationRow[]) {
  return removePresentations(
    rows.filter((row) => row.status === "saved").map((row) => row.id),
    rows.filter((row) => row.status === "draft").map((row) => row.id),
  );
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "saved", label: "Saved" },
  { id: "draft", label: "Drafts" },
];

/**
 * The presentation list: saved presentations and Claude's drafts together, with a filter and a search box. Rows can
 * be checked and deleted together, and filtered by folder.
 */
export function PresentationList({ rows, folders }: { rows: PresentationRow[]; folders: { id: string; name: string }[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [folderFilter, setFolderFilter] = useState(ALL_FOLDERS);
  const folderName = new Map(folders.map((folder) => [folder.id, folder.name]));
  const inFolderFilter = (row: PresentationRow) =>
    folderFilter === ALL_FOLDERS || (folderFilter === NO_FOLDER ? !row.folderId : row.folderId === folderFilter);
  const [search, setSearch] = useState("");
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [isDeleting, startDeleting] = useTransition();

  const query = search.trim().toLowerCase();
  const shown = rows.filter(
    (row) => (filter === "all" || row.status === filter) && inFolderFilter(row) && `${row.title} ${row.meta} ${row.isPublished ? "published" : ""}`.toLowerCase().includes(query),
  );
  const countOf = (id: Filter) => (id === "all" ? rows.length : rows.filter((row) => row.status === id).length);

  // Only rows you can see count, so a filter or search never deletes something hidden.
  const checked = shown.filter((row) => checkedIds.has(row.id));
  const allChecked = shown.length > 0 && checked.length === shown.length;

  const toggle = (id: string) =>
    setCheckedIds((ids) => {
      const next = new Set(ids);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const toggleAll = () => setCheckedIds(new Set(allChecked ? [] : shown.map((row) => row.id)));

  const deleteChecked = () => {
    const count = checked.length;
    if (!confirm(`Delete ${count} ${count === 1 ? "presentation" : "presentations"}? This can't be undone.`)) return;
    startDeleting(async () => {
      if (await removeRows(checked)) setCheckedIds(new Set());
      else alert("Couldn't delete some presentations. Please try again.");
    });
  };

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

        {folders.length > 0 && (
          <select
            value={folderFilter}
            onChange={(e) => setFolderFilter(e.target.value)}
            aria-label="Folder"
            className="rounded-input border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-text-secondary"
          >
            <option value={ALL_FOLDERS}>All folders</option>
            <option value={NO_FOLDER}>No folder</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        )}

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

      {checked.length > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-card border border-border-default bg-bg-surface px-5 py-2.5">
          <span className="text-sm font-semibold text-text-primary">{checked.length} selected</span>
          <button
            type="button"
            onClick={() => setCheckedIds(new Set())}
            disabled={isDeleting}
            className="text-sm text-text-secondary transition-colors hover:text-text-primary"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={deleteChecked}
            disabled={isDeleting}
            className="ml-auto flex items-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {isDeleting && <Spinner size={14} />}
            {isDeleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-card border border-border-default bg-bg-surface">
        <div
          className={`grid ${COLUMNS} items-center gap-4 border-b border-border-default px-5 py-3 text-[11px] font-bold tracking-[0.05em] text-text-header uppercase`}
        >
          <input
            type="checkbox"
            checked={allChecked}
            // Half-checked ("–") when only some rows are checked.
            ref={(el) => {
              if (el) el.indeterminate = checked.length > 0 && !allChecked;
            }}
            onChange={toggleAll}
            disabled={shown.length === 0 || isDeleting}
            aria-label="Select all presentations"
            className="h-4 w-4 accent-accent"
          />
          <span>Title</span>
          <span className="hidden sm:block">Folder</span>
          <span className="hidden sm:block">Status</span>
          <span className="hidden sm:block">Slides</span>
          <span className="hidden sm:block">Updated</span>
          <span className="hidden sm:block" />
        </div>

        {shown.length === 0 ? (
          <EmptyState hasPresentations={rows.length > 0} search={search.trim()} />
        ) : (
          shown.map((row) => (
            <PresentationListRow
              key={row.id}
              row={row}
              folderName={row.folderId ? folderName.get(row.folderId) : undefined}
              isChecked={checkedIds.has(row.id)}
              onToggle={() => toggle(row.id)}
              isBeingDeleted={isDeleting && checkedIds.has(row.id)}
            />
          ))
        )}
      </div>
    </>
  );
}

function PresentationListRow({
  row,
  folderName,
  isChecked,
  onToggle,
  isBeingDeleted,
}: {
  row: PresentationRow;
  folderName?: string;
  isChecked: boolean;
  onToggle: () => void;
  isBeingDeleted: boolean;
}) {
  const [isRemoving, startRemoving] = useTransition();
  const isDraft = row.status === "draft";
  const href = isDraft ? `/presentation/new?draft=${row.id}` : `/presentation/${row.id}/edit`;
  const titleClass = "block truncate text-sm";

  const remove = () => {
    const question = isDraft ? `Discard "${row.title}"? Claude's draft will be deleted.` : `Delete "${row.title}"? This can't be undone.`;
    if (!confirm(question)) return;
    startRemoving(async () => {
      if (!(await removeRows([row]))) alert("Couldn't delete the presentation. Please try again.");
    });
  };

  return (
    // The link stretches over the whole row (its ::after), so the row clicks through to the presentation while
    // the Discard button, sitting above it, stays its own button.
    <div
      className={`relative grid min-h-14 ${COLUMNS} items-center gap-x-4 border-b border-border-default px-5 py-3 transition-colors last:border-b-0 ${
        row.checking ? "" : "hover:bg-bg-page"
      } ${isRemoving || isBeingDeleted ? "opacity-50" : ""}`}
    >
      {/* z-10 keeps it above the row link's ::after, so checking doesn't open the presentation. */}
      <input
        type="checkbox"
        checked={isChecked}
        onChange={onToggle}
        disabled={isBeingDeleted}
        aria-label={`Select ${row.title}`}
        className="relative z-10 h-4 w-4 accent-accent"
      />
      <div className="min-w-0">
        {row.checking ? (
          <span className={`${titleClass} text-text-secondary`}>{row.title}</span>
        ) : (
          // Opens in a new tab, so the list stays open in this one. No prefetch: a new tab can't use it.
          <Link href={href} target="_blank" prefetch={false} className={`${titleClass} text-text-primary after:absolute after:inset-0`}>
            {row.title}
          </Link>
        )}
        {(row.meta || row.note || row.isPublished) && (
          <p title={row.metaTitle} className="mt-0.5 flex items-center gap-1.5 truncate text-[13px] text-text-secondary">
            {row.meta}
            {row.meta && row.isPublished && " ·"}
            {row.isPublished && (
              <span className="inline-flex items-center gap-1 font-semibold text-success-strong">
                <GlobeIcon size={12} />
                Published
              </span>
            )}
            {row.note && `${row.meta || row.isPublished ? "· " : ""}${row.note}`}
          </p>
        )}
        {/* On phones the other columns are hidden, so their facts go under the title. */}
        <p className="mt-0.5 truncate text-[13px] text-text-secondary sm:hidden">
          {row.slideCount} {row.slideCount === 1 ? "slide" : "slides"} · {row.dateLabel}
          {folderName && ` · ${folderName}`}
        </p>
      </div>

      <div className="flex items-center gap-2 sm:contents">
        <span className="hidden min-w-0 items-center gap-1.5 text-sm text-text-primary sm:flex">
          {folderName ? (
            <>
              <FolderIcon size={14} className="shrink-0 text-accent" />
              <span className="truncate">{folderName}</span>
            </>
          ) : (
            <span className="text-text-secondary">–</span>
          )}
        </span>
        {row.checking ? <CheckingPill /> : <StatusPill status={row.status} />}
        <span className="hidden text-sm text-text-primary sm:block">{row.slideCount}</span>
        <span className="hidden text-sm text-text-secondary sm:block">{row.dateLabel}</span>
        <span className="relative flex justify-end">
          {isRemoving || isBeingDeleted ? (
            <span className="flex p-1.5">
              <Spinner size={16} />
            </span>
          ) : (
            <button
              type="button"
              onClick={remove}
              title={isDraft ? "Discard draft" : "Delete presentation"}
              aria-label={`${isDraft ? "Discard" : "Delete"} ${row.title}`}
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

function StatusPill({ status }: { status: PresentationRow["status"] }) {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-dropdown px-2.5 py-1 text-[13px] leading-none font-semibold ${
        status === "saved" ? "bg-success-soft text-success-strong" : "bg-highlight-soft text-highlight-strong"
      }`}
    >
      {status === "saved" ? "Saved" : "Draft"}
    </span>
  );
}

/** Claude is still checking this draft. */
function CheckingPill() {
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-dropdown border border-border-default bg-bg-page px-2.5 py-1 text-[13px] leading-none font-semibold text-text-secondary">
      <Spinner size={12} />
      Checking…
    </span>
  );
}

function EmptyState({ hasPresentations, search }: { hasPresentations: boolean; search: string }) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-sm font-semibold text-text-primary">
        {hasPresentations ? (search ? `No presentations match “${search}”` : "Nothing here yet") : "No presentations yet"}
      </p>
      <p className="mt-1 text-sm text-text-secondary">
        {hasPresentations
          ? "Try another search or filter."
          : "Click “+ New presentation” to make one, or ask Claude to send you one."}
      </p>
    </div>
  );
}
