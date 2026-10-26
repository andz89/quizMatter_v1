import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// Under review: rounds waiting for an admin (submitted). Submissions: editors' presentations waiting. Reports:
// presentations with a report.
export type TodoCounts = { reviews: number; submissions: number; reports: number };

/**
 * What waits for an admin (the `admin_todo_counts` rpc), for the menu's pills, Overview's "Waiting for you" and the
 * Presentations page's buttons. Cached per request, so the layout and the page share one call. Gives the rpc's
 * answer as it is: the layout shows no pills if it failed, the pages throw.
 */
export const getTodoCounts = cache(async () => {
  const supabase = await createClient();
  return supabase.rpc("admin_todo_counts").single<TodoCounts>();
});
