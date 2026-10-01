import { NavBar } from "@/components/NavBar";
import { getAccount } from "@/lib/account";
import { createClient } from "@/lib/supabase/server";
import { listDrafts, type DraftSummary } from "@/lib/drafts";
import { loadPublisherNames } from "@/lib/publishers";
import { joinParts, publishedByLine, slideCountLabel, timeAgo } from "@/lib/format";
import { parseSlide } from "@/lib/schema";
import { contains } from "@/lib/search";
import { NewPresentationButton } from "./PresentationListButtons";
import { PresentationHome } from "./PresentationHome";
import type { PresentationCardData } from "./PresentationCard";
import type { AdminCardData } from "./PresentationHome";
import { changedSince, homeSearchQuery, parseHomeSearch, type HomeSearch } from "./homeSearch";

// How many published presentations from other teachers the home page shows.
const OTHERS_LIMIT = 20;

// How many matches each section shows while searching.
const SEARCH_LIMIT = 50;

// Each presentation's first slide only (for the card's picture), not all of them, to keep the page light.
const CARD_COLUMNS =
  "id, owner_id, title, grade, subject, author, is_published, hidden_at, created_at, updated_at, slides(count), first_slide:slides(data, position)";

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const search = parseHomeSearch(await searchParams);
  const isSearching = homeSearchQuery(search) !== "";
  const since = changedSince(search);
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const myId = claims?.claims.sub ?? "";

  // Which rows a section takes. "From QuizMatter": what admins shared with every teacher (from Admin → Presentations).
  const sections = {
    // QuizMatter presentations an admin made are on Admin → Presentations, not in "mine".
    mine: () => supabase.from("presentations").select(CARD_COLUMNS).eq("owner_id", myId).eq("from_admin", false),
    // Hidden ones are already left out by the database, except for admins (who can see them on Admin → Reports).
    quizmatter: () =>
      supabase.from("presentations").select(CARD_COLUMNS).eq("is_published", true).is("hidden_at", null).eq("from_admin", true).neq("owner_id", myId),
    teachers: () =>
      supabase.from("presentations").select(CARD_COLUMNS).eq("is_published", true).is("hidden_at", null).eq("from_admin", false).neq("owner_id", myId),
  };
  // A section the search's "Look in" leaves out is simply empty.
  const isLeftOut = (section: keyof typeof sections) => isSearching && search.in !== "all" && search.in !== section;

  const load = (section: keyof typeof sections, limit?: number) => {
    if (isLeftOut(section)) return Promise.resolve({ data: [], error: null });
    let query = sections[section]();
    if (isSearching) {
      if (search.q) {
        const pattern = contains(search.q);
        query = query.or(`title.ilike.${pattern},subject.ilike.${pattern},author.ilike.${pattern},tags_text.ilike.${pattern}`);
      }
      if (search.title) query = query.ilike("title", contains(search.title));
      if (search.subject) query = query.ilike("subject", contains(search.subject));
      if (search.author) query = query.ilike("author", contains(search.author));
      // tags_text: the tags as one line of text, so part of a tag is found too (see the presentation_tags migration).
      if (search.tags) query = query.ilike("tags_text", contains(search.tags));
      if (search.not) {
        const pattern = contains(search.not);
        query = query
          .not("title", "ilike", pattern)
          .not("subject", "ilike", pattern)
          .not("author", "ilike", pattern)
          .not("tags_text", "ilike", pattern);
      }
      if (search.grade) query = query.eq("grade", search.grade);
      if (since) query = query.gte("updated_at", new Date(since).toISOString());
      limit = SEARCH_LIMIT;
    }
    query = query
      .order(search.sort === "title" ? "title" : search.sort === "newest" ? "created_at" : "updated_at", { ascending: search.sort === "title" })
      .order("position", { referencedTable: "first_slide" })
      .limit(1, { referencedTable: "first_slide" });
    return limit ? query.limit(limit) : query;
  };

  const [mine, fromAdmins, others, drafts, account] = await Promise.all([
    load("mine"),
    load("quizmatter"),
    load("teachers", OTHERS_LIMIT),
    // An admin's drafts from Claude become QuizMatter presentations, so they're on Admin → Presentations.
    getAccount().then((account) => (account.isAdmin || isLeftOut("mine") ? [] : listDrafts(account.id))),
    getAccount(),
  ]);
  if (mine.error) throw mine.error;
  if (fromAdmins.error) throw fromAdmins.error;
  if (others.error) throw others.error;

  const publisherNames = await loadPublisherNames(supabase, others.data.map((presentation) => presentation.owner_id));
  const { myCards, adminCards, otherCards } = buildCards(
    mine.data,
    fromAdmins.data,
    others.data,
    isSearching ? drafts.filter((draft) => draftMatches(draft, search, since)) : drafts,
    publisherNames,
    account.isAdmin,
    search
  );

  return (
    <>
      <NavBar />

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
        <header className="mb-6 flex flex-wrap items-center gap-4">
          <div className="mr-auto">
            <h1 className="text-2xl font-extrabold text-text-primary">Presentations</h1>
            <p className="mt-1 text-sm text-text-secondary">Your presentations, and the ones other teachers published.</p>
          </div>
          <NewPresentationButton author={account.displayName} />
        </header>

        <PresentationHome
          myCards={myCards}
          adminCards={adminCards}
          otherCards={otherCards}
          search={search}
          isSearching={isSearching}
        />
      </main>
    </>
  );
}

