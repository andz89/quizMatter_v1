import Link from "next/link";
import { redirect } from "next/navigation";
import { createBlankQuiz } from "@/lib/factories";
import { getDraft } from "@/lib/drafts";
import { createClient } from "@/lib/supabase/server";
import { QuizEditor } from "../[id]/QuizEditor";

/**
 * Opens a quiz Claude sent through the MCP server (the link /api/mcp hands out) as a new quiz. It
 * isn't saved yet: the editor shows it, and the user's Save creates it in the database.
 *
 * The new quiz takes the draft's id, so once it's saved the quiz list knows this draft is done
 * (and hides it), and opening the link again opens the saved quiz instead of a second copy.
 */
export default async function NewQuizFromClaudePage({ searchParams }: PageProps<"/quiz/new">) {
  const { draft: draftId } = await searchParams;
  if (typeof draftId !== "string") redirect("/");

  const supabase = await createClient();
  const { data: savedQuiz } = await supabase.from("quizzes").select("id").eq("id", draftId).maybeSingle();
  if (savedQuiz) redirect(`/quiz/${draftId}`);

  const draft = await getDraft(draftId);
  if (!draft) {
    return (
      <main className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-card border border-border-default bg-bg-surface px-5 py-6">
          <h1 className="mb-2 text-base font-semibold text-text-primary">This link has expired</h1>
          <p className="mb-5 text-sm text-text-secondary">
            Lessons from Claude stay for 24 hours. Ask Claude to send the lesson again.
          </p>
          <Link href="/" className="text-sm font-semibold text-accent-green">
            Back to my lessons
          </Link>
        </div>
      </main>
    );
  }

  const quiz = { ...createBlankQuiz(draft.details), id: draftId };
  return <QuizEditor quiz={quiz} draft={{ slides: draft.slides }} />;
}
