"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SendIcon, XCircleIcon } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";
import { saveErrorMessage } from "@/lib/presentations";
import { stopReview, submitReview } from "@/lib/reviews";
import { REVIEWER_MAX_LENGTH, reviewerSchema, todayIso, type ReviewerFields } from "@/lib/schema";
import { useEditorStore } from "@/lib/store";

/**
 * The reviewer's buttons in the editor's top bar: "Stop review" and "Submit for publishing" (which asks for the
 * "Reviewed by" details first). Once submitted, only a "Waiting for QuizMatter" label.
 */
export function ReviewControls() {
  const router = useRouter();
  const review = useEditorStore((s) => s.review);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  if (!review) return null;

  if (review.status === "submitted") {
    return (
      <span className="ml-auto rounded-dropdown bg-bg-page px-2.5 py-1 text-[13px] leading-none font-semibold text-text-secondary">
        Waiting for QuizMatter
      </span>
    );
  }

  const stop = async () => {
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
    <>
      <button type="button" onClick={stop} disabled={isStopping} title="Stop review" className={secondaryButtonClass}>
        {isStopping ? <Spinner size={14} /> : <XCircleIcon size={16} />}
        <span className="hidden sm:inline">Stop review</span>
      </button>
      <button
        type="button"
        onClick={() => setIsFormOpen(true)}
        title="Submit for publishing"
        className="flex items-center gap-2 rounded-button bg-accent btn-press px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover sm:px-4"
      >
        <SendIcon size={14} />
        <span className="hidden sm:inline">Submit for publishing</span>
      </button>
      {isStopping && <TopLoadingBar />}
      {isFormOpen && <SubmitForm initial={review.fields} onClose={() => setIsFormOpen(false)} />}
    </>
  );
}

/** The "Reviewed by" details, checked with zod, then the draft and details go to the admins. */
function SubmitForm({ initial, onClose }: { initial: ReviewerFields; onClose: () => void }) {
  const router = useRouter();
  const [fields, setFields] = useState(initial);
  const [isSending, setIsSending] = useState(false);
  const set = (patch: Partial<ReviewerFields>) => setFields((current) => ({ ...current, ...patch }));

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = reviewerSchema.safeParse(fields);
    if (!parsed.success) return void toast.error(parsed.error.issues[0].message);
    const { presentation } = useEditorStore.getState();
    setIsSending(true);
    try {
      await submitReview(presentation, parsed.data);
      toast.success("Thanks! QuizMatter will publish this presentation in 1–2 days.");
      // Saved with the submit, so leaving doesn't ask "Leave without saving?".
      useEditorStore.setState({ savedPresentation: presentation, review: { status: "submitted", note: "", fields: parsed.data } });
      router.push(`/presentation/${presentation.id}`);
    } catch (error) {
      toast.error(saveErrorMessage(error, "submit the review"));
      setIsSending(false);
    }
  };

  return (
    <Modal title="Reviewed by" onClose={onClose} isBusy={isSending}>
      <form onSubmit={send} className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary">
          These show on the presentation once QuizMatter publishes your changes. Teachers keep seeing the old version
          until then.
        </p>
        <Field label="Name">
          <input
            value={fields.name}
            onChange={(e) => set({ name: e.target.value })}
            maxLength={REVIEWER_MAX_LENGTH.name}
            className={inputClass}
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            value={fields.email}
            onChange={(e) => set({ email: e.target.value })}
            maxLength={REVIEWER_MAX_LENGTH.email}
            className={inputClass}
          />
        </Field>
        <Field label="Education or current work">
          <textarea
            value={fields.background}
            onChange={(e) => set({ background: e.target.value })}
            maxLength={REVIEWER_MAX_LENGTH.background}
            rows={4}
            placeholder="e.g. Master Teacher I, Rizal National High School; MA in Mathematics Education"
            className={`${inputClass} resize-y`}
          />
        </Field>
        <Field label="Date reviewed">
          <input
            type="date"
            value={fields.reviewedOn}
            max={todayIso()}
            onChange={(e) => set({ reviewedOn: e.target.value })}
            className={inputClass}
          />
        </Field>
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

/** Under the top bar: the admin's note after a send-back, or that a submitted review can't change anymore. */
export function ReviewBanner() {
  const review = useEditorStore((s) => s.review);
  if (!review || (review.status === "reviewing" && !review.note)) return null;
  return (
    <p className="shrink-0 border-b border-border-default bg-highlight-soft px-4 py-2 text-sm text-text-primary">
      {review.status === "submitted"
        ? "Submitted. QuizMatter will publish this presentation in 1–2 days. Changes you make now won't be saved."
        : `QuizMatter sent this back: ${review.note}`}
    </p>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded-input border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary";
const secondaryButtonClass =
  "flex items-center gap-2 rounded-button border border-border-default px-3 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-page disabled:opacity-60";
