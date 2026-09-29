"use client";

import { useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { EyeIcon, EyeOffIcon, Trash2Icon } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { deleteReportedPresentation, dismissReports, setHidden } from "./actions";

export type ReportedRow = {
  id: string;
  title: string;
  // Who published it ("" if they have no display name).
  meta: string;
  isHidden: boolean;
  // Newest first. Empty for a hidden presentation nobody reported (anymore).
  reports: { reason: string; note: string; when: string }[];
};

/** The reported presentations (most reported first), and the hidden ones without reports, to unhide later. */
export function AdminReports({ reportedRows, hiddenRows }: { reportedRows: ReportedRow[]; hiddenRows: ReportedRow[] }) {
  return (
    <div className="flex flex-col gap-5">
      <section>
        <h2 className="mb-3 text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">Reported</h2>
        {reportedRows.length === 0 ? (
          <Empty title="No reports" text="When a teacher reports a presentation, it shows here." />
        ) : (
          <div className="flex flex-col gap-3">
            {reportedRows.map((row) => (
              <Row key={row.id} row={row} />
            ))}
          </div>
        )}
      </section>

      {hiddenRows.length > 0 && (
        <section>
          <h2 className="mb-3 text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">Hidden presentations</h2>
          <div className="flex flex-col gap-3">
            {hiddenRows.map((row) => (
              <Row key={row.id} row={row} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-card border border-border-default bg-bg-surface px-5 py-12 text-center">
      <p className="text-sm font-semibold text-text-primary">{title}</p>
      <p className="mt-1 text-sm text-text-secondary">{text}</p>
    </div>
  );
}

function Row({ row }: { row: ReportedRow }) {
  const [isBusy, startTransition] = useTransition();

  const toggleHidden = () =>
    startTransition(async () => {
      if (!(await setHidden(row.id, !row.isHidden))) toast.error("Couldn't change it. Please try again.");
      else toast.success(row.isHidden ? "Shown again — teachers can see it." : "Hidden — only its owner can see it now.");
    });

  const dismiss = () =>
    startTransition(async () => {
      if (await dismissReports(row.id)) toast.success("Reports dismissed.");
      else toast.error("Couldn't dismiss the reports. Please try again.");
    });

  const remove = () => {
    if (!confirm(`Delete "${row.title}"? Its owner loses it too. This can't be undone.`)) return;
    startTransition(async () => {
      if (await deleteReportedPresentation(row.id)) toast.success("Presentation deleted.");
      else toast.error("Couldn't delete it. Please try again.");
    });
  };

  return (
    <div className={`rounded-card border border-border-default bg-bg-surface px-5 py-4 ${isBusy ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/presentation/${row.id}`} target="_blank" className="truncate text-sm font-semibold text-accent hover:underline">
              {row.title}
            </Link>
            {row.isHidden && (
              <span className="rounded-dropdown bg-danger-soft px-2.5 py-1 text-[13px] leading-none font-semibold text-danger-strong">
                Hidden
              </span>
            )}
          </div>
          {row.meta && <p className="mt-0.5 text-[13px] text-text-secondary">{row.meta}</p>}
        </div>

        <div className="flex items-center gap-2">
          {isBusy && <Spinner size={16} />}
          <button type="button" onClick={toggleHidden} disabled={isBusy} className={smallButtonClass}>
            {row.isHidden ? <EyeIcon size={14} /> : <EyeOffIcon size={14} />}
            {row.isHidden ? "Unhide" : "Hide"}
          </button>
          {row.reports.length > 0 && (
            <button type="button" onClick={dismiss} disabled={isBusy} className={smallButtonClass}>
              Dismiss
            </button>
          )}
          <button
            type="button"
            onClick={remove}
            disabled={isBusy}
            title="Delete presentation"
            aria-label={`Delete ${row.title}`}
            className="rounded-dropdown p-1.5 text-danger-strong transition-colors hover:bg-danger-soft disabled:opacity-60"
          >
            <Trash2Icon size={16} />
          </button>
        </div>
      </div>

      {row.reports.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2 border-t border-border-default pt-3">
          <li className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">
            {row.reports.length} {row.reports.length === 1 ? "report" : "reports"}
          </li>
          {row.reports.map((report, index) => (
            <li key={index} className="text-sm text-text-primary">
              <span className="font-semibold">{report.reason}</span>
              <span className="text-text-secondary"> · {report.when}</span>
              {report.note && <p className="mt-0.5 whitespace-pre-line text-text-secondary">{report.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const smallButtonClass =
  "inline-flex items-center gap-2 rounded-dropdown border border-border-default bg-bg-surface px-2.5 py-1.5 text-[13px] font-semibold text-text-primary transition-colors hover:bg-bg-page disabled:opacity-60";
