// Pieces shared by the searches that live in the page link and ask the database: the home page's presentation
// search (src/app/homeSearch.ts) and Admin → Photos (src/app/admin/photoSearch.ts).

export const SEARCH_MAX_LENGTH = 100;

export const WITHIN = [
  { id: "any", label: "Any time", days: 0 },
  { id: "day", label: "1 day", days: 1 },
  { id: "week", label: "1 week", days: 7 },
  { id: "month", label: "1 month", days: 31 },
  { id: "year", label: "1 year", days: 366 },
] as const;

/** The ids of a list of options, as zod's z.enum wants them. */
export const optionIds = <T extends readonly { id: string }[]>(options: T) =>
  options.map((option) => option.id) as [T[number]["id"], ...T[number]["id"][]];

/** The page link's options, keeping only the first value of one given twice (e.g. ?q=a&q=b), for zod to read. */
export function firstValues(params: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
}

/** The link's "?q=…" part, leaving out options that are still the default ("" when nothing is set). */
export function searchQuery<T extends Record<string, string | number>>(search: T, defaults: T): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(defaults)) {
    const value = String(search[key]).trim();
    if (value !== String(defaults[key])) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** The oldest time a "within" option allows (0 = any time). */
export function withinSince(within: (typeof WITHIN)[number]["id"]): number {
  const days = WITHIN.find((option) => option.id === within)?.days ?? 0;
  return days ? Date.now() - days * 86_400_000 : 0;
}

/**
 * A "contains this text" (ilike) pattern. Characters that mean something to the database (like % or a comma)
 * become _, which matches any one letter. So "50%" still finds "50%", and can't break the query.
 */
export function contains(text: string): string {
  return `%${text.replace(/[%_*,()"\\]/g, "_")}%`;
}
