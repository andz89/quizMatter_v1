"use client";

import { useState } from "react";
import { MessageSquareTextIcon } from "lucide-react";
import { Modal } from "@/components/Modal";

/**
 * The yellow bar under the editor's top bar after QuizMatter sent something back (my submission, or my review): a
 * "View comments" button opens the admin's note in full, so a long note doesn't fill the bar. `hint` says what to do
 * next.
 */
export function SentBackBanner({ note, hint }: { note: string; hint?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border-default bg-highlight-soft px-4 py-2 text-sm text-text-primary">
      <span className="font-semibold">QuizMatter sent this back.</span>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-2 rounded-dropdown border border-border-default bg-bg-surface px-2.5 py-1 text-[13px] font-semibold text-text-primary transition-colors hover:bg-bg-page"
      >
        <MessageSquareTextIcon size={14} />
        View comments
      </button>
      {hint && <span>{hint}</span>}
      {isOpen && (
        <Modal title="QuizMatter's comments" onClose={() => setIsOpen(false)}>
          <p className="text-sm whitespace-pre-wrap text-text-primary">{note}</p>
        </Modal>
      )}
    </div>
  );
}
