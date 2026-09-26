"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useEditorStore } from "@/lib/store";
import { LinkPending } from "@/components/LinkPending";
import { Spinner } from "@/components/Spinner";
import { createBlankQuiz } from "@/lib/factories";
import { buildSlides } from "@/lib/importQuiz";
import type { Quiz } from "@/lib/schema";
import { getDraftLesson, getLesson, removeLessons } from "./actions";
import type { LessonCardData } from "./LessonCard";

const itemClass = "block w-full px-3 py-1.5 text-left text-sm text-text-primary transition-colors hover:bg-bg-page";

/**
 * The "⋮" button on my lesson cards, with Edit, Present and Delete (Remove for Claude's drafts). A
 * draft Claude is still checking can only be removed.
 */
export function LessonCardMenu({ card }: { card: LessonCardData }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isDraft = card.badge === "draft" || card.badge === "checking" || card.badge === "unfinished";

  // Closes on a click outside the menu, or on Esc.
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setIsOpen(false);
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

  const present = async () => {
    setIsOpen(false);
    setIsBusy(true);
    // Asked for right away, while it still counts as the user's click (browsers refuse it later).
    await document.documentElement.requestFullscreen().catch(() => {
      // Fullscreen isn't available (unsupported/blocked) — presentation still opens.
    });
    const quiz = isDraft ? await loadDraft(card.id) : await getLesson(card.id);
    setIsBusy(false);
    if (!quiz || quiz.slides.length === 0) {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      alert(quiz ? "This lesson has no slides yet." : "Couldn't open the lesson. Please try again.");
      return;
    }
    // The presentation view reads the editor's store, so the lesson goes in there first.
    const store = useEditorStore.getState();
    store.loadQuiz(quiz);
    useEditorStore.setState({ selectedSlideId: quiz.slides[0].id });
    store.startPresentation();
  };

  const remove = async () => {
    setIsOpen(false);
    const question = isDraft ? `Remove "${card.title}"? Claude's draft will be deleted.` : `Delete "${card.title}"? This can't be undone.`;
    if (!confirm(question)) return;
    setIsBusy(true);
    // On success the page reloads its list and this card goes away.
    const ok = await removeLessons(isDraft ? [] : [card.id], isDraft ? [card.id] : []);
    setIsBusy(false);
    if (!ok) alert("Couldn't delete the lesson. Please try again.");
  };

  if (isBusy) {
    return (
      <span className="absolute top-5 right-5 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-bg-surface">
        <Spinner size={14} />
      </span>
    );
  }

  return (
    <div ref={menuRef} className="absolute top-5 right-5 z-20">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={`Options for ${card.title}`}
        aria-expanded={isOpen}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-border-default bg-bg-surface text-text-primary transition-colors hover:bg-bg-page"
      >
        <DotsIcon />
      </button>

      {/* Opens to the left of the button, so it fits inside the card (the phone row clips anything taller). */}
      {isOpen && (
        <div className="absolute top-0 right-9 w-32 overflow-hidden rounded-dropdown border border-border-default bg-bg-surface py-1">
          {card.badge !== "checking" && (
            // Stays open on click, so the top line (inside the link) keeps showing until the editor opens.
            <Link href={card.href} className={itemClass}>
              Edit
              <LinkPending />
            </Link>
          )}
          {card.badge !== "checking" && (
            <button type="button" onClick={present} className={itemClass}>
              Present
            </button>
          )}
          <button type="button" onClick={remove} className={itemClass}>
            {isDraft ? "Remove" : "Delete"}
          </button>
        </div>
      )}
    </div>
  );
}

/** Claude's draft as a lesson: its slides built from the recipe, the same way the editor does. */
async function loadDraft(id: string): Promise<Quiz | null> {
  const draft = await getDraftLesson(id);
  if (!draft) return null;
  const built = buildSlides({ slides: draft.slides });
  if ("errors" in built) return null;
  return { ...createBlankQuiz(draft.details), id, slides: built.slides };
}

function DotsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="8" cy="3.5" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="8" cy="12.5" r="1.25" />
    </svg>
  );
}
