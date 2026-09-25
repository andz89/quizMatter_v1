import { notFound, redirect } from "next/navigation";
import { fetchQuiz } from "@/lib/fetchQuiz";
import { QuizEditor } from "./QuizEditor";

export default async function QuizPage({ params }: PageProps<"/quiz/[id]">) {
  const { id } = await params;
  const result = await fetchQuiz(id);
  // Also covers someone else's private quiz: the database hides it, so it looks like it doesn't exist.
  if (!result) notFound();
  // Someone else's published lesson can be viewed, not edited (saving it would be refused anyway).
  if (!result.isMine) redirect(`/lesson/${id}`);

  return <QuizEditor quiz={result.quiz} />;
}
