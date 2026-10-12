import { z } from "zod";
import { DAYS, GRADES, OTHER_CHOICE, SUBJECTS, WEEKS } from "@/lib/schema";
import { SEARCH_MAX_LENGTH, WITHIN, firstValues, optionIds, searchQuery, withinSince } from "@/lib/search";

// The home page's search lives in the page link (e.g. /?q=fractions&grade=Grade+3), so Back and shared links
// bring the same search back. The server reads it and asks the database; this file is shared by both sides.

export { WITHIN };

// Where /search looks. "All": every presentation shared with me (QuizMatter's and other teachers'), not my own.
export const LOOK_IN = [
  { id: "all", label: "All shared" },
  { id: "quizmatter", label: "From QuizMatter" },
  { id: "teachers", label: "Other teachers" },
  { id: "mine", label: "Mine" },
] as const;

export const SORTS = [
  { id: "updated", label: "Last changed" },
  { id: "newest", label: "Newest" },
  { id: "title", label: "A–Z" },
] as const;

// Cards per "Show more" step (search results and Other teachers).
export const PAGE_SIZE = 20;
// How many cards are shown: 20, 40, 60… at most 500. Anything else falls back to 20.
export const shownSchema = z.coerce.number().int().min(PAGE_SIZE).max(500).multipleOf(PAGE_SIZE).catch(PAGE_SIZE);
export function parseShown(params: Record<string, string | string[] | undefined>): number {
  return shownSchema.parse(firstValues(params).shown);
}

const text = z.string().trim().max(SEARCH_MAX_LENGTH).catch("");
// A value from the list, or "Other" for every value not on it ("" = any).
const listChoice = (list: readonly string[]) =>
  z.string().refine((value) => value === "" || value === OTHER_CHOICE || list.includes(value)).catch("");

// Anything odd in the link (too long, unknown value) falls back to the default instead of breaking the page.
const homeSearchSchema = z.object({
  // "Includes the words": each word found somewhere in the title, subject, week, day, curriculum, learning competency,
  // author or tags, in any order.
  q: text,
  title: text,
  // A list subject, or "Other" for every subject not on the list.
  subject: z.union([z.enum(SUBJECTS), z.literal(OTHER_CHOICE), z.literal("")]).catch(""),
  author: text,
  tags: text,
  // "Doesn't have": none of these words in the title, subject, week, day, curriculum, learning competency, author or tags.
  not: text,
  // A list grade, or "Other" for every grade not on the list.
  grade: z.union([z.enum(GRADES), z.literal(OTHER_CHOICE), z.literal("")]).catch(""),
  // A list week or day, or "Other" for every one not on the list.
  week: listChoice(WEEKS),
  day: listChoice(DAYS),
  within: z.enum(optionIds(WITHIN)).catch("any"),
  in: z.enum(optionIds(LOOK_IN)).catch("all"),
  sort: z.enum(optionIds(SORTS)).catch("updated"),
  shown: shownSchema,
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
