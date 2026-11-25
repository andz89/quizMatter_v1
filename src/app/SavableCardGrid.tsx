"use client";

import { useState } from "react";
import { PresentationCard, type PresentationCardData } from "./PresentationCard";
import { usePresentationChanges } from "./openPresentation";

/**
 * Cards in a grid whose bookmark (Save) button works, outside the home tabs: "More like this" (MoreLikeThis.tsx) and a profile's
 * presentations. It remembers what was saved or removed here, so the button stays right without a reload.
 */
export function SavableCardGrid({ cards }: { cards: PresentationCardData[] }) {
  const [savedIds, setSavedIds] = useState(() => new Set(cards.filter((card) => card.isSaved).map((card) => card.id)));
  const onSavedChange = (card: PresentationCardData, isSaved: boolean) =>
    setSavedIds((ids) => {
      const next = new Set(ids);
      if (isSaved) next.add(card.id);
      else next.delete(card.id);
      return next;
    });
  // Saved or removed elsewhere (the presentation modal, the same card in another grid).
  usePresentationChanges(({ id, isSaved }) => {
    const card = cards.find((card) => card.id === id);
    if (card && isSaved !== undefined) onSavedChange(card, isSaved);
  });
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {cards.map((card) => (
        <PresentationCard key={card.id} card={{ ...card, isSaved: savedIds.has(card.id) }} onSavedChange={onSavedChange} />
      ))}
    </div>
  );
}