/**
 * Claude's drafts aren't in the database yet, so they're checked here the same way the database checks the rest.
 * Drafts have no author, so an Author search leaves them out.
 */
function draftMatches(draft: DraftSummary, search: HomeSearch, since: number): boolean {
  const has = (text: string, part: string) => text.toLowerCase().includes(part.toLowerCase());
  const details = `${draft.title} ${draft.subject} ${draft.tags}`;
  return (
    has(details, search.q) &&
    has(draft.title, search.title) &&
    has(draft.subject, search.subject) &&
    has(draft.tags, search.tags) &&
    !search.author &&
    (!search.not || !has(details, search.not)) &&
    (!search.grade || draft.grade === search.grade) &&
    draft.createdAt >= since
  );
}

type CardPresentation = {
  id: string;
  owner_id: string;
  title: string;
  grade: string;
  subject: string;
  author: string;
  is_published: boolean;
  hidden_at: string | null;
  created_at: string;
  updated_at: string;
  slides: { count: number }[];
  first_slide: { data: unknown }[];
};

/**
 * My presentations and Claude's drafts (in the search's order), the ones admins shared ("From QuizMatter"), and other
 * teachers' published presentations, as cards.
 */
function buildCards(
  mine: CardPresentation[],
  fromAdmins: CardPresentation[],
  others: CardPresentation[],
  drafts: DraftSummary[],
  publisherNames: Map<string, string>,
  isAdmin: boolean,
  search: HomeSearch
) {
  const now = Date.now();
  const savedIds = new Set(mine.map((presentation) => presentation.id));
  const myCards: (PresentationCardData & { createdAt: number; updatedAt: number })[] = [
    ...mine.map((presentation) => ({
      ...toCard(presentation, `/presentation/${presentation.id}/edit`, now),
      // Hidden by an admin: other teachers can't see it, even if it's published.
      badge: presentation.hidden_at ? ("hidden" as const) : presentation.is_published ? ("published" as const) : undefined,
      canMoveToQuizMatter: isAdmin,
      createdAt: Date.parse(presentation.created_at),
      updatedAt: Date.parse(presentation.updated_at),
    })),
    // Claude's drafts that aren't saved yet (see /presentations). Their slides are only a recipe, so no picture.
    ...drafts
      .filter((draft) => !savedIds.has(draft.id))
      .map((draft) => ({
        id: draft.id,
        href: `/presentation/new?draft=${draft.id}`,
        title: draft.title || "Untitled presentation",
        meta: joinParts([draft.grade, draft.subject, slideCountLabel(draft.slideCount), timeAgo(draft.createdAt, now)]),
        firstSlide: null,
        badge: ({ ready: "draft", checking: "checking", unfinished: "unfinished" } as const)[draft.state],
        createdAt: draft.createdAt,
        updatedAt: draft.createdAt,
      })),
    // Drafts are mixed in, so the order the database gave is sorted again here.
  ].sort(
    search.sort === "title"
      ? (a, b) => a.title.localeCompare(b.title)
      : search.sort === "newest"
        ? (a, b) => b.createdAt - a.createdAt
        : (a, b) => b.updatedAt - a.updatedAt
  );

  const adminCards: AdminCardData[] = fromAdmins.map((presentation) => ({
    ...toCard(presentation, `/presentation/${presentation.id}`, now),
    createdAt: Date.parse(presentation.created_at),
    updatedAt: Date.parse(presentation.updated_at),
  }));

  const otherCards = others.map((presentation) => ({
    ...toCard(presentation, `/presentation/${presentation.id}`, now),
    byline: publishedByLine(presentation.author, publisherNames.get(presentation.owner_id)),
  }));

  return { myCards, adminCards, otherCards };
}

function toCard(presentation: CardPresentation, href: string, now: number): PresentationCardData {
  const slideCount = presentation.slides[0]?.count ?? 0;
  return {
    id: presentation.id,
    href,
    title: presentation.title || "Untitled presentation",
    meta: joinParts([presentation.grade, presentation.subject, slideCountLabel(slideCount), timeAgo(Date.parse(presentation.updated_at), now)]),
    firstSlide: parseSlide(presentation.first_slide[0]?.data),
  };
}
