import { createClient } from "./supabase/client";
import { quizSchema, type Quiz } from "./schema";

/**
 * Saves the whole quiz (title + every slide, in order) in one step. The `save_quiz` database
 * function also removes slides that were deleted. Throws if it fails.
 */
export async function saveQuizToDb(quiz: Quiz) {
  // Empty reference rows (added but not filled in) are dropped, not saved.
  const referenceLinks = quiz.referenceLinks.map((link) => link.trim()).filter(Boolean);
  // Checked with zod first (see CLAUDE.md, "Saving Data"): bad data throws here and is never saved.
  const { error } = await createClient().rpc("save_quiz", { quiz: quizSchema.parse({ ...quiz, referenceLinks }) });
  if (error) throw error;
}
