import { createClient } from "@/lib/supabase/server";
import { listDrafts, type DraftSummary } from "@/lib/drafts";
import { joinParts, slideCountLabel, timeAgo } from "@/lib/format";
import { slideSchema, type Slide } from "@/lib/schema";
import { LogoutButton, NewQuizButton } from "./QuizListButtons";
import { LessonHome } from "./LessonHome";
import type { LessonCardData } from "./LessonCard";

// How many published lessons from other teachers the home page shows.
const OTHERS_LIMIT = 20;

// Each lesson's first slide only (for the card's picture), not all of them, to keep the page light.
const CARD_COLUMNS =
  "id, title, grade, subject, author, is_published, updated_at, slides(count), first_slide:slides(data, position)";

export default async function HomePage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const myId = claims?.claims.sub ?? "";

  const [mine, others, drafts] = await Promise.all([
    supabase
      .from("quizzes")
      .select(CARD_COLUMNS)
      .eq("owner_id", myId)
      .order("updated_at", { ascending: false })
      .order("position", { referencedTable: "first_slide" })
      .limit(1, { referencedTable: "first_slide" }),
    supabase
      .from("quizzes")
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
          <h1 className="text-base font-semibold text-text-primary">Lessons</h1>
          <p className="mt-0.5 text-sm text-text-secondary">Your lessons, and the ones other teachers published.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <LogoutButton />
          <NewQuizButton />
        </div>
      </header>

      <LessonHome myCards={myCards} otherCards={otherCards} />
    </main>
  );
}

type CardQuiz = {
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

/** My lessons and Claude's drafts (newest first), and other teachers' published lessons, as cards. */
function buildCards(mine: CardQuiz[], others: CardQuiz[], drafts: DraftSummary[]) {
  const now = Date.now();
  const savedIds = new Set(mine.map((quiz) => quiz.id));
  const myCards: (LessonCardData & { sortTime: number })[] = [
    ...mine.map((quiz) => ({
      ...toCard(quiz, `/quiz/${quiz.id}`, now),
      badge: quiz.is_published ? ("published" as const) : undefined,
      sortTime: Date.parse(quiz.updated_at),
    })),
    // Claude's drafts that aren't saved yet (see /lessons). Their slides are only a recipe, so no picture.
    ...drafts
      .filter((draft) => !savedIds.has(draft.id))
      .map((draft) => ({
        id: draft.id,
        href: `/quiz/new?draft=${draft.id}`,
        title: draft.title || "Untitled lesson",
        meta: joinParts([draft.grade, draft.subject, slideCountLabel(draft.slideCount), timeAgo(draft.createdAt, now)]),
        firstSlide: null,
        badge: "draft" as const,
        sortTime: draft.createdAt,
      })),
  ].sort((a, b) => b.sortTime - a.sortTime);

  const otherCards = others.map((quiz) => ({
    ...toCard(quiz, `/lesson/${quiz.id}`, now),
    byline: quiz.author ? `By ${quiz.author}` : undefined,
  }));

  return { myCards, otherCards };
}

function toCard(quiz: CardQuiz, href: string, now: number): LessonCardData {
  const slideCount = quiz.slides[0]?.count ?? 0;
  return {
    id: quiz.id,
    href,
    title: quiz.title || "Untitled lesson",
    meta: joinParts([quiz.grade, quiz.subject, slideCountLabel(slideCount), timeAgo(Date.parse(quiz.updated_at), now)]),
    firstSlide: parseSlide(quiz.first_slide[0]?.data),
  };
}

/** The slide, checked against the schema. A slide in an old or broken shape just shows no picture. */
function parseSlide(data: unknown): Slide | null {
  const result = slideSchema.safeParse(data);
  return result.success ? result.data : null;
}
