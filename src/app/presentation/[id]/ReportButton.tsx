"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FlagIcon } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { REPORT_REASON_LABELS, type ReportReason } from "@/lib/schema";
import { reportPresentation } from "./actions";

/** "Report" on another teacher's presentation: pick a reason, add a note if you like, and the admins get it. */
export function ReportButton({ presentationId, className }: { presentationId: string; className: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [isSending, startSending] = useTransition();

  const send = () =>
    startSending(async () => {
      if (!reason) return;
      const result = await reportPresentation(presentationId, reason, note);
      if (result === "failed") {
        toast.error("Couldn't send the report. Please try again.");
        return;
      }
      toast.success(result === "already" ? "You already reported this presentation." : "Thanks, an admin will look at it.");
      setIsOpen(false);
    });

  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)} className={`inline-flex items-center gap-2 ${className}`}>
        <FlagIcon size={16} />
        Report
      </button>

      {isOpen && (
        <Modal title="Report this presentation" onClose={() => setIsOpen(false)} isBusy={isSending}>
          <p className="mb-3 text-sm text-text-secondary">What&apos;s wrong with it? Only admins see your report.</p>
          <div className="flex flex-col gap-2">
            {(Object.keys(REPORT_REASON_LABELS) as ReportReason[]).map((id) => (
              <label
                key={id}
                className={`flex cursor-pointer items-center gap-3 rounded-input border px-4 py-3 text-sm text-text-primary transition-colors ${
                  reason === id ? "border-accent bg-accent-soft" : "border-border-default hover:bg-bg-page"
                }`}
              >
                <input
                  type="radio"
                  name="report-reason"
                  checked={reason === id}
                  onChange={() => setReason(id)}
                  className="accent-accent"
                />
                {REPORT_REASON_LABELS[id]}
              </label>
            ))}
          </div>

          <label className="mt-4 block">
            <span className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">Note (optional)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Tell the admins more, e.g. which slide."
              className="mt-1 w-full resize-none rounded-input border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary"
            />
          </label>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={send}
              disabled={!reason || isSending}
              className="inline-flex items-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {isSending && <Spinner size={14} />}
              Send report
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
