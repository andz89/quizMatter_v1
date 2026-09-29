"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useEditorStore } from "@/lib/store";
import { Spinner } from "@/components/Spinner";
import { createBlankPresentation } from "@/lib/factories";
import { buildSlides } from "@/lib/importPresentation";
import type { Presentation } from "@/lib/schema";
import { loadPeopleArt, usesPeopleArt } from "@/lib/peopleArt";
import { getDraftPresentation, getPresentation, removePresentations } from "./actions";
import { moveToQuizMatter } from "./admin/presentations/actions";
import { toast } from "sonner";
import type { PresentationCardData } from "./PresentationCard";
import { EllipsisVerticalIcon } from "lucide-react";

const itemClass = "block w-full px-3 py-1.5 text-left text-sm text-text-primary transition-colors hover:bg-bg-page";

/**
 * The "⋮" button on my presentation cards, with Edit, Present and Delete (Remove for Claude's drafts). A
 * draft Claude is still checking can only be removed. Admins also get "Move to QuizMatter" (see canMoveToQuizMatter).
 */
export function PresentationCardMenu({ card }: { card: PresentationCardData }) {
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
    const presentation = isDraft ? await loadDraft(card.id) : await getPresentation(card.id);
    // It opens only once the people art it uses has downloaded (see peopleArt.ts).
    const artLoaded = !presentation || !usesPeopleArt(presentation.slides) || (await loadPeopleArt().then(() => true, () => false));
    setIsBusy(false);
    if (!presentation || presentation.slides.length === 0 || !artLoaded) {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      alert(presentation?.slides.length === 0 ? "This presentation has no slides yet." : "Couldn't open the presentation. Please try again.");
      return;
    }
    // The presentation view reads the editor's store, so the presentation goes in there first.
    const store = useEditorStore.getState();
    store.loadPresentation(presentation);
    useEditorStore.setState({ selectedSlideId: presentation.slides[0].id });
    store.startPresentation();
  };

  const remove = async () => {
    setIsOpen(false);
    const question = isDraft ? `Remove "${card.title}"? Claude's draft will be deleted.` : `Delete "${card.title}"? This can't be undone.`;
    if (!confirm(question)) return;
    setIsBusy(true);
    // On success the page reloads its list and this card goes away.
    const ok = await removePresentations(isDraft ? [] : [card.id], isDraft ? [card.id] : []);
    setIsBusy(false);
    if (!ok) alert("Couldn't delete the presentation. Please try again.");
  };

  const moveToAdminList = async () => {
    setIsOpen(false);
    const question = `Move "${card.title}" to QuizMatter presentations (Admin → Presentations)? It goes there as a draft: teachers only get it after you share it.`;
    if (!confirm(question)) return;
    setIsBusy(true);
    // On success the page reloads its list and this card goes away.
    const ok = await moveToQuizMatter(card.id);
    setIsBusy(false);
    if (ok) toast.success("Moved to Admin → Presentations.");
    else toast.error("Couldn't move the presentation. Please try again.");
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
        <EllipsisVerticalIcon size={16} />
      </button>

      {/* Opens to the left of the button, so it fits inside the card (the phone row clips anything taller). */}
      {isOpen && (
        <div className="absolute top-0 right-9 w-44 overflow-hidden rounded-dropdown border border-border-default bg-bg-surface py-1">
          {card.badge !== "checking" && (
            // Opens in a new tab, so the list stays open in this one.
            <Link href={card.href} target="_blank" onClick={() => setIsOpen(false)} className={itemClass}>
              Edit
            </Link>
          )}
          {card.badge !== "checking" && (
            <button type="button" onClick={present} className={itemClass}>
              Present
            </button>
          )}
          {card.canMoveToQuizMatter && (
            <button type="button" onClick={moveToAdminList} className={itemClass}>
              Move to QuizMatter
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

/** Claude's draft as a presentation: its slides built from the recipe, the same way the editor does. */
async function loadDraft(id: string): Promise<Presentation | null> {
  const draft = await getDraftPresentation(id);
  if (!draft) return null;
  const built = buildSlides({ slides: draft.slides });
  if ("errors" in built) return null;
  return { ...createBlankPresentation(draft.details), id, slides: built.slides };
}
