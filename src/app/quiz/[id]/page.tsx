import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { quizSchema } from "@/lib/schema";
import { QuizEditor } from "./QuizEditor";

export default async function QuizPage({ params }: PageProps<"/quiz/[id]">) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("quizzes")
    .select(
      "id, title, description, grade, subject, curriculum, learning_competency, author, reference_links, is_published, created_at, updated_at, slides(data, position)",
    )
    .eq("id", id)
    .order("position", { referencedTable: "slides" })
    .maybeSingle();
  if (error) throw error;
  // Also covers someone else's quiz: the database hides it, so it looks like it doesn't exist.
  if (!data) notFound();

  // Checked against the schema, so a slide saved in an older/broken shape fails here instead of inside the editor.
  const quiz = quizSchema.parse({
    id: data.id,
    title: data.title,
    description: data.description,
    grade: data.grade,
    subject: data.subject,
    curriculum: data.curriculum,
    learningCompetency: data.learning_competency,
    author: data.author,
    referenceLinks: data.reference_links,
    isPublished: data.is_published,
    createdAt: Date.parse(data.created_at),
    updatedAt: Date.parse(data.updated_at),
    slides: data.slides.map((slide: { data: unknown }) => slide.data),
  });

  return <QuizEditor quiz={quiz} />;
}
