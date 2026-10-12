"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEditorStore } from "@/lib/store";
import { useFormatTexts } from "@/lib/useFormatTexts";
import { ConfirmModal } from "./ConfirmModal";
import { DetailsModal } from "./DetailsModal";
import { SelectedElementToolbar } from "./SelectedElementToolbar";
import { TextFormatToolbar } from "./TextFormatToolbar";
import { ShapeBoxToolbar } from "./ShapeBoxToolbar";
import { ReviewControls } from "./ReviewControls";
import { ShareButton } from "./ShareButton";
import { presentFullscreen } from "./EditorBottomBar";
import { Spinner } from "@/components/Spinner";
import { ChevronLeftIcon, PlayIcon, Redo2Icon, Undo2Icon } from "lucide-react";

export function EditorTopBar() {
  const title = useEditorStore((s) => s.presentation.title);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const formatTexts = useFormatTexts();
  const hasSelectedElements = useEditorStore((s) => s.selectedElementIds.length > 0);

  return (
    // Below laptop width the bar wraps: the text/element toolbars get their own row under it.
    <header className="relative z-20 flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 border-b border-border-default bg-bg-surface px-4 py-2.5 lg:h-14 lg:py-0">
      <BackToPresentationsLink />

      <button
        type="button"
        onClick={() => setIsDetailsOpen(true)}
        title="Presentation details"
        className={`w-40 min-w-0 flex-1 truncate rounded-input px-2 py-1 text-left text-[15px] font-semibold hover:bg-bg-page sm:w-auto sm:max-w-xs sm:flex-none ${title ? "text-text-primary" : "text-text-secondary"}`}
      >
        {title || "Untitled presentation"}
      </button>
      {isDetailsOpen && <DetailsModal onClose={() => setIsDetailsOpen(false)} />}

      <div className="flex items-center">
        <button type="button" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" className={historyButtonClass}>
          <Undo2Icon size={18} />
        </button>
        <button type="button" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)" className={historyButtonClass}>
          <Redo2Icon size={18} />
        </button>
      </div>

      {/* A selected text box gets both bars: its text formatting and the element controls. */}
      <div className="order-last flex w-full flex-wrap items-center justify-center gap-2 pt-2.5 empty:hidden lg:absolute lg:top-1/2 lg:left-1/2 lg:w-auto lg:-translate-x-1/2 lg:-translate-y-1/2 lg:pt-0">
        {formatTexts.length > 0 && <TextFormatToolbar texts={formatTexts} />}
        {hasSelectedElements && <SelectedElementToolbar showColor={formatTexts.length === 0} />}
        {formatTexts.length === 0 && !hasSelectedElements && <ShapeBoxToolbar />}
      </div>

      <SaveButton />
      <ReviewControls />
      <ShareButton />

      <button
        type="button"
        onClick={presentFullscreen}
        title="Present (fullscreen)"
        className="flex items-center gap-2 rounded-button bg-accent btn-press px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover sm:px-4"
      >
        <PlayIcon size={14} fill="currentColor" />
        <span className="hidden sm:inline">Present</span>
      </button>
    </header>
  );
}

/** Asks before leaving when there are unsaved changes (the browser's own "Leave page?" doesn't cover in-app links). */
function BackToPresentationsLink() {
  // QuizMatter presentations are made on the admin page, so they go back there. A review goes back to the
  // presentation's page.
  const fromAdmin = useEditorStore((s) => s.presentation.fromAdmin);
  const reviewId = useEditorStore((s) => (s.review ? s.presentation.id : null));
  const router = useRouter();
  const [isConfirming, setIsConfirming] = useState(false);
  const href = reviewId ? `/presentation/${reviewId}` : fromAdmin ? "/admin/presentations" : "/";
  return (
    <>
      <Link
        href={href}
        title={reviewId ? "Back to the presentation" : fromAdmin ? "QuizMatter presentations" : "My presentations"}
        onClick={(e) => {
          const { presentation, savedPresentation } = useEditorStore.getState();
          // Unsaved: stay, and ask first.
          if (presentation === savedPresentation) return;
          e.preventDefault();
          setIsConfirming(true);
        }}
        className={historyButtonClass}
      >
        <ChevronLeftIcon size={18} />
      </Link>
      {isConfirming && (
        <ConfirmModal
          title="Leave without saving?"
          message="You have unsaved changes. They're lost if you leave now."
          confirmLabel="Leave"
          danger
          onConfirm={() => {
            // An in-app move, so the browser's own "Leave page?" doesn't ask a second time.
            setIsConfirming(false);
            router.push(href);
          }}
          onCancel={() => setIsConfirming(false)}
        />
      )}
    </>
  );
}

/**
 * Saves the presentation to the database (also Ctrl+S). A dot shows while there are unsaved changes. In a review
 * it saves the reviewer's draft ("Save as draft").
 */
function SaveButton() {
  const savePresentation = useEditorStore((s) => s.savePresentation);
  const saveStatus = useEditorStore((s) => s.saveStatus);
  const hasUnsavedChanges = useEditorStore((s) => s.presentation !== s.savedPresentation);
  const review = useEditorStore((s) => s.review);

  const label =
    saveStatus === "saving"
      ? "Saving…"
      : saveStatus === "error"
        ? "Couldn't save — retry"
        : hasUnsavedChanges
          ? review
            ? "Save as draft"
            : "Save"
          : review
            ? "Draft saved"
            : "Saved";

  return (
    <button
      type="button"
      onClick={() => savePresentation()}
      disabled={saveStatus === "saving" || !hasUnsavedChanges}
      title={review ? "Save as draft (Ctrl+S)" : "Save (Ctrl+S)"}
      className="ml-auto flex items-center gap-2 rounded-button border border-border-default px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-page disabled:hover:bg-transparent"
    >
      {saveStatus === "saving" && <Spinner size={14} />}
      {hasUnsavedChanges && saveStatus !== "saving" && (
        <span className={`h-2 w-2 rounded-full ${saveStatus === "error" ? "bg-danger" : "bg-highlight"}`} />
      )}
      <span className={saveStatus === "error" ? "text-danger-strong" : undefined}>{label}</span>
    </button>
  );
}

const historyButtonClass =
  "flex h-9 w-9 items-center justify-center rounded-button text-text-primary transition-colors hover:bg-bg-page disabled:opacity-30 disabled:hover:bg-transparent";
