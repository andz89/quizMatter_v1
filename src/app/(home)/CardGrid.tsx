"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
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
