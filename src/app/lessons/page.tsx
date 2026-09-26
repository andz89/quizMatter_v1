import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DRAFT_LIFETIME_MS, listDrafts, type DraftSummary } from "@/lib/drafts";
import { joinParts, timeAgo } from "@/lib/format";
import { NewQuizButton } from "../QuizListButtons";
import { QuizList, type QuizRow } from "./QuizList";

/** "See all" from the home page: every lesson of mine and every draft from Claude, as a table. */
export default async function AllLessonsPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const [{ data: quizzes, error }, drafts] = await Promise.all([
    supabase
      .from("quizzes")
      .select("id, title, grade, subject, is_published, updated_at, slides(count)")
      // Other teachers' published lessons are readable too, so only take mine.
      .eq("owner_id", claims?.claims.sub ?? "")
      .order("updated_at", { ascending: false }),
    listDrafts(),
  ]);
  if (error) throw error;

  const rows = buildRows(quizzes, drafts);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:py-14">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <Link href="/" className="text-sm text-text-secondary transition-colors hover:text-text-primary">
            ← Home
          </Link>
          <h1 className="mt-2 text-base font-semibold text-text-primary">All my lessons</h1>
          <p className="mt-0.5 text-sm text-text-secondary">Your saved lessons, and the ones Claude sent you.</p>
        </div>
        <div className="ml-auto">
          <NewQuizButton />
        </div>
      </header>

      <QuizList rows={rows} />
    </main>
  );
}

type SavedQuiz = {
  id: string;
  title: string;
  grade: string;
  subject: string;
  is_published: boolean;
  updated_at: string;
  slides: { count: number }[];
};

/** Saved quizzes and Claude's drafts as one list, newest first. */
function buildRows(quizzes: SavedQuiz[], drafts: DraftSummary[]): QuizRow[] {
  const now = Date.now();
  const savedIds = new Set(quizzes.map((quiz) => quiz.id));
  return [
    ...quizzes.map((quiz) => {
      const updatedAt = Date.parse(quiz.updated_at);
      return {
        id: quiz.id,
        title: quiz.title || "Untitled lesson",
        meta: joinParts([quiz.grade, quiz.subject]),
        status: "saved" as const,
        isPublished: quiz.is_published,
        slideCount: quiz.slides[0]?.count ?? 0,
        sortTime: updatedAt,
        dateLabel: timeAgo(updatedAt, now),
      };
    }),
    // A draft whose quiz is already saved is done (the saved quiz took the draft's id — see /quiz/new).
    ...drafts
      .filter((draft) => !savedIds.has(draft.id))
      .map((draft) => ({
        id: draft.id,
        title: draft.title || "Untitled lesson",
        meta: joinParts([draft.grade, draft.subject]),
        status: "draft" as const,
        slideCount: draft.slideCount,
        sortTime: draft.createdAt,
        dateLabel: timeAgo(draft.createdAt, now),
        checking: draft.state === "checking",
        note: {
          ready: `From Claude · not saved yet · ${expiresIn(draft.createdAt + DRAFT_LIFETIME_MS - now)}`,
          checking: "From Claude · checking the layout",
          unfinished: `From Claude · Not finished: Claude didn't send the final version · ${expiresIn(draft.createdAt + DRAFT_LIFETIME_MS - now)}`,
        }[draft.state],
      })),
  ].sort((a, b) => b.sortTime - a.sortTime);
}

function expiresIn(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 1 ? `expires in ${hours} hr` : "expires soon";
}
