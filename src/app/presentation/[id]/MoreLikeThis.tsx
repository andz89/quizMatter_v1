"use client";

import { useState } from "react";
import { toast } from "sonner";
import { SparklesIcon } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import type { PresentationCardData } from "../../PresentationCard";
import { SavableCardGrid } from "../../SavableCardGrid";
import { loadMoreLikeThis } from "./actions";

/**
 * "More like this" under a live QuizMatter presentation: a button first, so opening one stays light; it then loads up
 * to 6 QuizMatter presentations with the same subject and a grade in common (see the lesson_extras migration). A card
 * there opens in the modal like any other.
 */
export function MoreLikeThis({ presentationId }: { presentationId: string }) {
  // null = not asked for yet.
  const [cards, setCards] = useState<PresentationCardData[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = async () => {
    setIsLoading(true);
    try {
      setCards(await loadMoreLikeThis(presentationId));
    } catch {
      toast.error("Couldn't load more like this. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="border-t border-border-default pt-6">
      <h2 className="mb-4 text-xl font-extrabold text-text-primary">More like this</h2>
      {cards === null ? (
        <button
          type="button"
          onClick={load}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-button border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:border-text-secondary disabled:opacity-60"
        >
          {isLoading ? <Spinner size={14} /> : <SparklesIcon size={16} />}
          Show more like this
        </button>
      ) : cards.length === 0 ? (
        <p className="text-sm text-text-secondary">Nothing like this yet.</p>
      ) : (
        <SavableCardGrid cards={cards} />
      )}
    </section>
  );
}
