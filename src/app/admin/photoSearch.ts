import { z } from "zod";
import { SEARCH_MAX_LENGTH, WITHIN, firstValues, optionIds, searchQuery } from "@/lib/search";

// Admin → Photos' search lives in the page link (e.g. /admin?q=frog&page=2), so Back and shared links bring the
// same search back. The server reads it and asks the database (page.tsx); this file is shared by both sides.

// How many photos one page of the list shows.
export const PHOTOS_PER_PAGE = 20;

export const MISSING = [
  { id: "any", label: "Anything" },
  { id: "description", label: "No description" },
  { id: "source", label: "No source" },
] as const;

export const PHOTO_SORTS = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "name", label: "File name A–Z" },
  { id: "biggest", label: "Biggest file" },
] as const;

const text = z.string().trim().max(SEARCH_MAX_LENGTH).catch("");

// Anything odd in the link (too long, unknown value) falls back to the default instead of breaking the page.
const photoSearchSchema = z.object({
  // "Includes the words": each word is found in the file name, description, tags, source or category.
  q: text,
  name: text,
  description: text,
  tags: text,
  source: text,
  // "Doesn't have": not in the file name, description, tags or source.
  not: text,
  category: z.union([z.uuid(), z.literal("")]).catch(""),
  missing: z.enum(optionIds(MISSING)).catch("any"),
  within: z.enum(optionIds(WITHIN)).catch("any"),
  sort: z.enum(optionIds(PHOTO_SORTS)).catch("newest"),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
});

export type PhotoSearch = z.infer<typeof photoSearchSchema>;

export const DEFAULT_PHOTO_SEARCH: PhotoSearch = photoSearchSchema.parse({});

export function parsePhotoSearch(params: Record<string, string | string[] | undefined>): PhotoSearch {
  return photoSearchSchema.parse(firstValues(params));
}

/** The page link for this search ("/admin" when nothing is searched). */
export function photoSearchHref(search: PhotoSearch): string {
  return `/admin${searchQuery(search, DEFAULT_PHOTO_SEARCH)}`;
}
