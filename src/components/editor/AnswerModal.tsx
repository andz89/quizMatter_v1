"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "@/components/icons/CloseIcon";

const MAX_ANSWER_LENGTH = 300;

interface AnswerModalProps {
  answer: string;
  // Given in the editor (the teacher types the answer); left out in presentation (answer is only shown).
  onChange?: (answer: string) => void;
  onClose: () => void;
}

/** Centered modal with a short-answer slide's correct answer — a text area in the editor, read-only when presenting. */
export function AnswerModal({ answer, onChange, onClose }: AnswerModalProps) {
  // Caught on the way down (capture) and stopped here, so the page's own shortcuts (Escape leaves
  // the presentation, arrows change slides, Ctrl+V pastes an element…) don't fire behind the modal.
  // Typing still works: stopping a key event doesn't stop the letter reaching the text area.
  // Only Escape closes it — Enter makes a new line in the answer.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  // Portal into <body>: the toolbar sits inside the slide's wrapper, which gets a `transform`
  // while being dragged — that would shift a `position: fixed` box rendered in place.
  return createPortal(
    <div
      data-keep-container-selection="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
      onClick={(e) => {
        // React sends portal clicks up to the presentation screen, which would change the slide.
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[calc(100vh-32px)] w-[640px] max-w-[calc(100vw-32px)] flex-col gap-4 rounded-card bg-bg-surface px-6 py-5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-[0.05em] text-accent-green">Correct answer</span>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        {onChange ? (
          <div className="flex flex-col gap-1.5">
            <textarea
              autoFocus
              rows={5}
              maxLength={MAX_ANSWER_LENGTH}
              value={answer}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Type the correct answer…"
              // Google Forms look: light gray fill, a single bottom line, which gets thicker on focus.
              // The line is an inset shadow so the thicker one doesn't push the text.
              className="resize-none rounded-t-[4px] bg-[#F8F9FA] px-4 py-3 text-base font-normal text-[#202124] shadow-[inset_0_-1px_0_#80868B] outline-none placeholder:text-[#70757A] focus:shadow-[inset_0_-2px_0_var(--accent-navy)]"
            />
            <span className="self-end text-xs text-text-secondary tabular-nums">
              {answer.length} / {MAX_ANSWER_LENGTH}
            </span>
          </div>
        ) : answer ? (
          // pre-wrap keeps the line breaks the teacher typed.
          <p className="overflow-y-auto whitespace-pre-wrap break-words text-[32px] font-semibold leading-snug text-text-primary">
            {answer}
          </p>
        ) : (
          <p className="text-base text-text-secondary">No answer was added for this slide.</p>
        )}
      </div>
    </div>,
    document.body
  );
}
