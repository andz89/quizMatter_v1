"use client";

import { useState, useTransition, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { XIcon } from "lucide-react";
import { useEditorStore } from "@/lib/store";
import { GRADES } from "@/lib/schema";
import { LinkPending } from "@/components/LinkPending";
import { SearchField, SearchForm, SearchSelect, SearchTextInput } from "@/components/SearchForm";
import { PresentationCard, type PresentationCardData } from "./PresentationCard";
import { ReviewRows, type MyReviewRow } from "./MyReviews";
import { DEFAULT_SEARCH, homeSearchQuery, LOOK_IN, SORTS, WITHIN, type HomeSearch } from "./homeSearch";

// Only downloaded when the teacher clicks Present on a card.
const PresentationView = dynamic(() =>
  import("@/components/presentation/PresentationView").then((mod) => mod.PresentationView)
);

// How many of my presentations the first row shows ("See all" opens the rest).
const MY_ROW_SIZE = 5;

// An admin's presentation, with its dates so "From QuizMatter" can sort by either.
export type AdminCardData = PresentationCardData & { createdAt: number; updatedAt: number };

type AdminSort = "updatedAt" | "createdAt";

// The home page's tabs, in this order.
const TABS: { id: Tab; label: string }[] = [
  { id: "mine", label: "My presentations" },
  { id: "quizmatter", label: "From QuizMatter" },
  // Editors only.
  { id: "reviewed", label: "My reviews" },
  { id: "saved", label: "Saved" },
  { id: "teachers", label: "Other teachers" },
];

const ADMIN_SORTS: { id: AdminSort; label: string }[] = [
  { id: "updatedAt", label: "Last changed" },
  { id: "createdAt", label: "Newest" },
];

type Tab = Exclude<HomeSearch["in"], "all">;

/**
 * The home page's cards, in tabs: my newest presentations, the ones admins shared with every teacher ("From
 * QuizMatter"), my reviews (editors only), the ones I saved, then presentations other teachers published. While
 * searching, the server already picked the matches (see page.tsx), so each tab shows exactly what it was given.
 */
export function PresentationHome({
  myCards,
  adminCards,
  otherCards,
  savedCards,
  reviewedCards,
  myReviews,
  isEditor,
  search,
  isSearching,
}: {
  myCards: PresentationCardData[];
  adminCards: AdminCardData[];
  otherCards: PresentationCardData[];
  savedCards: PresentationCardData[];
  // Editors: the live presentations I reviewed, and my open and canceled reviews (empty while searching).
  reviewedCards: PresentationCardData[];
  myReviews: MyReviewRow[];
  isEditor: boolean;
  search: HomeSearch;
  isSearching: boolean;
}) {
  const [adminSort, setAdminSort] = useState<AdminSort>("updatedAt");
  const isPresenting = useEditorStore((s) => s.isPresenting);
  // A bookmark click changes these here instead of loading the whole page again (page.tsx's ~8 database queries).
  // page.tsx keys this component by the search, so a new search starts again from the server's data.
  const [savedIds, setSavedIds] = useState(
    () => new Set([...adminCards, ...otherCards, ...savedCards, ...reviewedCards].filter((card) => card.isSaved).map((card) => card.id))
  );
  const [saved, setSaved] = useState(savedCards);

  const changeSaved = (card: PresentationCardData, isSaved: boolean) => {
    setSavedIds((ids) => {
      const next = new Set(ids);
      if (isSaved) next.add(card.id);
      else next.delete(card.id);
      return next;
    });
    // Newest saved first, like page.tsx. Only "From QuizMatter" cards have no byline; the Saved row says where from.
    setSaved((cards) =>
      isSaved
        ? [{ ...card, byline: card.byline ?? "From QuizMatter" }, ...cards.filter((saved) => saved.id !== card.id)]
        : cards.filter((saved) => saved.id !== card.id)
    );
  };
  const cardsProps = { savedIds, onSavedChange: changeSaved };

  const counts: Record<Tab, number> = {
    mine: myCards.length,
    quizmatter: adminCards.length,
    saved: saved.length,
    teachers: otherCards.length,
    // A presentation I'm reviewing again is in two parts, but counts once.
    reviewed: new Set([...reviewedCards.map((card) => card.id), ...myReviews.map((row) => row.presentation_id)]).size,
  };
  const openReviews = myReviews.filter((row) => row.status !== "canceled");
  const canceledReviews = myReviews.filter((row) => row.status === "canceled");
  const tabs = isEditor ? TABS : TABS.filter(({ id }) => id !== "reviewed");
  // A search opens the tab "Look in" names, or else the first tab with a match.
  const firstTab: Tab =
    search.in !== "all" && tabs.some(({ id }) => id === search.in)
      ? (search.in as Tab)
      : isSearching
        ? (tabs.find(({ id }) => counts[id] > 0)?.id ?? "mine")
        : "mine";
  // The picked tab belongs to one search; a new search starts again from its first tab.
  const searchKey = homeSearchQuery(search);
  const [picked, setPicked] = useState({ searchKey, tab: firstTab });
  const tab = picked.searchKey === searchKey ? picked.tab : firstTab;

  const mine = isSearching ? myCards : myCards.slice(0, MY_ROW_SIZE);
  // While searching, the search's own Sort decides the order.
  const fromAdmins = isSearching ? adminCards : [...adminCards].sort((a, b) => b[adminSort] - a[adminSort]);
  const noMatch = (what: string) => `No ${what} match your search.`;

  return (
    <>
      {/* Keyed by the search, so Back (or Clear search) puts the right text back in the box. */}
      <HomeSearchForm key={searchKey} search={search} isEditor={isEditor} />

      {isSearching && (
        <div className="mb-6 flex items-center gap-3">
          <h2 className="mr-auto min-w-0 truncate text-lg font-extrabold text-text-primary">
            {search.q ? `Results for “${search.q}”` : "Search results"}
          </h2>
          <Link
            href="/"
            className="flex items-center gap-2 rounded-dropdown px-2.5 py-1 text-[13px] font-semibold text-text-secondary hover:text-text-primary"
          >
            <XIcon size={14} />
            Clear search
            <LinkPending />
          </Link>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="tablist" className="flex max-w-full gap-1 overflow-x-auto rounded-button bg-bg-surface p-1">
          {tabs.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setPicked({ searchKey, tab: id })}
              className={`flex shrink-0 items-center gap-2 rounded-dropdown px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                tab === id ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {label}
              <span
                className={`rounded-dropdown px-1.5 text-[11px] ${
                  tab === id ? "bg-white/20 text-white" : "bg-bg-page text-text-secondary"
                }`}
              >
                {counts[id]}
              </span>
            </button>
          ))}
        </div>

        <span className="ml-auto">
          {tab === "mine" && !isSearching && myCards.length > 0 && (
            <Link href="/presentations" className="text-sm font-semibold text-text-primary hover:underline">
              See all ({myCards.length})
            </Link>
          )}
          {tab === "quizmatter" && !isSearching && adminCards.length > 0 && (
            <div className="flex gap-1">
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
        </span>
      </div>

      <section role="tabpanel" className="mb-10">
        {tab === "mine" && (
          <Cards
            {...cardsProps}
            cards={mine}
            showMenu
            empty={
              isSearching
                ? noMatch("presentations of yours")
                : "No presentations yet. Click “+ New presentation” to make one, or ask Claude to send you one."
            }
          />
        )}
        {tab === "quizmatter" && (
          <Cards
            {...cardsProps}
            cards={fromAdmins}
            empty={isSearching ? noMatch("QuizMatter presentations") : "QuizMatter hasn't shared any presentations yet."}
          />
        )}
        {tab === "reviewed" && (
          <>
            {openReviews.length > 0 && (
              <>
                <PartLabel>In progress</PartLabel>
                <ReviewRows rows={openReviews} />
              </>
            )}
            {canceledReviews.length > 0 && (
              <>
                <PartLabel className={openReviews.length > 0 ? "mt-6" : ""}>Canceled</PartLabel>
                <ReviewRows rows={canceledReviews} />
              </>
            )}
            {reviewedCards.length > 0 ? (
              <>
                {!isSearching && <PartLabel className={myReviews.length > 0 ? "mt-6" : ""}>Published</PartLabel>}
                <Cards {...cardsProps} cards={reviewedCards} empty="" />
              </>
            ) : (
              myReviews.length === 0 && (
                <Empty>
                  {isSearching ? noMatch("presentations you reviewed") : "You haven't reviewed any presentations yet."}
                </Empty>
              )
            )}
          </>
        )}
        {tab === "saved" && (
          <Cards
            {...cardsProps}
            cards={saved}
            empty={isSearching ? noMatch("saved presentations") : "You haven't saved any presentations yet."}
          />
        )}
        {tab === "teachers" && (
          <Cards
            {...cardsProps}
            cards={otherCards}
            empty={isSearching ? noMatch("published presentations") : "No other teacher has published a presentation yet."}
          />
        )}
      </section>

      {isPresenting && <PresentationView />}
    </>
  );
}

/**
 * The home page's search box and its options. Enter or Search puts the search in the page link, and the server
 * looks it up in the database (page.tsx).
 */
function HomeSearchForm({ search, isEditor }: { search: HomeSearch; isEditor: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState(search);
  const [isPending, startTransition] = useTransition();
  const set = (change: Partial<HomeSearch>) => setValues({ ...values, ...change });

  return (
    <SearchForm
      query={values.q}
      onQueryChange={(q) => set({ q })}
      placeholder="Search presentations"
      hasOptions={homeSearchQuery({ ...values, q: "" }) !== ""}
      isPending={isPending}
      // The top line and spinner show at once, and stay until the server sends the results.
      onSearch={(q) => startTransition(() => router.push(`/${homeSearchQuery({ ...values, q })}`, { scroll: false }))}
      onClear={() => setValues(DEFAULT_SEARCH)}
      className="mx-auto mb-10 max-w-xl"
    >
      <SearchField label="Title">
        <SearchTextInput value={values.title} onChange={(title) => set({ title })} />
      </SearchField>
      <SearchField label="Subject">
        <SearchTextInput value={values.subject} onChange={(subject) => set({ subject })} />
      </SearchField>
      <SearchField label="Author">
        <SearchTextInput value={values.author} onChange={(author) => set({ author })} />
      </SearchField>
      <SearchField label="Tags">
        <SearchTextInput value={values.tags} onChange={(tags) => set({ tags })} />
      </SearchField>
      <SearchField label="Includes the words">
        <SearchTextInput value={values.q} onChange={(q) => set({ q })} />
      </SearchField>
      <SearchField label="Doesn't have">
        <SearchTextInput value={values.not} onChange={(not) => set({ not })} />
      </SearchField>
      <SearchField label="Grade">
        <SearchSelect
          value={values.grade}
          options={[{ id: "", label: "Any grade" }, ...GRADES.map((grade) => ({ id: grade, label: grade }))]}
          onChange={(grade) => set({ grade })}
        />
      </SearchField>
      <SearchField label="Changed within">
        <SearchSelect value={values.within} options={WITHIN} onChange={(within) => set({ within })} />
      </SearchField>
      <SearchField label="Look in">
        <SearchSelect
          value={values.in}
          options={isEditor ? LOOK_IN : LOOK_IN.filter(({ id }) => id !== "reviewed")}
          onChange={(value) => set({ in: value })}
        />
      </SearchField>
      <SearchField label="Sort by">
        <SearchSelect value={values.sort} options={SORTS} onChange={(sort) => set({ sort })} />
      </SearchField>
    </SearchForm>
  );
}

function Cards({
  cards,
  showMenu,
  empty,
  savedIds,
  onSavedChange,
}: {
  cards: PresentationCardData[];
  showMenu?: boolean;
  empty: string;
  savedIds: Set<string>;
  onSavedChange: (card: PresentationCardData, isSaved: boolean) => void;
}) {
  if (cards.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((card) => (
        <PresentationCard
          key={card.id}
          card={{ ...card, isSaved: savedIds.has(card.id) }}
          showMenu={showMenu}
          onSavedChange={onSavedChange}
        />
      ))}
    </div>
  );
}

/** A small heading for one part of a tab, like "In progress" in My reviews. */
function PartLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h3 className={`mb-2 text-[11px] font-bold tracking-[0.05em] text-text-header uppercase ${className}`}>{children}</h3>;
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-card border border-border-default bg-bg-surface px-5 py-8 text-center text-sm text-text-secondary">
      {children}
    </p>
  );
}
