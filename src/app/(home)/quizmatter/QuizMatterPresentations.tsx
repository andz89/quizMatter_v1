"use client";

import { Suspense, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";
import { OTHER_CHOICE, SUBJECTS } from "@/lib/schema";
import { NO_SUBJECT, QUIZMATTER_ROW_SIZE } from "../../homeSearch";
import type { PresentationCardData } from "../../PresentationCard";
import { Cards, PartLabel, SubjectChips, useSavedIds } from "../CardGrid";
import { ShowMore } from "../ShowMore";

// An admin's presentation, with its dates (kept on the card data).
export type AdminCardData = PresentationCardData & { createdAt: number; updatedAt: number };

// One subject row: its exact count in the database and the cards read for it (the first few, or a page of them).
export type SubjectGroup = { id: string; count: number; cards: AdminCardData[] };

type AdminSort = "updated" | "newest";

const ADMIN_SORTS: { id: AdminSort; label: string }[] = [
  { id: "updated", label: "Last changed" },
  { id: "newest", label: "Newest" },
];

/**
 * "From QuizMatter" (the /quizmatter page): a row per subject, subject chips, and Last changed / Newest. The sort and
 * the picked subject live in the page link, so the server reads only the cards that show.
 */
export function QuizMatterPresentations({
  groups,
  counts,
  total,
  subject,
  sort,
  shown,
  grouped,
}: {
  groups: SubjectGroup[];
  counts: Record<string, number>;
  total: number;
  subject: string;
  sort: AdminSort;
  shown: number;
  // true: a row per subject (All); false: one list of the picked subject, with "Show more".
  grouped: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const cards = groups.flatMap((group) => group.cards);
  const { savedIds, onSavedChange } = useSavedIds(cards);
  const cardsProps = { savedIds, onSavedChange };

  // The top line and spinner show at once, and stay until the server sends the new cards.
  const open = (next: { subject?: string; sort?: AdminSort }) => {
    const params = new URLSearchParams();
    const nextSubject = next.subject ?? subject;
    const nextSort = next.sort ?? sort;
    if (nextSubject) params.set("subject", nextSubject);
    if (nextSort !== "updated") params.set("sort", nextSort);
    const query = params.toString();
    startTransition(() => router.push(`/quizmatter${query ? `?${query}` : ""}`, { scroll: false }));
  };

  // The chips: every subject with something shared (the "no subject" ones have no chip).
  const bySubject = new Map(Object.entries(counts).filter(([id, count]) => id !== NO_SUBJECT && count > 0));

  return (
    <>
      {isPending && <TopLoadingBar />}
      {total > 0 && (
        <div className="mb-4 flex items-center justify-end gap-1">
          {isPending && <Spinner size={16} />}
          {ADMIN_SORTS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={sort === id}
              onClick={() => open({ sort: id })}
              className={`rounded-dropdown px-2.5 py-1 text-[13px] font-semibold transition-colors ${
                sort === id ? "bg-accent-soft text-accent" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <SubjectChips
        cards={cards}
        serverCounts={{ total, bySubject }}
        picked={subject === NO_SUBJECT ? "" : subject}
        onPick={(chip) => open({ subject: chip })}
      />

      <section className="mb-10">
        {grouped && groups.length > 0 ? (
          <SubjectGroups {...cardsProps} groups={groups} onSeeAll={(id) => open({ subject: id })} />
        ) : (
          <>
            <Cards {...cardsProps} cards={cards} empty="QuizMatter hasn't shared any presentations yet." />
            {/* Reads the address, so it waits for it in the browser. */}
            <Suspense>
              <ShowMore shown={shown} total={groups[0]?.count ?? 0} />
            </Suspense>
          </>
        )}
      </section>
    </>
  );
}

/** The groups in list order, then "Other", then no subject, one row each. "See all" opens that subject. */
function SubjectGroups({
  groups,
  onSeeAll,
  ...cardsProps
}: {
  groups: SubjectGroup[];
  onSeeAll: (subject: string) => void;
  savedIds: Set<string>;
  onSavedChange: (card: PresentationCardData, isSaved: boolean) => void;
}) {
  const order: string[] = [...SUBJECTS, OTHER_CHOICE, NO_SUBJECT];
  const sorted = [...groups].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  return (
    <div className="flex flex-col gap-6">
      {sorted.map(({ id, count, cards }) => (
        <div key={id}>
          <div className="flex items-center gap-3">
            <PartLabel className="mr-auto">
              {id === NO_SUBJECT ? "No subject" : id} · {count}
            </PartLabel>
            {count > QUIZMATTER_ROW_SIZE && (
              <button type="button" onClick={() => onSeeAll(id)} className="mb-2 text-sm font-semibold text-text-primary hover:underline">
                See all ({count})
              </button>
            )}
          </div>
          <Cards {...cardsProps} cards={cards} empty="" />
        </div>
      ))}
    </div>
  );
}
