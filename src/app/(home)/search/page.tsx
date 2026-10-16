import { Suspense } from "react";
import Link from "next/link";
import { XIcon } from "lucide-react";
import { getAccount } from "@/lib/account";
import { createClient } from "@/lib/supabase/server";
import { listDrafts, type DraftSummary } from "@/lib/drafts";
import { LinkPending } from "@/components/LinkPending";
import { changedSince, homeSearchQuery, parseHomeSearch, type HomeSearch } from "../../homeSearch";
import type { SubmissionStatus } from "@/lib/submissions";
import { CARD_COLUMNS, applySearch, draftCard, draftMatches, loadCardContext, myCard, myId, mySubmissionStatuses, orderBy, type CardPresentation } from "../cards";
import { SavableCards } from "../CardGrid";
import { ShowMore } from "../ShowMore";

/** Search results: one mixed list for the chosen "Look in", with the total, 20 at a time ("Show more" adds 20). */
export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const search = parseHomeSearch(await searchParams);
  const account = await getAccount();
  const supabase = await createClient();
  const me = await myId(supabase);
  const isMine = search.in === "mine";

  const base = supabase.from("presentations").select(CARD_COLUMNS, { count: "exact" });
  const query =
    isMine ? base.eq("owner_id", me).eq("from_admin", false)
    : search.in === "quizmatter" ? base.eq("is_published", true).is("hidden_at", null).eq("from_admin", true)
    : search.in === "teachers" ? base.eq("is_published", true).is("hidden_at", null).eq("from_admin", false).neq("owner_id", me)
    // All shared: QuizMatter's and other teachers' (my own aren't in it, so my copies don't sit next to the originals).
    : base.eq("is_published", true).is("hidden_at", null).or(`from_admin.eq.true,owner_id.neq.${me}`);

  const [{ data, count, error }, drafts, submissionOf] = await Promise.all([
    orderBy(applySearch(query, search), search.sort).range(0, search.shown - 1),
    // Claude's drafts are only mine; an admin's become QuizMatter presentations, so they have none here.
    isMine && !account.isAdmin ? listDrafts(account.id) : [],
    // Editors: which of mine were sent to QuizMatter, for the card's label and menu.
    mySubmissionStatuses(supabase, isMine && account.isEditor),
  ]);
  if (error) throw error;

  let cards;
  let draftCount = 0;
  if (isMine) {
    const mine = buildMineCards(data, drafts, search, account, submissionOf);
    cards = mine.cards;
    draftCount = mine.draftCount;
  } else {
    const { toSavableCard } = await loadCardContext(supabase, data, me);
    cards = data.map(toSavableCard);
  }
  const total = (count ?? 0) + draftCount;

  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <div className="mr-auto min-w-0">
          <h2 className="truncate text-lg font-extrabold text-text-primary">
            {search.q ? `Results for “${search.q}”` : "Search results"}
          </h2>
          <p className="text-[13px] text-text-secondary">{total === 1 ? "1 result" : `${total} results`}</p>
        </div>
        <Link
          href="/"
          className="flex items-center gap-2 rounded-dropdown px-2.5 py-1 text-[13px] font-semibold text-text-secondary hover:text-text-primary"
        >
          <XIcon size={14} />
          Clear search
          <LinkPending />
        </Link>
      </div>

      {/* My own cards have no bookmark (canSave is off) but get the ⋮ menu. Keyed by the whole search (with how many
          show), so a new search or "Show more" takes the bookmarks from the fresh data, not the last results. */}
      <SavableCards
        key={homeSearchQuery(search)}
        cards={cards}
        showMenu={isMine}
        empty="No presentations match your search."
      />
      {/* Reads the address, so it waits for it in the browser. */}
      <Suspense>
        {/* Pages only the saved presentations: the drafts always show and aren't paged. */}
        <ShowMore shown={search.shown} total={count ?? 0} />
      </Suspense>
    </>
  );
}

/** My matching drafts first (only a few, so they aren't paged; one already saved shows as itself), then my presentations. */
function buildMineCards(
  mine: CardPresentation[],
  drafts: DraftSummary[],
  search: HomeSearch,
  account: { isSuperAdmin: boolean; isEditor: boolean },
  submissionOf: Map<string, SubmissionStatus>,
) {
  const now = Date.now();
  const since = changedSince(search);
  const loadedIds = new Set(mine.map((presentation) => presentation.id));
  const matchingDrafts = drafts.filter((draft) => !loadedIds.has(draft.id) && draftMatches(draft, search, since));
  return {
    cards: [...matchingDrafts.map((draft) => draftCard(draft, now)), ...mine.map((presentation) =>
        myCard(presentation, account.isSuperAdmin, now, { isEditor: account.isEditor, submission: submissionOf.get(presentation.id) }),
      )],
    draftCount: matchingDrafts.length,
  };
}
