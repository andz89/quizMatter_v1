"use client";

import { useState, useTransition, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { XIcon } from "lucide-react";
import { DndContext, DragOverlay, MouseSensor, rectIntersection, TouchSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import { toast } from "sonner";
import { useEditorStore } from "@/lib/store";
import type { Folder } from "@/lib/folders";
import { GRADES, OTHER_CHOICE, SUBJECTS, isOtherSubject } from "@/lib/schema";
import { LinkPending } from "@/components/LinkPending";
import { SearchField, SearchForm, SearchSelect, SearchTextInput } from "@/components/SearchForm";
import { PresentationCard, type PresentationCardData } from "./PresentationCard";
import { ReviewRows, type MyReviewRow } from "./MyReviews";
import {
  DraggableCard,
  DraggedCards,
  FolderHeader,
  FolderTiles,
  MoveToFolderModal,
  SelectRow,
  folderDropId,
  movedMessage,
} from "./MyFolders";
import { moveToFolder } from "./folderActions";
import { DEFAULT_SEARCH, homeSearchQuery, LOOK_IN, SORTS, WITHIN, type HomeSearch } from "./homeSearch";

// Only downloaded when the teacher clicks Present on a card.
const PresentationView = dynamic(() =>
  import("@/components/presentation/PresentationView").then((mod) => mod.PresentationView)
);

// How many cards a row shows: my presentations, and each subject group in "From QuizMatter" ("See all" opens the rest).
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
  folders,
  adminCards,
  otherCards,
  savedCards,
  reviewedCards,
  myReviews,
  isEditor,
  search,
  isSearching,
}: {
  // My presentations and Claude's drafts; `folderId` says which of my folders each one is in.
  myCards: PresentationCardData[];
  folders: Folder[];
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
    // Newest saved first, like page.tsx.
    setSaved((cards) =>
      isSaved
        ? [card, ...cards.filter((saved) => saved.id !== card.id)]
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
  // The picked tab and subject chip belong to one search; a new search starts again from its first tab and "All".
  const searchKey = homeSearchQuery(search);
  const [picked, setPicked] = useState({ searchKey, tab: firstTab, subject: "" });
  const isThisSearch = picked.searchKey === searchKey;
  const tab = isThisSearch ? picked.tab : firstTab;
  const subject = isThisSearch ? picked.subject : "";
  // The cards of the picked subject chip ("" = All).
  const ofSubject = <Card extends PresentationCardData>(cards: Card[]) =>
    subject === "" ? cards : cards.filter((card) => subjectChip(card.subject ?? "") === subject);

  // My presentations: the search's matches, an open folder's, or (with the folder tiles above) those in no folder.
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  // A deleted folder is gone from `folders`, so the tab goes back to the tiles by itself.
  const openFolder = isSearching ? undefined : folders.find((folder) => folder.id === openFolderId);
  // The cards the Move to folder box is open for (one from a card's ⋮ menu, or the checked ones).
  const [movingCards, setMovingCards] = useState<PresentationCardData[] | null>(null);
  // Picking several of my cards: "Select multiple" turns select mode on (a click then picks a card), or a Shift+click
  // picks one. Picks and select mode end after a move, and when the shown cards change (folder, tab).
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [isSelectMode, setIsSelectMode] = useState(false);
  const clearChecked = () => setCheckedIds(new Set());
  const endSelecting = () => {
    clearChecked();
    setIsSelectMode(false);
  };
  const toggleChecked = (id: string) =>
    setCheckedIds((ids) => {
      const next = new Set(ids);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // Dragging a card onto a folder tile (or onto "← My presentations", to take it out of its folder). Mouse: after
  // moving 4px, like the editor; touch: after pressing and holding, so a quick swipe still scrolls the page.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  );
  // The cards being dragged: a checked card takes every checked one along; an unchecked one goes alone.
  const [draggedCards, setDraggedCards] = useState<PresentationCardData[]>([]);
  // The folder dropped cards are being moved to ("" = out of their folder), which shows the Spinner.
  const [movingTo, setMovingTo] = useState<string | null>(null);
  const canDrag = tab === "mine" && !isSearching && movingTo === null;

  const myShown = isSearching ? myCards : myCards.filter((card) => card.folderId === openFolder?.id);
  const mine = isSearching || openFolder ? ofSubject(myShown) : ofSubject(myShown).slice(0, MY_ROW_SIZE);
  // Only cards on screen count, so a chip or folder never moves something hidden.
  const checkedCards = mine.filter((card) => checkedIds.has(card.id));
  // The circles show in select mode, or while Shift+click picks are there.
  const isSelecting = isSelectMode || checkedCards.length > 0;

  const startDrag = ({ active }: DragStartEvent) => {
    const card = active.data.current?.card as PresentationCardData | undefined;
    if (card) setDraggedCards(checkedIds.has(card.id) ? checkedCards : [card]);
  };
  const dropCards = async ({ over }: DragEndEvent) => {
    const folderId = [{ id: "" }, ...folders].find(({ id }) => folderDropId(id) === over?.id)?.id;
    // Ones already in that folder stay as they are.
    const cards = draggedCards.filter((card) => (card.folderId ?? "") !== folderId);
    setDraggedCards([]);
    if (folderId === undefined || cards.length === 0) return;
    setMovingTo(folderId);
    const error = await moveToFolder(
      cards.map((card) => card.id),
      folderId || null
    );
    setMovingTo(null);
    if (error) toast.error(error);
    else {
      toast.success(movedMessage(cards.length, folders.find(({ id }) => id === folderId)?.name));
      endSelecting();
    }
  };
  // While searching, the search's own Sort decides the order.
  const fromAdmins = ofSubject(isSearching ? adminCards : [...adminCards].sort((a, b) => b[adminSort] - a[adminSort]));
  const tabCards: Record<Tab, PresentationCardData[]> = {
    mine: myShown,
    quizmatter: adminCards,
    reviewed: reviewedCards,
    saved,
    teachers: otherCards,
  };
  const noMatch = (what: string) => `No ${what} match your search.`;

  return (
    <DndContext
      sensors={sensors}
      // The card's copy sits centered on the pointer, and the folder it overlaps most is where it drops (people aim
      // the copy, not the mouse). Set here, not on the DragOverlay, so the drop check uses the same spot.
      modifiers={[snapCenterToCursor]}
      collisionDetection={rectIntersection}
      onDragStart={startDrag}
      onDragCancel={() => setDraggedCards([])}
      onDragEnd={dropCards}
    >
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
              onClick={() => {
                setPicked({ searchKey, tab: id, subject: "" });
                endSelecting();
              }}
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

      {tab === "mine" && openFolder && (
        <FolderHeader
          folder={openFolder}
          isMovingOut={movingTo === ""}
          onBack={() => {
            setOpenFolderId(null);
            endSelecting();
          }}
        />
      )}

      <SubjectChips cards={tabCards[tab]} picked={subject} onPick={(subject) => setPicked({ searchKey, tab, subject })} />

      <section role="tabpanel" className="mb-10">
        {tab === "mine" && mine.length > 0 && (
          <SelectRow
            count={checkedCards.length}
            isSelecting={isSelecting}
            onStart={() => setIsSelectMode(true)}
            onDone={endSelecting}
            onClear={clearChecked}
            onMove={() => setMovingCards(checkedCards)}
          />
        )}
        {tab === "mine" && (
          <Cards
            {...cardsProps}
            cards={mine}
            showMenu
            onMoveToFolder={(card) => setMovingCards([card])}
            selection={{ checkedIds, isSelecting, onToggle: toggleChecked }}
            canDrag={canDrag}
            fadedIds={new Set(draggedCards.map((card) => card.id))}
            empty={
              isSearching
                ? noMatch("presentations of yours")
                : openFolder
                  ? "This folder is empty. To add a presentation, open its ⋮ menu and pick “Move to folder…”."
                  : myCards.length > 0
                    ? "All your presentations are in folders."
                    : "No presentations yet. Click “+ New presentation” to make one, or ask Claude to send you one."
            }
          />
        )}
        {tab === "mine" && !isSearching && !openFolder && (
          <>
            <PartLabel className="mt-8">Folders</PartLabel>
            <FolderTiles
              folders={folders}
              movingTo={movingTo}
              onOpen={(id) => {
                setOpenFolderId(id);
                setPicked({ searchKey, tab, subject: "" });
                endSelecting();
              }}
            />
          </>
        )}
        {tab === "quizmatter" &&
          (!isSearching && subject === "" && fromAdmins.some((card) => card.subject) ? (
            <SubjectGroups
              {...cardsProps}
              cards={fromAdmins}
              onSeeAll={(subject) => setPicked({ searchKey, tab, subject })}
            />
          ) : (
            <Cards
              {...cardsProps}
              cards={fromAdmins}
              empty={isSearching ? noMatch("QuizMatter presentations") : "QuizMatter hasn't shared any presentations yet."}
            />
          ))}
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
                <Cards {...cardsProps} cards={ofSubject(reviewedCards)} empty="" />
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
            cards={ofSubject(saved)}
            empty={isSearching ? noMatch("saved presentations") : "You haven't saved any presentations yet."}
          />
        )}
        {tab === "teachers" && (
          <Cards
            {...cardsProps}
            cards={ofSubject(otherCards)}
            empty={isSearching ? noMatch("published presentations") : "No other teacher has published a presentation yet."}
          />
        )}
      </section>

      {movingCards && (
        <MoveToFolderModal cards={movingCards} folders={folders} onMoved={endSelecting} onClose={() => setMovingCards(null)} />
      )}
      {isPresenting && <PresentationView />}
      <DragOverlay dropAnimation={null}>{draggedCards.length > 0 && <DraggedCards cards={draggedCards} />}</DragOverlay>
    </DndContext>
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
        <SearchSelect
          value={values.subject}
          options={[
            { id: "", label: "Any subject" },
            ...SUBJECTS.map((subject) => ({ id: subject, label: subject })),
            { id: OTHER_CHOICE, label: OTHER_CHOICE },
          ]}
          onChange={(subject) => set({ subject })}
        />
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
          options={[
            { id: "", label: "Any grade" },
            ...GRADES.map((grade) => ({ id: grade, label: grade })),
            { id: OTHER_CHOICE, label: OTHER_CHOICE },
          ]}
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

/** The chip a subject falls under: its own name, "Other" for one not on the list, "" for none. */
function subjectChip(subject: string): string {
  return isOtherSubject(subject) ? OTHER_CHOICE : subject;
}

/**
 * "All", then each subject the tab's cards have, then "Other", each with its count. Hidden when no card has a
 * subject. A chip with no cards is left out, unless it's the picked one (e.g. after removing a bookmark).
 */
function SubjectChips({ cards, picked, onPick }: { cards: PresentationCardData[]; picked: string; onPick: (subject: string) => void }) {
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
            {id && cards.length > MY_ROW_SIZE && (
              <button type="button" onClick={() => onSeeAll(id)} className="mb-2 text-sm font-semibold text-text-primary hover:underline">
                See all ({cards.length})
              </button>
            )}
          </div>
          <Cards {...cardsProps} cards={id ? cards.slice(0, MY_ROW_SIZE) : cards} empty="" />
        </div>
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
