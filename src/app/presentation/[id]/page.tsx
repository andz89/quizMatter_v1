import { notFound } from "next/navigation";
import { fetchQuiz } from "@/lib/fetchQuiz";
import { PresentationPreview } from "./PresentationPreview";

/** A presentation to look at, not edit: mostly other teachers' published presentations (opened from the home page). */
export default async function PresentationPage({ params }: PageProps<"/presentation/[id]">) {
  const { id } = await params;
  const result = await fetchQuiz(id);
  // Someone else's private presentation is hidden by the database, so it looks like it doesn't exist.
  if (!result) notFound();

  return <PresentationPreview quiz={result.quiz} isMine={result.isMine} />;
}
