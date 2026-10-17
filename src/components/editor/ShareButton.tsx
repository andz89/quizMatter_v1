"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckIcon, CircleAlertIcon, EyeOffIcon, GlobeIcon, LinkIcon, LockIcon, RefreshCwIcon, SendIcon } from "lucide-react";
import { submitToQuizMatter } from "@/app/actions";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";
import { isPaused, useIsPaused } from "@/lib/clickLimits";
import { publishableSchema } from "@/lib/schema";
import { useEditorStore } from "@/lib/store";

// What happens when it's switched, told in the "Continue?" box first.
const TEACHER_CONFIRM = {
  published: {
    title: "Publish this presentation?",
    points: [
      "Other teachers get a copy of it as it is now. They can find it on the Home page and open it.",
      "They can make their own copy of it, save it to their “Saved” list, or report it.",
      "Edits you make later stay private until you click “Update shared presentation”.",
      "Your unsaved edits are saved first.",
    ],
  },
  private: {
    title: "Make this presentation private?",
    points: [
      "The shared copy is removed. It leaves the Home page and other teachers’ “Saved” lists.",
      "Its link stops working for other teachers.",
      "Copies other teachers already made stay with them.",
      "Your unsaved edits are saved too.",
    ],
  },
};

const TEACHER_CHOICES = [
  { value: false, label: "Private", hint: "Only you can see it", Icon: LockIcon },
  { value: true, label: "Published", hint: "Other teachers can find it on the Home page", Icon: GlobeIcon },
];

// A QuizMatter presentation (made on Admin → Presentations) is a draft or shared with every teacher.
const ADMIN_CONFIRM = {
  published: {
    title: "Share this presentation?",
    points: [
      "Every teacher gets it on their Home page, under “From QuizMatter”.",
      "You can make it a draft again at any time. Copies teachers already made stay with them.",
      "Your unsaved edits are saved too.",
    ],
  },
  private: {
    title: "Make this presentation a draft?",
    points: [
      "Only you can see it now. It leaves every teacher’s Home page.",
      "Copies teachers already made stay with them.",
      "Your unsaved edits are saved too.",
    ],
  },
};

const ADMIN_CHOICES = [
  { value: false, label: "Draft", hint: "Only you can see it", Icon: LockIcon },
  { value: true, label: "Shared", hint: "Every teacher gets it, under “From QuizMatter”", Icon: GlobeIcon },
];

/**
 * The Share button in the editor's top bar (like Canva's). It opens a card to make the presentation private or
 * published (after a "Continue?" box that says what will happen; then saved right away), and to copy its link once
 * it's published. A teacher's Published makes a shared copy (see the shared_copy migration): the card says whether
 * the copy is up to date, and offers "Update shared presentation" when it isn't. On a QuizMatter presentation the
 * choices are called Draft and Shared, and switch the presentation itself. Not shown in a review.
 * For teachers, switching too often pauses it for a while (the "share" and "publish" click limits, see the
 * share_limits migration), and an empty presentation can't be published. The database skips both for admins.
 * Editors can't publish: their card has "Submit to QuizMatter" instead (same as the card's ⋮ menu, see the
 * quizmatter_submissions migration), which saves unsaved edits first, then opens the (now locked) view page.
 */
