import type { PresentationCardData } from "../../PresentationCard";
import { SavableCardGrid } from "../../SavableCardGrid";

/** "You may also like": QuizMatter presentations with the same subject and grade (see the lesson_extras migration). */
export function Suggestions({ cards }: { cards: PresentationCardData[] }) {
  if (cards.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="mb-3 font-sans text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">You may also like</h2>
      <SavableCardGrid cards={cards} />
    </section>
  );
}
