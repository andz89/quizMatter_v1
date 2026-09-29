import { z } from "zod";
import { GRADES } from "@/lib/schema";

// The home page's search lives in the page link (e.g. /?q=fractions&grade=Grade+3), so Back and shared links
// bring the same search back. The server reads it and asks the database; this file is shared by both sides.

export const SEARCH_MAX_LENGTH = 100;

export const LOOK_IN = [
  { id: "all", label: "All presentations" },
  { id: "mine", label: "Mine" },
  { id: "quizmatter", label: "From QuizMatter" },
  { id: "teachers", label: "Other teachers" },
] as const;

export const WITHIN = [
  { id: "any", label: "Any time", days: 0 },
  { id: "day", label: "1 day", days: 1 },
  { id: "week", label: "1 week", days: 7 },
  { id: "month", label: "1 month", days: 31 },
  { id: "year", label: "1 year", days: 366 },
] as const;

export const SORTS = [
  { id: "updated", label: "Last changed" },
  { id: "newest", label: "Newest" },
  { id: "title", label: "A–Z" },
] as const;

const ids = <T extends readonly { id: string }[]>(options: T) => options.map((option) => option.id) as [T[number]["id"], ...T[number]["id"][]];
const text = z.string().trim().max(SEARCH_MAX_LENGTH).catch("");

// Anything odd in the link (too long, unknown value) falls back to the default instead of breaking the page.
const homeSearchSchema = z.object({
  // "Includes the words": found in the title, subject or author.
  q: text,
  title: text,
  subject: text,
  author: text,
  // "Doesn't have": not in the title, subject or author.
  not: text,
  grade: z.union([z.enum(GRADES), z.literal("")]).catch(""),
  within: z.enum(ids(WITHIN)).catch("any"),
  in: z.enum(ids(LOOK_IN)).catch("all"),
  sort: z.enum(ids(SORTS)).catch("updated"),
});

export type HomeSearch = z.infer<typeof homeSearchSchema>;

export const DEFAULT_SEARCH: HomeSearch = homeSearchSchema.parse({});

export function parseHomeSearch(params: Record<string, string | string[] | undefined>): HomeSearch {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  return homeSearchSchema.parse(Object.fromEntries(Object.entries(params).map(([key, value]) => [key, first(value)])));
}

/** The link's "?q=…" part, leaving out options that are still the default ("" when nothing is searched). */
export function homeSearchQuery(search: HomeSearch): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(DEFAULT_SEARCH) as (keyof HomeSearch)[]) {
    const value = search[key].trim();
    if (value !== DEFAULT_SEARCH[key]) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** The oldest "last changed" time the "Changed within" option allows (0 = any time). */
export function changedSince(search: HomeSearch): number {
  const days = WITHIN.find((option) => option.id === search.within)?.days ?? 0;
  return days ? Date.now() - days * 86_400_000 : 0;
}
