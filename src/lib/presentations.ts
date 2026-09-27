import { createClient } from "./supabase/client";
import { presentationSchema, type Presentation } from "./schema";

/**
 * Saves the whole presentation (title + every slide, in order) in one step. The `save_presentation` database
 * function also removes slides that were deleted. Throws if it fails.
 */
export async function savePresentationToDb(presentation: Presentation) {
  // Empty reference rows (added but not filled in) are dropped, not saved.
  const referenceLinks = presentation.referenceLinks.map((link) => link.trim()).filter(Boolean);
  // Checked with zod first (see CLAUDE.md, "Saving Data"): bad data throws here and is never saved.
  const { error } = await createClient().rpc("save_presentation", { presentation: presentationSchema.parse({ ...presentation, referenceLinks }) });
  if (error) throw error;
}
