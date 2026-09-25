"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { deleteDrafts } from "@/lib/drafts";
import { createClient } from "@/lib/supabase/server";

const idsSchema = z.array(z.string().min(1).max(100)).max(200);

/**
 * Deletes my saved lessons (their slides go with them — `on delete cascade`) and discards Claude's
 * drafts, then reloads the list. The "Own quizzes" policy only lets the owner delete, so other
 * teachers' lessons can't be removed. Returns false if anything failed, so the page can tell the user.
 */
export async function removeLessons(lessonIds: string[], draftIds: string[]): Promise<boolean> {
  const lessons = idsSchema.safeParse(lessonIds);
  const drafts = idsSchema.safeParse(draftIds);
  if (!lessons.success || !drafts.success) return false;

  try {
    if (lessons.data.length > 0) {
      const supabase = await createClient();
      const { error } = await supabase.from("quizzes").delete().in("id", lessons.data);
      if (error) throw error;
    }
    await deleteDrafts(drafts.data);
  } catch {
    return false;
  } finally {
    refresh();
  }
  return true;
}
