import { createClient } from "@/lib/supabase/server";
import { DRAFT_LIFETIME_MS, listDrafts, type DraftSummary } from "@/lib/drafts";
import { LogoutButton, NewQuizButton } from "./QuizListButtons";
import { QuizList, type QuizRow } from "./QuizList";

export default async function QuizListPage() {
  const supabase = await createClient();
  const [{ data: quizzes, error }, drafts] = await Promise.all([
    supabase
      .from("quizzes")
      .select("id, title, grade, subject, is_published, updated_at, slides(count)").order("updated_at", { ascending: false }),
    listDrafts(),
  ]);
  if (error) throw error;

  const rows = buildRows(quizzes, drafts);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:py-14">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-base font-semibold text-text-primary">My lessons</h1>
          <p className="mt-0.5 text-sm text-text-secondary">Your saved lessons, and the ones Claude sent you.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <LogoutButton />
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
        meta: joinParts([quiz.grade, quiz.subject, quiz.is_published && "Published"]),
        status: "saved" as const,
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
        note: `From Claude · not saved yet · ${expiresIn(draft.createdAt + DRAFT_LIFETIME_MS - now)}`,
      })),
  ].sort((a, b) => b.sortTime - a.sortTime);
}

/** "Grade 4 · Mathematics", skipping the parts that aren't filled in. */
function joinParts(parts: (string | false | null)[]): string {
  return parts.filter(Boolean).join(" · ");
}

// Worked out here on the server so the page shows the same text before and after it loads in the browser.
function timeAgo(time: number, now: number): string {
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(time).toLocaleDateString("en-US", { dateStyle: "medium" });
}

function expiresIn(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 1 ? `expires in ${hours} hr` : "expires soon";
}
