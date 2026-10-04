"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { XCircleIcon } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { cancelReview } from "../actions";

/** "Cancel review" on the Under review list: ends a round its editor left open. Nothing on the live presentation changes. */
export function CancelReviewButton({ presentationId, title }: { presentationId: string; title: string }) {
  const [isBusy, startTransition] = useTransition();

  const cancel = () => {
    if (!confirm(`Cancel the review of "${title}"? The reviewer's changes are thrown away; the presentation stays as it is.`)) return;
    startTransition(async () => {
      const error = await cancelReview(presentationId);
      if (error) toast.error(error);
      else toast.success("Review canceled. The presentation can be changed again.");
    });
  };

  return (
    <button
      type="button"
      onClick={cancel}
      disabled={isBusy}
      className="relative z-10 inline-flex items-center gap-2 rounded-dropdown border border-border-default bg-bg-surface px-2.5 py-1.5 text-[13px] font-semibold text-danger-strong transition-colors hover:bg-danger-soft disabled:opacity-60"
    >
      {isBusy ? <Spinner size={12} /> : <XCircleIcon size={14} />}
      Cancel review
    </button>
  );
}
