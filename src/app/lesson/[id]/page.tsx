import { notFound } from "next/navigation";
import { fetchQuiz } from "@/lib/fetchQuiz";
import { LessonView } from "./LessonView";

/** A lesson to look at, not edit: mostly other teachers' published lessons (opened from the home page). */
export default async function LessonPage({ params }: PageProps<"/lesson/[id]">) {
  const { id } = await params;
  const result = await fetchQuiz(id);
  // Someone else's private lesson is hidden by the database, so it looks like it doesn't exist.
  if (!result) notFound();

  return <LessonView quiz={result.quiz} isMine={result.isMine} />;
}
