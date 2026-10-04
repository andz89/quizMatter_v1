import { notFound } from "next/navigation";
import { getAccount } from "@/lib/account";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import { LinkPending } from "@/components/LinkPending";
import { timeAgo } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { CancelReviewButton } from "./CancelReviewButton";

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
 * Submitted ones open the review page, to publish or send back. Open ones can be canceled (e.g. an editor who
 * stopped answering). (../../layout.tsx checks the user is an admin.)
 */
export default async function AdminReviewsPage() {
  // The layout checks too, but a layout doesn't run again on every request, so the page checks next to its data.
  if (!(await getAccount()).isAdmin) notFound();
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
            const title = row.title || "Untitled presentation";
            return (
              // A submitted review's title link stretches over the whole row (its ::after); the button sits above it.
              <div
                key={row.presentation_id}
                className={`relative flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border-default px-5 py-3 last:border-b-0 ${
                  row.status === "submitted" ? "transition-colors hover:bg-bg-page" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  {row.status === "submitted" ? (
                    <Link
                      href={`/admin/presentations/reviews/${row.presentation_id}`}
                      className="block truncate text-sm font-semibold text-text-primary after:absolute after:inset-0"
                    >
                      {title}
                      <LinkPending />
                    </Link>
                  ) : (
                    <p className="truncate text-sm font-semibold text-text-primary">{title}</p>
                  )}
                  <p className="mt-0.5 truncate text-[13px] text-text-secondary">
                    {row.reviewer_name} · {row.when}
                  </p>
                </div>
                <span className={`rounded-dropdown px-2.5 py-1 text-[13px] leading-none font-semibold ${STATUS[row.status].className}`}>
                  {STATUS[row.status].label}
                </span>
                {row.status !== "canceled" && <CancelReviewButton presentationId={row.presentation_id} title={title} />}
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
