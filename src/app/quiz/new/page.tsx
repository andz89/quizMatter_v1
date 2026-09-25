import Link from "next/link";
import { createBlankQuiz } from "@/lib/factories";
import { getDraft } from "@/lib/drafts";
import { QuizEditor } from "../[id]/QuizEditor";

/**
 * Opens a quiz Claude sent through the MCP server (the link /api/mcp hands out) as a new quiz. It
 * isn't saved yet: the editor shows it, and the user's Save creates it in the database.
 */
export default async function NewQuizFromClaudePage({ searchParams }: PageProps<"/quiz/new">) {
  const { draft: draftId } = await searchParams;
  const draft = typeof draftId === "string" ? await getDraft(draftId) : null;

  if (!draft) {
    return (
      <main className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-card border border-border-default bg-bg-surface px-5 py-6">
          <h1 className="mb-2 text-base font-semibold text-text-primary">This link has expired</h1>
          <p className="mb-5 text-sm text-text-secondary">
            Links from Claude work for 24 hours. Ask Claude to send the quiz again.
          </p>
          <Link href="/" className="text-sm font-semibold text-accent-green">
            Back to my quizzes
          </Link>
        </div>
      </main>
    );
  }

  return <QuizEditor quiz={createBlankQuiz(draft.details.title)} draft={{ slides: draft.slides }} />;
}
