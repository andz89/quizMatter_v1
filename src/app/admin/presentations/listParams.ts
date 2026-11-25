import { z } from "zod";
import { SEARCH_MAX_LENGTH, firstValues, searchQuery } from "@/lib/search";

// Admin → Presentations keeps its search, sort and row count in the page link (?q=…&sort=newest&shown=20), so the
// server reads only the rows it shows from the database. Shared by the page (server) and the table (browser).

export const ADMIN_LIST_SORTS = [
  { id: "updated", label: "Last changed" },
  { id: "newest", label: "Newest" },
] as const;

// Rows shown at first, and how many more each "Show more" adds.
export const ADMIN_LIST_STEP = 10;
// The most rows "Show more" can show: one database request returns 1,000 at most. Search finds the rest.
export const ADMIN_LIST_MAX = 1000;

// Anything odd in the link (too long, unknown value) falls back to the default instead of breaking the page.
const adminListSchema = z.object({
  q: z.string().trim().max(SEARCH_MAX_LENGTH).catch(""),
  sort: z.enum(["updated", "newest"]).catch("updated"),
  shown: z.coerce.number().int().min(ADMIN_LIST_STEP).max(ADMIN_LIST_MAX).multipleOf(ADMIN_LIST_STEP).catch(ADMIN_LIST_STEP),
});

export type AdminList = z.infer<typeof adminListSchema>;

export function parseAdminList(params: Record<string, string | string[] | undefined>): AdminList {
  return adminListSchema.parse(firstValues(params));
}

/** The link's "?q=…&sort=…" part (defaults left out). Leaves out `shown`, so a new search or sort starts at 10. */
export function adminListQuery(list: Pick<AdminList, "q" | "sort">): string {
  return searchQuery({ q: list.q, sort: list.sort }, { q: "", sort: "updated" });
}
