import Link from "next/link";
import { ClipboardCheckIcon } from "lucide-react";
import { LinkPending } from "@/components/LinkPending";

export type MyReviewRow = { presentation_id: string; title: string; status: "reviewing" | "submitted"; admin_note: string | null };

/** An editor's open reviews, above their presentations. Opening one goes to its page (Continue review is there). */
export function MyReviews({ rows }: { rows: MyReviewRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="mb-6 rounded-card border border-border-default bg-bg-surface px-5 py-3.5">
      <h2 className="mb-2 flex items-center gap-2 text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">
        <ClipboardCheckIcon size={14} />
        My reviews
      </h2>
      {rows.map((row) => {
        const status =
          row.status === "submitted"
            ? { label: "Waiting for QuizMatter", className: "bg-bg-page text-text-secondary" }
            : row.admin_note
              ? { label: "Sent back", className: "bg-highlight-soft text-highlight-strong" }
              : { label: "Reviewing", className: "bg-accent-soft text-accent" };
        return (
          <Link
            key={row.presentation_id}
            href={`/presentation/${row.presentation_id}`}
            className="-mx-2 flex min-h-12 items-center gap-3 rounded-dropdown px-2 transition-colors hover:bg-bg-page"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{row.title || "Untitled presentation"}</span>
            <span className={`rounded-dropdown px-2.5 py-1 text-[13px] leading-none font-semibold ${status.className}`}>
              {status.label}
            </span>
            <LinkPending />
          </Link>
        );
      })}
    </section>
  );
}