export function ShareButton() {
  const fromAdmin = useEditorStore((s) => s.presentation.fromAdmin);
  const sharedCopy = useEditorStore((s) => s.sharedCopy);
  // A teacher's presentation is published when it has a shared copy; a QuizMatter one has the switch.
  const isPublished = useEditorStore((s) => (s.presentation.fromAdmin ? s.presentation.isPublished : s.sharedCopy !== null));
  // Has edits the shared copy doesn't have: unsaved ones, or saved after the last copy.
  const isBehind = useEditorStore(
    (s) => s.sharedCopy !== null && (s.presentation !== s.savedPresentation || (s.savedAt ?? 0) > s.sharedCopy.sharedAt),
  );
  const updateSharedCopy = useEditorStore((s) => s.updateSharedCopy);
  const [isUpdating, setIsUpdating] = useState(false);
  const id = useEditorStore((s) => s.presentation.id);
  const isHidden = useEditorStore((s) => s.review !== null);
  const isSaving = useEditorStore((s) => s.saveStatus === "saving");
  const setPublished = useEditorStore((s) => s.setPublished);
  // "share" pauses both ways; "publish" only going published.
  const isSharePaused = useIsPaused("share") && !fromAdmin;
  // Editors send their own presentations to QuizMatter instead (the database refuses them too).
  const canPublish = useEditorStore((s) => s.canPublish || s.presentation.fromAdmin);
  const isPublishPaused = useIsPaused("publish") && !fromAdmin;
  const isEditor = !canPublish && !fromAdmin;
  const submission = useEditorStore((s) => s.submission);
  const savePresentation = useEditorStore((s) => s.savePresentation);
  const router = useRouter();
  const [isSubmitConfirming, setIsSubmitConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
  const CONFIRM = fromAdmin ? ADMIN_CONFIRM : TEACHER_CONFIRM;
  const CHOICES = fromAdmin ? ADMIN_CHOICES : TEACHER_CHOICES;

  const pick = (value: boolean) => {
    if (value === isPublished) return;
    // Checked here first, so the teacher is told before the "Continue?" box (the database checks it too).
    const problem = value && !fromAdmin && publishableSchema.safeParse(useEditorStore.getState().presentation).error;
    if (problem) return toast.error(problem.issues[0].message);
    setIsOpen(false);
    setConfirming(value);
  };

  const confirmSwitch = async (value: boolean) => {
    setIsSwitching(true);
    const problem = await setPublished(value);
    setIsSwitching(false);
    // Paused for switching too often: the box closes, and the notice at the bottom says until when.
    if (problem !== null && !fromAdmin && (isPaused("share") || (value && isPaused("publish")))) return setConfirming(null);
    // Any other failure keeps the box open and says why, so the teacher can try again or cancel.
    if (problem !== null) return problem && toast.error(problem);
    setConfirming(null);
    if (fromAdmin) toast.success(value ? "Shared — every teacher has it now." : "Back to a draft — only you can see it.");
    else toast.success(value ? "Presentation published — other teachers can see it now." : "Presentation is private now.");
  };

  const update = async () => {
    // Checked here first, so the teacher is told at once (the database checks it too).
    const empty = publishableSchema.safeParse(useEditorStore.getState().presentation).error;
    if (empty) return toast.error(empty.issues[0].message);
    setIsUpdating(true);
    const problem = await updateSharedCopy();
    setIsUpdating(false);
    // "" = already told (a pause: the notice at the bottom says until when).
    if (problem === null) toast.success("Shared copy updated — other teachers see your newest version.");
    else if (problem) toast.error(problem);
  };

  const askSubmit = () => {
    // Checked here first, so the editor is told before the "Continue?" box (the database checks it too).
    const empty = publishableSchema.safeParse(useEditorStore.getState().presentation).error;
    if (empty) return toast.error(empty.issues[0].message);
    setIsOpen(false);
    setIsSubmitConfirming(true);
  };

  const submit = async () => {
    setIsSubmitting(true);
    // QuizMatter gets what the editor sees, so unsaved edits are saved first.
    if (!(await savePresentation({ quiet: true }))) {
      setIsSubmitting(false);
      return toast.error("Couldn't save your changes, so it wasn't sent. Please try again.");
    }
    const error = await submitToQuizMatter(id);
    if (error) {
      setIsSubmitting(false);
      return toast.error(error);
    }
    toast.success("Sent to QuizMatter. You'll see their answer in Reviews & submissions.");
    // It's locked now, so it opens view only (the box stays busy until the page changes).
    router.replace(`/presentation/${id}`);
  };

  const copyLink = async () => {
    try {
      // A teacher's link is the shared copy's: that's what other teachers can open.
      await navigator.clipboard.writeText(`${window.location.origin}/presentation/${sharedCopy?.id ?? id}`);
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
        title={`Share (${(isPublished ? CHOICES[1] : CHOICES[0]).label.toLowerCase()})`}
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
              const isEditorBlocked = value && !isPicked && !canPublish;
              // A hidden copy stays until QuizMatter decides (the database refuses Private too).
              const isHiddenBlocked = !value && !isPicked && Boolean(sharedCopy?.isHidden);
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => pick(value)}
                  disabled={isSaving || isRowPaused || isEditorBlocked || isHiddenBlocked}
                  className={`flex items-center gap-3 rounded-button border px-3 py-2.5 text-left transition-colors disabled:cursor-default disabled:opacity-60 ${
                    isPicked ? "border-accent bg-accent-soft" : "border-transparent hover:bg-bg-page"
                  }`}
                >
                  <Icon size={16} className="shrink-0 text-text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-text-primary">{label}</span>
                    <span className="block text-[13px] text-text-secondary">
                      {isEditorBlocked
                        ? "Editors send their presentations to QuizMatter instead"
                        : isHiddenBlocked
                          ? "QuizMatter hid the shared copy, so it stays until they decide"
                          : hint}
                    </span>
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

          {isEditor &&
            (submission === "approved" ? (
              <p className="flex items-center gap-2 text-[13px] text-text-secondary">
                <CheckIcon size={14} className="shrink-0 text-success-strong" />
                This presentation is in QuizMatter.
              </p>
            ) : (
              <button
                type="button"
                onClick={askSubmit}
                disabled={isSaving}
                className="inline-flex items-center justify-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
              >
                <SendIcon size={14} />
                {submission === "sent_back" ? "Submit again" : "Submit to QuizMatter"}
              </button>
            ))}

          {sharedCopy && (
            <div className="flex flex-col gap-2 rounded-button bg-bg-page px-3 py-2.5">
              {sharedCopy.isHidden && (
                <p className="flex items-center gap-2 text-[13px] text-danger-strong">
                  <EyeOffIcon size={14} className="shrink-0" />
                  QuizMatter hid the shared copy. Other teachers can’t see it.
                </p>
              )}
              <p className="flex items-center gap-2 text-[13px] text-text-secondary">
                {isBehind ? (
                  <CircleAlertIcon size={14} className="shrink-0 text-highlight-strong" />
                ) : (
                  <CheckIcon size={14} className="shrink-0 text-success-strong" />
                )}
                {isBehind ? "You have changes the shared copy doesn’t have." : "The shared copy is up to date."}
              </p>
              {isBehind && (
                <button
                  type="button"
                  onClick={update}
                  disabled={isUpdating || isSaving || isSharePaused}
                  className="inline-flex items-center justify-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
                >
                  {isUpdating ? <Spinner size={14} /> : <RefreshCwIcon size={14} />}
                  Update shared presentation
                </button>
              )}
            </div>
          )}

          {/* A hidden copy's link doesn't open for other teachers. */}
          {isPublished && !sharedCopy?.isHidden && (
            <button
              type="button"
              onClick={copyLink}
              // One main button at a time: plain while "Update shared presentation" shows.
              className={
                isBehind
                  ? "flex items-center justify-center gap-2 rounded-button border border-border-default px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-page"
                  : "flex items-center justify-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
              }
            >
              <LinkIcon size={14} />
              Copy link
            </button>
          )}
        </div>
      )}

      {isSubmitConfirming && (
        <Modal title="Send it to QuizMatter?" onClose={() => setIsSubmitConfirming(false)} isBusy={isSubmitting}>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-text-primary">
            <li>An admin will check it. Until they decide, you can&apos;t change or delete it.</li>
            <li>If they approve it, QuizMatter gets its own copy, shared with every teacher, with you as the Author.</li>
            <li>Your unsaved edits are saved first.</li>
          </ul>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsSubmitConfirming(false)}
              disabled={isSubmitting}
              className="rounded-button border border-border-default px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-page disabled:opacity-60 disabled:hover:bg-transparent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {isSubmitting && <Spinner size={14} />}
              Submit
            </button>
          </div>
          {isSubmitting && <TopLoadingBar />}
        </Modal>
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
