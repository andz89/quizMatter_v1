"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckIcon, UndoIcon } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";
import { REVIEW_NOTE_MAX_LENGTH, reviewNoteSchema } from "@/lib/schema";
import { approveSubmission, sendBackSubmission } from "../../actions";

/** Approve (QuizMatter gets its own shared copy) or Send back (with a note for the editor). */
export function SubmissionDecision({ presentationId }: { presentationId: string }) {
  const router = useRouter();
  const [isBusy, startTransition] = useTransition();
  // The send-back note being typed, while its window is open (null = closed).
  const [note, setNote] = useState<string | null>(null);

  const approve = () => {
    if (!confirm("Approve it? QuizMatter gets its own copy, shared with every teacher right away, with the editor as the Author.")) return;
    startTransition(async () => {
      const error = await approveSubmission(presentationId);
      if (error) return void toast.error(error);
      toast.success("Approved. It's now shared with every teacher, under QuizMatter.");
      router.push("/admin/presentations/submissions");
    });
  };

  const sendBack = (e: React.FormEvent) => {
    e.preventDefault();
    // Checked with zod before it's sent (see CLAUDE.md, "Saving Data"); the server action checks it again.
    const parsed = reviewNoteSchema.safeParse(note ?? "");
    if (!parsed.success) return void toast.error(parsed.error.issues[0].message);
    startTransition(async () => {
      const error = await sendBackSubmission(presentationId, parsed.data);
      if (error) return void toast.error(error);
      toast.success("Sent back to the editor.");
      router.push("/admin/presentations/submissions");
    });
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setNote("")}
        disabled={isBusy}
        className="inline-flex items-center gap-2 rounded-button border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-page disabled:opacity-60"
      >
        <UndoIcon size={16} />
        Send back
      </button>
      <button
        type="button"
        onClick={approve}
        disabled={isBusy}
        className="inline-flex items-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
      >
        {isBusy && note === null ? <Spinner size={14} /> : <CheckIcon size={16} />}
        Approve
      </button>
      {isBusy && <TopLoadingBar />}

      {note !== null && (
        <Modal title="Send back to the editor" onClose={() => setNote(null)} isBusy={isBusy}>
          <form onSubmit={sendBack} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">What should they change?</span>
              <textarea
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={REVIEW_NOTE_MAX_LENGTH}
                rows={4}
                placeholder="e.g. Slide 4's answer is wrong, and please add a reference."
                className="w-full resize-y rounded-input border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary"
              />
            </label>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isBusy || !note.trim()}
                className="inline-flex items-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
              >
                {isBusy && <Spinner size={14} />}
                Send back
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
