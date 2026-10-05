"use client";

import { useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ShieldOffIcon } from "lucide-react";
import { LinkPending } from "@/components/LinkPending";
import { Spinner } from "@/components/Spinner";
import { setEditor } from "../teachers/actions";

export type EditorRow = {
  id: string;
  email: string;
  // Display name ("" if not set).
  name: string;
  // "Editor since 3 weeks ago · 5 published reviews · Last review 2 days ago".
  meta: string;
  isBanned: boolean;
  // The review round they have open, if any.
  openRound: { presentationId: string; title: string; status: "reviewing" | "submitted" } | null;
};

/** Every editor, with their review numbers, their open round and Remove as editor. */
export function AdminEditors({ rows }: { rows: EditorRow[] }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-secondary">
        Editors review QuizMatter presentations. Removing one cancels the review they have open. Make editors in
        Teachers.
      </p>
      {rows.length === 0 ? (
        <p className="rounded-card border border-border-default bg-bg-surface px-5 py-12 text-center text-sm text-text-secondary">
          No editors yet. Make one in Teachers.
        </p>
      ) : (
        rows.map((row) => <Row key={row.id} row={row} />)
      )}
    </div>
  );
}

function Row({ row }: { row: EditorRow }) {
  const [isBusy, startTransition] = useTransition();

  const remove = () => {
    if (!confirm(`Remove ${row.email} as editor? A review they have open is canceled.`)) return;
    startTransition(async () => {
      const error = await setEditor(row.id, false);
      if (error) toast.error(error);
      else toast.success(`${row.email} is no longer an editor.`);
    });
  };

  return (
    <div className={`rounded-card border border-border-default bg-bg-surface px-5 py-3.5 ${isBusy ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-text-primary">{row.email}</span>
            {row.name && <span className="text-sm text-text-secondary">{row.name}</span>}
            {row.isBanned && <span className={`${pillClass} bg-danger-soft text-danger-strong`}>Banned</span>}
          </div>
          <p className="mt-0.5 text-[13px] text-text-secondary">{row.meta}</p>
        </div>

        <div className="flex items-center gap-2">
          {isBusy && <Spinner size={16} />}
          <button type="button" onClick={remove} disabled={isBusy} className={removeButtonClass}>
            <ShieldOffIcon size={14} />
            Remove as editor
          </button>
        </div>
      </div>

      {row.openRound && (
        <p className="mt-3 flex flex-wrap items-center gap-2 border-t border-border-default pt-3 text-sm text-text-primary">
          {row.openRound.status === "submitted" ? (
            <>
              <span className={`${pillClass} bg-highlight-soft text-highlight-strong`}>Submitted</span>
              {/* Only a submitted review has a page to open (to publish or send back). */}
              <Link
                href={`/admin/presentations/reviews/${row.openRound.presentationId}`}
                className="truncate font-semibold text-accent hover:underline"
              >
                {row.openRound.title}
                <LinkPending />
              </Link>
            </>
          ) : (
            <>
              <span className={`${pillClass} bg-accent-soft text-accent`}>Reviewing</span>
              <span className="truncate font-semibold">{row.openRound.title}</span>
            </>
          )}
        </p>
      )}
    </div>
  );
}

const pillClass = "rounded-dropdown px-2.5 py-1 text-[13px] leading-none font-semibold";

const removeButtonClass =
  "inline-flex items-center gap-2 rounded-dropdown border border-border-default bg-bg-surface px-2.5 py-1.5 text-[13px] font-semibold text-danger-strong transition-colors hover:bg-danger-soft disabled:opacity-60";
