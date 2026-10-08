"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EllipsisVerticalIcon, SendIcon, XCircleIcon } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";
import { saveErrorMessage } from "@/lib/presentations";
import { stopReview, submitReview } from "@/lib/reviews";
import type { ReviewerFields } from "@/lib/schema";
import { useEditorStore } from "@/lib/store";

/**
 * The reviewer's ⋮ button in the editor's top bar (next to Save as draft). It opens a menu with "Submit for
 * publishing" (which asks first, showing the "Reviewed by" name and email) and "Stop review".
 */
export function ReviewControls() {
  const router = useRouter();
  const review = useEditorStore((s) => s.review);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Closes on a click outside the menu, or on Esc (like the account menu).
  useEffect(() => {
    if (!isMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setIsMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isMenuOpen]);

  if (!review) return null;

  const stop = async () => {
    setIsMenuOpen(false);
    if (!confirm("Stop this review? Your changes are thrown away and the presentation stays as it was.")) return;
    const { presentation } = useEditorStore.getState();
    setIsStopping(true);
    try {
      await stopReview(presentation.id);
      toast.success("Review stopped. Nothing was changed.");
      // Nothing left to save, so leaving doesn't ask "Leave without saving?".
      useEditorStore.setState({ savedPresentation: presentation, review: null });
      router.push(`/presentation/${presentation.id}`);
    } catch (error) {
      toast.error(saveErrorMessage(error, "stop the review"));
      setIsStopping(false);
    }
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setIsMenuOpen((open) => !open)}
        disabled={isStopping}
        aria-label="Review actions"
        aria-expanded={isMenuOpen}
        title="Review actions"
        className="flex h-9 w-9 items-center justify-center rounded-button text-text-primary transition-colors hover:bg-bg-page disabled:opacity-60"
      >
        {isStopping ? <Spinner size={16} /> : <EllipsisVerticalIcon size={18} />}
      </button>

      {isMenuOpen && (
        <div className="absolute top-11 right-0 z-50 w-56 rounded-card border border-border-default bg-bg-surface p-2">
          <button
            type="button"
            onClick={() => {
              setIsMenuOpen(false);
              setIsFormOpen(true);
            }}
            className={menuItemClass}
          >
            <SendIcon size={16} />
            Submit for publishing
          </button>
          <button type="button" onClick={stop} className={stopItemClass}>
            <XCircleIcon size={16} />
            Stop review
          </button>
        </div>
      )}
      {isStopping && <TopLoadingBar />}
      {isFormOpen && <SubmitForm reviewer={review.fields} onClose={() => setIsFormOpen(false)} />}
    </div>
  );
}

/** Asks before sending: the draft goes to the admins, with my name and email from my account. */
function SubmitForm({ reviewer, onClose }: { reviewer: ReviewerFields; onClose: () => void }) {
  const router = useRouter();
  const [isSending, setIsSending] = useState(false);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const { presentation, savedAt } = useEditorStore.getState();
    setIsSending(true);
    try {
      await submitReview(presentation, savedAt);
      toast.success("Thanks! QuizMatter will publish this presentation in 1–2 days.");
      // Saved with the submit, so leaving doesn't ask "Leave without saving?".
      useEditorStore.setState({ savedPresentation: presentation });
      router.push(`/presentation/${presentation.id}`);
    } catch (error) {
      toast.error(saveErrorMessage(error, "submit the review"));
      setIsSending(false);
    }
  };

  return (
    <Modal title="Submit for publishing" onClose={onClose} isBusy={isSending}>
      <form onSubmit={send} className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary">
          This shows on the presentation once QuizMatter publishes your changes. Teachers keep seeing the old version
          until then.
        </p>
        <div>
          <p className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">Reviewed by</p>
          <p className="mt-1 text-sm text-text-primary">
            <span className="font-semibold">{reviewer.name}</span>
            <span className="text-text-secondary"> · {reviewer.email}</span>
          </p>
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSending}
            className="inline-flex items-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {isSending && <Spinner size={14} />}
            Submit for publishing
          </button>
        </div>
      </form>
      {isSending && <TopLoadingBar />}
    </Modal>
  );
}

/** Under the top bar, after QuizMatter sent the review back: the admin's note. */
export function ReviewBanner() {
  const note = useEditorStore((s) => s.review?.note);
  if (!note) return null;
  return (
    <p className="shrink-0 border-b border-border-default bg-highlight-soft px-4 py-2 text-sm text-text-primary">
      QuizMatter sent this back: {note}
    </p>
  );
}

const menuItemClass =
  "flex w-full items-center gap-3 rounded-dropdown px-3 py-2 text-left text-sm font-semibold text-text-primary transition-colors hover:bg-accent-soft hover:text-accent";
// Coral: it throws the reviewer's work away.
const stopItemClass =
  "flex w-full items-center gap-3 rounded-dropdown px-3 py-2 text-left text-sm font-semibold text-danger-strong transition-colors hover:bg-danger-soft";
