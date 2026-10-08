import { z } from "zod";
import { GRADES, OTHER_CHOICE, SUBJECTS } from "@/lib/schema";
import { SEARCH_MAX_LENGTH, WITHIN, firstValues, optionIds, searchQuery, withinSince } from "@/lib/search";

// The home page's search lives in the page link (e.g. /?q=fractions&grade=Grade+3), so Back and shared links
// bring the same search back. The server reads it and asks the database; this file is shared by both sides.

export { WITHIN };

export const LOOK_IN = [
  { id: "all", label: "All presentations" },
  { id: "mine", label: "Mine" },
  { id: "quizmatter", label: "From QuizMatter" },
  { id: "teachers", label: "Other teachers" },
  { id: "saved", label: "Saved" },
  // Editors only (PresentationHome leaves it out for everyone else).
  { id: "reviewed", label: "My reviews" },
] as const;

export const SORTS = [
  { id: "updated", label: "Last changed" },
  { id: "newest", label: "Newest" },
  { id: "title", label: "A–Z" },
] as const;

const text = z.string().trim().max(SEARCH_MAX_LENGTH).catch("");

// Anything odd in the link (too long, unknown value) falls back to the default instead of breaking the page.
const homeSearchSchema = z.object({
  // "Includes the words": found in the title, subject, author or tags.
  q: text,
  title: text,
  // A list subject, or "Other" for every subject not on the list.
  subject: z.union([z.enum(SUBJECTS), z.literal(OTHER_CHOICE), z.literal("")]).catch(""),
  author: text,
  tags: text,
  // "Doesn't have": not in the title, subject, author or tags.
  not: text,
  // A list grade, or "Other" for every grade not on the list.
  grade: z.union([z.enum(GRADES), z.literal(OTHER_CHOICE), z.literal("")]).catch(""),
  within: z.enum(optionIds(WITHIN)).catch("any"),
  in: z.enum(optionIds(LOOK_IN)).catch("all"),
  sort: z.enum(optionIds(SORTS)).catch("updated"),
});

export type HomeSearch = z.infer<typeof homeSearchSchema>;

export const DEFAULT_SEARCH: HomeSearch = homeSearchSchema.parse({});

export function parseHomeSearch(params: Record<string, string | string[] | undefined>): HomeSearch {
  return homeSearchSchema.parse(firstValues(params));
}

/** The link's "?q=…" part, leaving out options that are still the default ("" when nothing is searched). */
export function homeSearchQuery(search: HomeSearch): string {
  return searchQuery(search, DEFAULT_SEARCH);
}

/** The oldest "last changed" time the "Changed within" option allows (0 = any time). */
export function changedSince(search: HomeSearch): number {
  return withinSince(search.within);
}
