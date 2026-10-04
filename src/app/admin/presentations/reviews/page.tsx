import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import { LinkPending } from "@/components/LinkPending";
import { timeAgo } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type ReviewRow = {
  presentation_id: string;
  title: string;
  reviewer_name: string;
  status: "reviewing" | "submitted" | "canceled";
  started_at: string;
  submitted_at: string | null;
  ended_at: string | null;
};

const STATUS = {
  submitted: { label: "Waiting for you", className: "bg-highlight-soft text-highlight-strong" },
  reviewing: { label: "Reviewing", className: "bg-accent-soft text-accent" },
  canceled: { label: "Canceled", className: "bg-bg-page text-text-secondary" },
};

/**
 * Admin → Presentations → Under review: every review going on (and canceled ones, until a new review starts).
 * Submitted ones open the review page, to publish or send back. (../../layout.tsx checks the user is an admin.)
 */
export default async function AdminReviewsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_reviews");
  if (error) throw error;
  const rows = withWhen(data as ReviewRow[]);

  return (
    <>
      <Link
        href="/admin/presentations"
        className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary transition-colors hover:text-text-primary"
      >
        <ChevronLeftIcon size={16} />
        Presentations
        <LinkPending />
      </Link>

      <div className="overflow-hidden rounded-card border border-border-default bg-bg-surface">
        {rows.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-text-secondary">No presentations are under review.</p>
        ) : (
          rows.map((row) => {
            const content = (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-text-primary">{row.title || "Untitled presentation"}</p>
                  <p className="mt-0.5 truncate text-[13px] text-text-secondary">
                    {row.reviewer_name} · {row.when}
                  </p>
                </div>
                <span className={`rounded-dropdown px-2.5 py-1 text-[13px] leading-none font-semibold ${STATUS[row.status].className}`}>
                  {STATUS[row.status].label}
                </span>
              </>
            );
            const rowClass = "flex min-h-14 items-center gap-4 border-b border-border-default px-5 py-3 last:border-b-0";
            return row.status === "submitted" ? (
              <Link
                key={row.presentation_id}
                href={`/admin/presentations/reviews/${row.presentation_id}`}
                className={`${rowClass} transition-colors hover:bg-bg-page`}
              >
                {content}
                <LinkPending />
              </Link>
            ) : (
              <div key={row.presentation_id} className={rowClass}>
                {content}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

/** Each row with when its status began, e.g. "Submitted 2 hr ago". */
function withWhen(rows: ReviewRow[]): (ReviewRow & { when: string })[] {
  const now = Date.now();
  return rows.map((row) => {
    const at = row.status === "submitted" ? row.submitted_at : row.status === "canceled" ? row.ended_at : row.started_at;
    const verb = row.status === "submitted" ? "Submitted" : row.status === "canceled" ? "Canceled" : "Started";
    return { ...row, when: at ? `${verb} ${timeAgo(Date.parse(at), now)}` : verb };
  });
}
