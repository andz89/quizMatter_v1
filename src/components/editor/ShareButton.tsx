"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckIcon, GlobeIcon, LinkIcon, LockIcon } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { isPaused, useIsPaused } from "@/lib/clickLimits";
import { publishableSchema } from "@/lib/schema";
import { useEditorStore } from "@/lib/store";

// What happens when it's switched, told in the "Continue?" box first.
const CONFIRM = {
  published: {
    title: "Publish this presentation?",
    points: [
      "Other teachers can find it on the Home page and open it.",
      "They can make their own copy of it, save it to their “Saved” list, or report it.",
      "You can make it private again at any time. Copies other teachers already made stay with them.",
      "Your unsaved edits are saved too.",
    ],
  },
  private: {
    title: "Make this presentation private?",
    points: [
      "Only you can see it now. It leaves the Home page and other teachers’ “Saved” lists.",
      "Its link stops working for other teachers.",
      "Copies other teachers already made stay with them.",
      "Your unsaved edits are saved too.",
    ],
  },
};

const CHOICES = [
  { value: false, label: "Private", hint: "Only you can see it", Icon: LockIcon },
  { value: true, label: "Published", hint: "Other teachers can find it on the Home page", Icon: GlobeIcon },
];

/**
 * The teacher's Share button in the editor's top bar (like Canva's). It opens a card to make their presentation
 * private or published (after a "Continue?" box that says what will happen; then saved right away), and to copy
 * its link once it's published. Not shown in a review or on a QuizMatter presentation: those keep their own rules.
 * Switching too often pauses it for a while (the "share" and "publish" click limits, see the share_limits
 * migration), and an empty presentation can't be published.
 */
export function ShareButton() {
  const isPublished = useEditorStore((s) => s.presentation.isPublished);
  const id = useEditorStore((s) => s.presentation.id);
  const isHidden = useEditorStore((s) => s.review !== null || s.presentation.fromAdmin);
  const isSaving = useEditorStore((s) => s.saveStatus === "saving");
  const setPublished = useEditorStore((s) => s.setPublished);
  // "share" pauses both ways; "publish" only going published.
  const isSharePaused = useIsPaused("share");
  const isPublishPaused = useIsPaused("publish");
  const [isOpen, setIsOpen] = useState(false);
  // The choice waiting in the "Continue?" box (null = no box).
  const [confirming, setConfirming] = useState<boolean | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Closes on a click outside the card, or on Esc (like the review menu).
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  if (isHidden) return null;

  const pick = (value: boolean) => {
    if (value === isPublished) return;
    // Checked here first, so the teacher is told before the "Continue?" box (the database checks it too).
    const problem = value && publishableSchema.safeParse(useEditorStore.getState().presentation).error;
    if (problem) return toast.error(problem.issues[0].message);
    setIsOpen(false);
    setConfirming(value);
  };

  const confirmSwitch = async (value: boolean) => {
    setIsSwitching(true);
    const saved = await setPublished(value);
    setIsSwitching(false);
    // Paused for switching too often: the box closes, and the notice at the bottom says until when.
    if (!saved && (isPaused("share") || (value && isPaused("publish")))) return setConfirming(null);
    // Any other failure keeps the box open, so the teacher can try again or cancel.
    if (!saved) return toast.error("Couldn't change it. Please try again.");
    setConfirming(null);
    toast.success(value ? "Presentation published — other teachers can see it now." : "Presentation is private now.");
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/presentation/${id}`);
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn't copy the link. Please try again.");
    }
  };

  const StateIcon = isPublished ? GlobeIcon : LockIcon;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        title={isPublished ? "Share (published)" : "Share (private)"}
        className="flex items-center gap-2 rounded-button border border-border-default px-3 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-page sm:px-4"
      >
        <StateIcon size={14} />
        <span className="hidden sm:inline">Share</span>
      </button>

      {isOpen && (
        <div className="absolute top-11 right-0 z-50 flex w-80 flex-col gap-3 rounded-card border border-border-default bg-bg-surface p-4">
          <h2 className="text-[15px] font-extrabold text-text-primary">Share this presentation</h2>

          <div className="flex flex-col gap-1">
            {CHOICES.map(({ value, label, hint, Icon }) => {
              const isPicked = isPublished === value;
              const isRowPaused = !isPicked && (isSharePaused || (value && isPublishPaused));
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => pick(value)}
                  disabled={isSaving || isRowPaused}
                  className={`flex items-center gap-3 rounded-button border px-3 py-2.5 text-left transition-colors disabled:cursor-default disabled:opacity-60 ${
                    isPicked ? "border-accent bg-accent-soft" : "border-transparent hover:bg-bg-page"
                  }`}
                >
                  <Icon size={16} className="shrink-0 text-text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-text-primary">{label}</span>
                    <span className="block text-[13px] text-text-secondary">{hint}</span>
                  </span>
                  {isPicked && <CheckIcon size={16} className="shrink-0 text-accent" />}
                </button>
              );
            })}
          </div>

          {(isSharePaused || (!isPublished && isPublishPaused)) && (
            <p className="text-[13px] text-text-secondary">
              {isSharePaused ? "Sharing" : "Publishing"} is paused for a while, because it was switched too often. The
              notice at the bottom says until when.
            </p>
          )}

          {isPublished && (
            <button
              type="button"
              onClick={copyLink}
              className="flex items-center justify-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
            >
              <LinkIcon size={14} />
              Copy link
            </button>
          )}
        </div>
      )}

      {confirming !== null && (
        <Modal
          title={CONFIRM[confirming ? "published" : "private"].title}
          onClose={() => setConfirming(null)}
          isBusy={isSwitching}
        >
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-text-primary">
            {CONFIRM[confirming ? "published" : "private"].points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(null)}
              disabled={isSwitching}
              className="rounded-button border border-border-default px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-page disabled:opacity-60 disabled:hover:bg-transparent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => confirmSwitch(confirming)}
              disabled={isSwitching}
              className="inline-flex items-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {isSwitching && <Spinner size={14} />}
              Continue
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
