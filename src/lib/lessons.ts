import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { z } from "zod";
import { profileSlugSchema } from "./profiles";

// This week's lessons, suggestions and an editor's profile list (see the lesson_week and lesson_extras migrations).
// The database hands out only presentation ids; the cards are read from presentations afterwards. None of these
// throw: if a lookup fails, the page opens without that part.

const idSchema = z.string().min(1).max(64);

/** An editor's lessons for one week (the viewed one included), and who made them. */
export type LessonWeek = {
  // Display name, or the part of the email before "@".
  editorName: string;
  // Their profile link name; "" when they have no display name.
  editorSlug: string;
  lessonIds: string[];
};

/**
 * A live QuizMatter presentation's week list (null unless an editor made it) and up to 6 "You may also like" ids,
 * best first, in one call (see the lesson_extras migration). Nothing if it fails.
 */
export async function loadLessonExtras(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ week: LessonWeek | null; suggestionIds: string[] }> {
  const nothing = { week: null, suggestionIds: [] };
  const checked = idSchema.safeParse(id);
  if (!checked.success) return nothing;
  const { data, error } = await supabase.rpc("lesson_extras", { target_id: checked.data });
  if (error) return nothing;
  const rows = data as { id: string; kind: "week" | "suggestion"; editor_name: string; editor_slug: string; position: number }[];
  const weekRows = rows.filter((row) => row.kind === "week");
  return {
    week: weekRows.length
      ? { editorName: weekRows[0].editor_name, editorSlug: weekRows[0].editor_slug, lessonIds: weekRows.map((row) => row.id) }
      : null,
    suggestionIds: rows
      .filter((row) => row.kind === "suggestion")
      .sort((a, b) => a.position - b.position)
      .map((row) => row.id),
  };
}

/** The live QuizMatter presentations this profile's owner made as an editor (any order). */
export async function loadEditorPresentationIds(supabase: SupabaseClient<Database>, slug: string): Promise<string[]> {
  // Capitals in a typed link still work, like loadTeacherProfile.
  const checked = profileSlugSchema.safeParse(slug.toLowerCase());
  if (!checked.success) return [];
  const { data, error } = await supabase.rpc("editor_presentations", { slug: checked.data });
  if (error) return [];
  return (data as { id: string }[]).map((row) => row.id);
}
