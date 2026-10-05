import Link from "next/link";
import { LinkPending } from "@/components/LinkPending";

export type MyReviewRow = {
  presentation_id: string;
  title: string;
  status: "reviewing" | "submitted" | "canceled";
  admin_note: string | null;
  canceled_by_admin: boolean;
};

/**
 * Rows of an editor's reviews in the My reviews tab: open ones ("In progress") or canceled ones ("Canceled", until
 * someone starts a new round). Opening one goes to its page (Continue review is there).
 */
export function ReviewRows({ rows }: { rows: MyReviewRow[] }) {
  return (
    <div className="rounded-card border border-border-default bg-bg-surface px-5 py-3.5">
      {rows.map((row) => {
        const status =
          row.status === "canceled"
            ? {
                label: row.canceled_by_admin ? "Canceled by QuizMatter" : "Canceled by you",
                className: "bg-danger-soft text-danger-strong",
              }
            : row.status === "submitted"
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
    </div>
  );
}
