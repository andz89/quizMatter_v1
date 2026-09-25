import { createClient } from "./supabase/server";
import { quizSchema, type Quiz } from "./schema";

/**
 * The whole quiz (details + every slide, in order) and who owns it, or null if there's none the user
 * can read: their own quizzes, and other people's published ones. Server-only.
 */
export async function fetchQuiz(id: string): Promise<{ quiz: Quiz; isMine: boolean } | null> {
  const supabase = await createClient();
  const [{ data, error }, { data: claims }] = await Promise.all([
    supabase
      .from("quizzes")
      .select(
        "id, owner_id, title, description, grade, subject, curriculum, learning_competency, author, reference_links, is_published, created_at, updated_at, slides(data, position)",
      )
      .eq("id", id)
      .order("position", { referencedTable: "slides" })
      .maybeSingle(),
    supabase.auth.getClaims(),
  ]);
  if (error) throw error;
  if (!data) return null;

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
  return { quiz, isMine: data.owner_id === claims?.claims.sub };
}
