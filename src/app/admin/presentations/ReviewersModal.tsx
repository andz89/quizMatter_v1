"use client";

import { Modal } from "@/components/Modal";
import { formatDay } from "@/lib/format";
import type { ReviewerFields } from "@/lib/schema";

/** One reviewer of a presentation, with the admin who approved their review (Admin → Presentations). */
export type ApprovedReviewer = ReviewerFields & { approvedAt: string | null; approverName: string; approverEmail: string };

/** Everyone who reviewed the presentation, newest first, and who approved each review. */
export function ReviewersModal({ title, reviewers, onClose }: { title: string; reviewers: ApprovedReviewer[]; onClose: () => void }) {
  return (
    <Modal title={`Reviewed by · ${title}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {reviewers.map((reviewer) => (
          <div key={`${reviewer.email}-${reviewer.reviewedOn}`} className="rounded-card border border-border-default px-5 py-3.5 text-sm">
            <p className="font-semibold text-text-primary">{reviewer.name}</p>
            <p className="mt-0.5 text-text-secondary">
              {reviewer.email} · Reviewed {formatDay(reviewer.reviewedOn)}
            </p>
            <p className="mt-2 whitespace-pre-line text-text-primary">{reviewer.background}</p>
            <p className="mt-3 border-t border-border-default pt-2.5 text-[13px] text-text-secondary">
              Approved by{" "}
              <span className="font-semibold text-text-primary">{approverLabel(reviewer)}</span>
              {/* In the admin's own time zone: the modal only shows in the browser, after a click. */}
              {reviewer.approvedAt &&
                ` · ${new Date(reviewer.approvedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
            </p>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// "Ana Cruz (ana@school.ph)", just the email if they have no display name, or "an admin" if the account is gone.
function approverLabel(reviewer: ApprovedReviewer): string {
  if (reviewer.approverName && reviewer.approverEmail) return `${reviewer.approverName} (${reviewer.approverEmail})`;
  return reviewer.approverName || reviewer.approverEmail || "an admin";
}
