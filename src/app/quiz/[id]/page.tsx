import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { quizSchema } from "@/lib/schema";
import { getDraft } from "@/lib/drafts";
import { QuizEditor } from "./QuizEditor";

export default async function QuizPage({ params, searchParams }: PageProps<"/quiz/[id]">) {
  const { id } = await params;
  const { draft: draftId } = await searchParams;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("quizzes")
    .select("id, title, created_at, updated_at, slides(data, position)")
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
    createdAt: Date.parse(data.created_at),
    updatedAt: Date.parse(data.updated_at),
    slides: data.slides.map((slide: { data: unknown }) => slide.data),
  });

  // A draft from Claude (see /api/mcp): the editor puts its slides in place of the quiz's ones.
  // null means the link was wrong or older than a day.
  const draft = typeof draftId === "string" ? await getDraft(draftId) : undefined;

  return <QuizEditor quiz={quiz} draft={draft} />;
}
