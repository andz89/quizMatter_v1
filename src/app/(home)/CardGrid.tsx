"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { OTHER_CHOICE, SUBJECTS, isOtherSubject } from "@/lib/schema";
import { PresentationCard, type PresentationCardData } from "../PresentationCard";
import { DraggableCard } from "../MyFolders";

export function Cards({
  cards,
  showMenu,
  onMoveToFolder,
  selection,
  canDrag = false,
  fadedIds,
  empty,
  savedIds,
  onSavedChange,
}: {
  cards: PresentationCardData[];
  showMenu?: boolean;
  onMoveToFolder?: (card: PresentationCardData) => void;
  // My checked cards (saved presentations only: Claude's drafts can't go in folders).
  selection?: { checkedIds: Set<string>; isSelecting: boolean; onToggle: (id: string) => void };
  // Saved presentations can be dragged onto a folder; `fadedIds` are the ones being dragged.
  canDrag?: boolean;
  fadedIds?: Set<string>;
  empty: string;
  savedIds: Set<string>;
  onSavedChange: (card: PresentationCardData, isSaved: boolean) => void;
}) {
  if (cards.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((card) => {
        // A card with a badge like "draft" is one of Claude's drafts, not saved yet.
        const isDraft = card.badge === "draft" || card.badge === "checking" || card.badge === "unfinished";
        const presentationCard = (
          <PresentationCard
            key={card.id}
            card={{ ...card, isSaved: savedIds.has(card.id) }}
            showMenu={showMenu}
            onMoveToFolder={onMoveToFolder}
            onSavedChange={onSavedChange}
            selection={
              selection && !isDraft
                ? {
                    isChecked: selection.checkedIds.has(card.id),
                    isSelecting: selection.isSelecting,
                    onToggle: () => selection.onToggle(card.id),
                  }
                : undefined
            }
          />
        );
        return canDrag && !isDraft ? (
          <DraggableCard key={card.id} card={card} isFaded={fadedIds?.has(card.id) ?? false}>
            {presentationCard}
          </DraggableCard>
        ) : (
          presentationCard
        );
      })}
    </div>
  );
}

/** A small heading for one part of a tab, like "In progress" in My reviews. */
export function PartLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h3 className={`mb-2 text-[11px] font-bold tracking-[0.05em] text-text-header uppercase ${className}`}>{children}</h3>;
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-card border border-border-default bg-bg-surface px-5 py-8 text-center text-sm text-text-secondary">
      {children}
    </p>
  );
}

/**
 * Other people's presentations with working bookmarks. A click flips the bookmark here at once, then
 * router.refresh() updates the tab counts in the layout. `removeOnUnsave`: the Saved page drops the card.
 */
export function SavableCards({ cards, empty, removeOnUnsave = false }: { cards: PresentationCardData[]; empty: string; removeOnUnsave?: boolean }) {
  const router = useRouter();
  const [savedIds, setSavedIds] = useState(() => new Set(cards.filter((card) => card.isSaved).map((card) => card.id)));
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const onSavedChange = (card: PresentationCardData, isSaved: boolean) => {
    setSavedIds((ids) => {
      const next = new Set(ids);
      if (isSaved) next.add(card.id);
      else next.delete(card.id);
      return next;
    });
    if (removeOnUnsave && !isSaved) setRemovedIds((ids) => new Set(ids).add(card.id));
    router.refresh();
  };
  return <Cards cards={cards.filter((card) => !removedIds.has(card.id))} empty={empty} savedIds={savedIds} onSavedChange={onSavedChange} />;
}

/** The chip a subject falls under: its own name, "Other" for one not on the list, "" for none. */
export function subjectChip(subject: string): string {
  return isOtherSubject(subject) ? OTHER_CHOICE : subject;
}

/**
 * "All", then each subject the tab's cards have, then "Other", each with its count. Hidden when no card has a
 * subject. A chip with no cards is left out, unless it's the picked one (e.g. after removing a bookmark).
 */
export function SubjectChips({ cards, picked, onPick }: { cards: PresentationCardData[]; picked: string; onPick: (subject: string) => void }) {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const chip = subjectChip(card.subject ?? "");
    if (chip) counts.set(chip, (counts.get(chip) ?? 0) + 1);
  }
  if (counts.size === 0 && picked === "") return null;
  const chips = [
    { id: "", count: cards.length },
    ...[...SUBJECTS, OTHER_CHOICE].map((id) => ({ id, count: counts.get(id) ?? 0 })).filter(({ id, count }) => count > 0 || id === picked),
  ];

  return (
    <div className="mb-4 flex flex-wrap gap-1">
      {chips.map(({ id, count }) => (
        <button
          key={id}
          type="button"
          aria-pressed={picked === id}
          onClick={() => onPick(id)}
          className={`flex items-center gap-2 rounded-dropdown px-2.5 py-1 text-[13px] font-semibold transition-colors ${
            picked === id ? "bg-accent-soft text-accent" : "text-text-secondary hover:text-text-primary"
          }`}
        >
          {id || "All"}
          <span className="text-[11px]">{count}</span>
        </button>
      ))}
    </div>
  );
}
