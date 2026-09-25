import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton, NewQuizButton } from "./QuizListButtons";

export default async function QuizListPage({ searchParams }: PageProps<"/">) {
  // Set when the user opens a link Claude gave them (see /api/mcp): picking a quiz loads that draft into it.
  const { draft } = await searchParams;
  const draftQuery = typeof draft === "string" ? `?draft=${encodeURIComponent(draft)}` : "";
  const supabase = await createClient();
  const { data: quizzes, error } = await supabase
    .from("quizzes")
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <header className="mb-5 flex items-center gap-3">
        <h1 className="text-base font-semibold text-text-primary">
          My quizzes <span className="font-normal text-text-secondary">({quizzes.length})</span>
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <LogoutButton />
          <NewQuizButton draftQuery={draftQuery} />
        </div>
      </header>

      {draftQuery && (
        <p className="mb-5 rounded-card border border-border-default bg-bg-surface px-5 py-3.5 text-sm text-text-primary">
          Claude sent you slides. Pick a quiz to put them in, or make a new one. They replace that quiz’s slides, and
          nothing is saved until you click Save.
        </p>
      )}

      <div className="rounded-card border border-border-default bg-bg-surface">
        <div className="flex border-b border-border-default px-5 py-3 text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">
          <span>Title</span>
          <span className="ml-auto">Last saved</span>
        </div>
        {quizzes.length === 0 ? (
          <p className="px-5 py-4 text-sm text-text-secondary">No quizzes yet. Click “+ New quiz” to make one.</p>
        ) : (
          quizzes.map((quiz) => (
            <Link
              key={quiz.id}
              href={`/quiz/${quiz.id}${draftQuery}`}
              className="flex h-13 items-center border-b border-border-default px-5 text-sm text-text-primary last:border-b-0 hover:bg-bg-page"
            >
              <span className="truncate">{quiz.title || "Untitled quiz"}</span>
              <span className="ml-auto shrink-0 pl-4 text-text-secondary">
                {new Date(quiz.updated_at).toLocaleDateString("en-US", { dateStyle: "medium" })}
              </span>
            </Link>
          ))
        )}
      </div>
    </main>
  );
}
