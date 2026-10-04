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
import { REVIEWER_MAX_LENGTH, reviewerSchema, todayIso, type ReviewerFields } from "@/lib/schema";
import { useEditorStore } from "@/lib/store";

/**
 * The reviewer's ⋮ button in the editor's top bar (next to Save as draft). It opens a menu with "Submit for
 * publishing" (which asks for the "Reviewed by" details first) and "Stop review".
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
      {isFormOpen && <SubmitForm initial={review.fields} onClose={() => setIsFormOpen(false)} />}
    </div>
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
    const { presentation, savedAt } = useEditorStore.getState();
    setIsSending(true);
    try {
      await submitReview(presentation, parsed.data, savedAt);
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
const menuItemClass =
  "flex w-full items-center gap-3 rounded-dropdown px-3 py-2 text-left text-sm font-semibold text-text-primary transition-colors hover:bg-accent-soft hover:text-accent";
// Coral: it throws the reviewer's work away.
const stopItemClass =
  "flex w-full items-center gap-3 rounded-dropdown px-3 py-2 text-left text-sm font-semibold text-danger-strong transition-colors hover:bg-danger-soft";
