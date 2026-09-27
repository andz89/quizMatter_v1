import { createClient } from "@/lib/supabase/server";
import { listDrafts, type DraftSummary } from "@/lib/drafts";
import { joinParts, slideCountLabel, timeAgo } from "@/lib/format";
import { parseSlide } from "@/lib/schema";
import { LogoutButton, NewPresentationButton } from "./PresentationListButtons";
import { PresentationHome } from "./PresentationHome";
import type { PresentationCardData } from "./PresentationCard";

// How many published presentations from other teachers the home page shows.
const OTHERS_LIMIT = 20;

// Each presentation's first slide only (for the card's picture), not all of them, to keep the page light.
const CARD_COLUMNS =
  "id, title, grade, subject, author, is_published, updated_at, slides(count), first_slide:slides(data, position)";

export default async function HomePage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const myId = claims?.claims.sub ?? "";

  const [mine, others, drafts] = await Promise.all([
    supabase
      .from("presentations")
      .select(CARD_COLUMNS)
      .eq("owner_id", myId)
      .order("updated_at", { ascending: false })
      .order("position", { referencedTable: "first_slide" })
      .limit(1, { referencedTable: "first_slide" }),
    supabase
      .from("presentations")
      .select(CARD_COLUMNS)
      .eq("is_published", true)
      .neq("owner_id", myId)
      .order("updated_at", { ascending: false })
      .order("position", { referencedTable: "first_slide" })
      .limit(1, { referencedTable: "first_slide" })
      .limit(OTHERS_LIMIT),
    listDrafts(),
  ]);
  if (mine.error) throw mine.error;
  if (others.error) throw others.error;

  const { myCards, otherCards } = buildCards(mine.data, others.data, drafts);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:py-14">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-base font-semibold text-text-primary">Presentations</h1>
          <p className="mt-0.5 text-sm text-text-secondary">Your presentations, and the ones other teachers published.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <LogoutButton />
          <NewPresentationButton />
        </div>
      </header>

      <PresentationHome myCards={myCards} otherCards={otherCards} />
    </main>
  );
}

type CardPresentation = {
  id: string;
  title: string;
  grade: string;
  subject: string;
  author: string;
  is_published: boolean;
  updated_at: string;
  slides: { count: number }[];
  first_slide: { data: unknown }[];
};

/** My presentations and Claude's drafts (newest first), and other teachers' published presentations, as cards. */
function buildCards(mine: CardPresentation[], others: CardPresentation[], drafts: DraftSummary[]) {
  const now = Date.now();
  const savedIds = new Set(mine.map((presentation) => presentation.id));
  const myCards: (PresentationCardData & { sortTime: number })[] = [
    ...mine.map((presentation) => ({
      ...toCard(presentation, `/presentation/${presentation.id}/edit`, now),
      badge: presentation.is_published ? ("published" as const) : undefined,
      sortTime: Date.parse(presentation.updated_at),
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
        sortTime: draft.createdAt,
      })),
  ].sort((a, b) => b.sortTime - a.sortTime);

  const otherCards = others.map((presentation) => ({
    ...toCard(presentation, `/presentation/${presentation.id}`, now),
    byline: presentation.author ? `By ${presentation.author}` : undefined,
  }));

  return { myCards, otherCards };
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
