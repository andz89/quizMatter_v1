import { createClient } from "./supabase/server";
import { loadPublisherNames } from "./publishers";
import { presentationSchema, type Presentation } from "./schema";

/**
 * The whole presentation (details + every slide, in order) and who owns it, or null if there's none the user
 * can read: their own presentations, and other people's published ones. `publisherName` is the owner's display
 * name, only looked up for other people's presentations ("" if they have none). Server-only.
 */
export async function fetchPresentation(
  id: string,
): Promise<{ presentation: Presentation; isMine: boolean; publisherName: string } | null> {
  const supabase = await createClient();
  const [{ data, error }, { data: claims }] = await Promise.all([
    supabase
      .from("presentations")
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
  const presentation = presentationSchema.parse({
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
  const isMine = data.owner_id === claims?.claims.sub;
  const publisherName = isMine ? "" : ((await loadPublisherNames(supabase, [data.owner_id])).get(data.owner_id) ?? "");
  return { presentation, isMine, publisherName };
}
