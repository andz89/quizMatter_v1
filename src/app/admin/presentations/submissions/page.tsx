import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon } from "lucide-react";
import { LinkPending } from "@/components/LinkPending";
import { getAccount } from "@/lib/account";
import { timeAgo } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type SubmissionRow = { presentation_id: string; title: string; editor_name: string; editor_email: string; submitted_at: string };

/**
 * Admin → Presentations → Submissions: editors' presentations waiting for QuizMatter, oldest first. Each opens its
 * page, to approve or send back (see the quizmatter_submissions migration). (../../layout.tsx checks the user is an
 * admin.)
 */
export default async function AdminSubmissionsPage() {
  // The layout checks too, but a layout doesn't run again on every request, so the page checks next to its data.
  if (!(await getAccount()).isAdmin) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_submissions");
  if (error) throw error;
  const rows = withWhen(data as SubmissionRow[]);

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
          <p className="px-5 py-12 text-center text-sm text-text-secondary">No presentations are waiting.</p>
        ) : (
          rows.map((row) => (
            <Link
              key={row.presentation_id}
              href={`/admin/presentations/submissions/${row.presentation_id}`}
              className="flex min-h-14 items-center gap-4 border-b border-border-default px-5 py-3 transition-colors last:border-b-0 hover:bg-bg-page"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-text-primary">{row.title || "Untitled presentation"}</p>
                <p className="mt-0.5 truncate text-[13px] text-text-secondary">
                  {row.editor_name} · {row.editor_email} · {row.when}
                </p>
              </div>
              <LinkPending />
            </Link>
          ))
        )}
      </div>
    </>
  );
}

/** Each row with when it was submitted, e.g. "Submitted 2 hr ago". */
function withWhen(rows: SubmissionRow[]): (SubmissionRow & { when: string })[] {
  const now = Date.now();
  return rows.map((row) => ({ ...row, when: `Submitted ${timeAgo(Date.parse(row.submitted_at), now).toLowerCase()}` }));
}
