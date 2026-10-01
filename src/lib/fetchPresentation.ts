import type { SupabaseClient } from "@supabase/supabase-js";
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
  const [result, { data: claims }] = await Promise.all([loadPresentation(supabase, id), supabase.auth.getClaims()]);
  if (!result) return null;

  const { presentation, ownerId } = result;
  const isMine = ownerId === claims?.claims.sub;
  const publisherName = isMine ? "" : ((await loadPublisherNames(supabase, [ownerId])).get(ownerId) ?? "");
  return { presentation, isMine, publisherName };
}

/**
 * The presentation and its owner's id, read with the given client (so the database decides what that user may
 * read), or null if there's none they can read. Also used by the MCP server, which logs in with Claude's token.
 */
export async function loadPresentation(
  supabase: SupabaseClient,
  id: string,
): Promise<{ presentation: Presentation; ownerId: string } | null> {
  const { data, error } = await supabase
    .from("presentations")
    .select(
      "id, owner_id, title, description, grade, subject, curriculum, learning_competency, author, reference_links, tags, transition, transition_speed, is_published, from_admin, created_at, updated_at, slides(data, position)",
    )
    .eq("id", id)
    .order("position", { referencedTable: "slides" })
    .maybeSingle();
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
    tags: data.tags,
    transition: data.transition,
    transitionSpeed: data.transition_speed,
    isPublished: data.is_published,
    fromAdmin: data.from_admin,
    createdAt: Date.parse(data.created_at),
    updatedAt: Date.parse(data.updated_at),
    slides: data.slides.map((slide: { data: unknown }) => slide.data),
  });
  return { presentation, ownerId: data.owner_id };
}
