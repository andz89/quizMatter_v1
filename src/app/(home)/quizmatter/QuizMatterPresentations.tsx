"use client";

import { useState } from "react";
import { OTHER_CHOICE, SUBJECTS } from "@/lib/schema";
import type { PresentationCardData } from "../../PresentationCard";
import { Cards, PartLabel, SubjectChips, subjectChip, useSavedIds } from "../CardGrid";

// How many cards each subject row shows ("See all" opens the rest).
const ROW_SIZE = 5;

// An admin's presentation, with its dates so "From QuizMatter" can sort by either.
export type AdminCardData = PresentationCardData & { createdAt: number; updatedAt: number };

type AdminSort = "updatedAt" | "createdAt";

const ADMIN_SORTS: { id: AdminSort; label: string }[] = [
  { id: "updatedAt", label: "Last changed" },
  { id: "createdAt", label: "Newest" },
];

/** "From QuizMatter" (the /quizmatter page): a row per subject, subject chips, and Last changed / Newest. */
export function QuizMatterPresentations({ cards }: { cards: AdminCardData[] }) {
  const [adminSort, setAdminSort] = useState<AdminSort>("updatedAt");
  // The picked subject chip ("" = All).
  const [subject, setSubject] = useState("");
  const { savedIds, onSavedChange } = useSavedIds(cards);

  const sorted = [...cards].sort((a, b) => b[adminSort] - a[adminSort]);
  const shown = subject === "" ? sorted : sorted.filter((card) => subjectChip(card.subject ?? "") === subject);
  const cardsProps = { savedIds, onSavedChange };

  return (
    <>
      {cards.length > 0 && (
        <div className="mb-4 flex justify-end gap-1">
          {ADMIN_SORTS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={adminSort === id}
              onClick={() => setAdminSort(id)}
              className={`rounded-dropdown px-2.5 py-1 text-[13px] font-semibold transition-colors ${
                adminSort === id ? "bg-accent-soft text-accent" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <SubjectChips cards={cards} picked={subject} onPick={setSubject} />

      <section className="mb-10">
        {subject === "" && shown.some((card) => card.subject) ? (
          <SubjectGroups {...cardsProps} cards={shown} onSeeAll={setSubject} />
        ) : (
          <Cards {...cardsProps} cards={shown} empty="QuizMatter hasn't shared any presentations yet." />
        )}
      </section>
    </>
  );
}

/**
 * The cards in groups by subject (list order, then "Other", then no subject), one row each. "See all" picks that
 * subject's chip, which shows all of them.
 */
function SubjectGroups({
  cards,
  onSeeAll,
  ...cardsProps
}: {
  cards: PresentationCardData[];
  onSeeAll: (subject: string) => void;
  savedIds: Set<string>;
  onSavedChange: (card: PresentationCardData, isSaved: boolean) => void;
}) {
  const groups = [...SUBJECTS, OTHER_CHOICE, ""]
    .map((id) => ({ id, cards: cards.filter((card) => subjectChip(card.subject ?? "") === id) }))
    .filter((group) => group.cards.length > 0);

  return (
    <div className="flex flex-col gap-6">
      {groups.map(({ id, cards }) => (
        <div key={id}>
          <div className="flex items-center gap-3">
            <PartLabel className="mr-auto">
              {id || "No subject"} · {cards.length}
            </PartLabel>
            {/* "No subject" has no chip to open, so it shows all its cards. */}
            {id && cards.length > ROW_SIZE && (
              <button type="button" onClick={() => onSeeAll(id)} className="mb-2 text-sm font-semibold text-text-primary hover:underline">
                See all ({cards.length})
              </button>
            )}
          </div>
          <Cards {...cardsProps} cards={id ? cards.slice(0, ROW_SIZE) : cards} empty="" />
        </div>
      ))}
    </div>
  );
}
