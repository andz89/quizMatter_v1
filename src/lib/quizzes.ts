import { createClient } from "./supabase/client";
import type { Quiz } from "./schema";

/**
 * Saves the whole quiz (title + every slide, in order) in one step. The `save_quiz` database
 * function also removes slides that were deleted. Throws if it fails.
 */
export async function saveQuizToDb(quiz: Quiz) {
  const { error } = await createClient().rpc("save_quiz", { quiz });
  if (error) throw error;
}
