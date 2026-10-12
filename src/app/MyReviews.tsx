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
 * An editor's reviews in the Reviews & submissions tab, as a table: open ones and canceled ones (until someone
 * starts a new round). The title opens its page (Continue review is there).
 */
export function ReviewsTable({ rows }: { rows: MyReviewRow[] }) {
  return (
    // Scrolls sideways on narrow phones instead of breaking the page.
    <div className="overflow-x-auto rounded-card border border-border-default bg-bg-surface">
      <table className="w-full min-w-[480px] text-left text-sm">
        <thead className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">
          <tr className="border-b border-border-default">
            <th className="px-5 py-2.5">Presentation</th>
            <th className="px-3 py-2.5">Status</th>
            <th className="px-5 py-2.5">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const status = reviewStatus(row);
            return (
              <tr key={row.presentation_id} className="border-b border-border-default last:border-b-0">
                <td className="max-w-64 px-5 py-3">
                  <Link
                    href={`/presentation/${row.presentation_id}`}
                    className="block truncate font-semibold text-text-primary hover:text-accent"
                  >
                    {row.title || "Untitled presentation"}
                    <LinkPending />
                  </Link>
                </td>
                <td className="px-3 py-3">
                  <span
                    className={`rounded-dropdown px-2.5 py-1 text-[13px] leading-none font-semibold whitespace-nowrap ${status.className}`}
                  >
                    {status.label}
                  </span>
                </td>
                {/* The admin's note, while a sent-back round is being reviewed again. */}
                <td className="px-5 py-3 text-text-secondary">{row.status === "reviewing" ? (row.admin_note ?? "") : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// The round's label and color.
function reviewStatus(row: MyReviewRow) {
  if (row.status === "canceled") {
    return {
      label: row.canceled_by_admin ? "Canceled by QuizMatter" : "Canceled by you",
      className: "bg-danger-soft text-danger-strong",
    };
  }
  if (row.status === "submitted") return { label: "Waiting for QuizMatter", className: "bg-bg-page text-text-secondary" };
  if (row.admin_note) return { label: "Sent back", className: "bg-highlight-soft text-highlight-strong" };
  return { label: "Reviewing", className: "bg-accent-soft text-accent" };
}
