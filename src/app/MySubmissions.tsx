import Link from "next/link";
import { LinkPending } from "@/components/LinkPending";
import { timeAgo } from "@/lib/format";
import { SUBMISSION_LABELS, type MySubmission } from "@/lib/submissions";

/**
 * An editor's presentations sent to QuizMatter, as a table (see the quizmatter_submissions migration). The title
 * opens my presentation; an approved one also links to QuizMatter's copy, even after I deleted my original.
 */
export function SubmissionsTable({ rows }: { rows: MySubmission[] }) {
  return (
    // Scrolls sideways on narrow phones instead of breaking the page.
    <div className="overflow-x-auto rounded-card border border-border-default bg-bg-surface">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">
          <tr className="border-b border-border-default">
            <th className="px-5 py-2.5">Presentation</th>
            <th className="px-3 py-2.5">Status</th>
            <th className="px-3 py-2.5">Note</th>
            <th className="px-5 py-2.5">Submitted</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border-default last:border-b-0">
              <td className="max-w-64 px-5 py-3">
                {row.presentationId ? (
                  <Link
                    href={`/presentation/${row.presentationId}`}
                    className="block truncate font-semibold text-text-primary hover:text-accent"
                  >
                    {row.title || "Untitled presentation"}
                    <LinkPending />
                  </Link>
                ) : (
                  <p className="truncate">
                    <span className="font-semibold text-text-primary">{row.title || "Untitled presentation"}</span>
                    <span className="text-text-secondary"> (original deleted)</span>
                  </p>
                )}
                {row.status === "approved" && row.copyId && (
                  <Link href={`/presentation/${row.copyId}`} className="text-[13px] text-accent hover:underline">
                    See it in QuizMatter
                    <LinkPending />
                  </Link>
                )}
              </td>
              <td className="px-3 py-3">
                <span
                  className={`rounded-dropdown px-2.5 py-1 text-[13px] leading-none font-semibold whitespace-nowrap ${SUBMISSION_LABELS[row.status].className}`}
                >
                  {SUBMISSION_LABELS[row.status].label}
                </span>
              </td>
              <td className="px-3 py-3 text-text-secondary">{row.status === "sent_back" ? row.adminNote : ""}</td>
              <td className="px-5 py-3 whitespace-nowrap text-text-secondary">{submittedAgo(row.submittedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** When it was last submitted, e.g. "2 hr ago". */
function submittedAgo(time: number): string {
  return timeAgo(time, Date.now());
}
