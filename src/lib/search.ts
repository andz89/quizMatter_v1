// Pieces shared by the searches that live in the page link and ask the database: the home page's presentation
// search (src/app/homeSearch.ts) and Admin → Photos (src/app/admin/photos/photoSearch.ts).

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

/** The separate words of a search, e.g. "adding  fractions" → ["adding", "fractions"]. */
export function searchWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/**
 * A "contains this text" (ilike) pattern. Characters that mean something to the database (like % or a comma)
 * become _, which matches any one letter. So "50%" still finds "50%", and can't break the query.
 */
export function contains(text: string): string {
  return `%${text.replace(/[%_*,()"\\]/g, "_")}%`;
}

/** A word this short matches far too many titles alone, so titleTerms pairs it with its neighbor. */
const SHORT_WORD = 2;

/** The title search's words, without punctuation at their start or end ("(test)," → "test"; "((" is no word). */
function titleWords(search: string): string[] {
  return searchWords(search)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
}

/** A title search of one word ("exam", "4"): not accepted, it needs at least two ("Grade 4 exam"). Empty is fine. */
export function isOneWord(search: string): boolean {
  return titleWords(search).length === 1;
}
export const ONE_WORD_MESSAGE = "Type at least two words (like “Grade 4 exam”).";

/**
 * What the title search looks for: each word, except that a 1- or 2-letter word ("4", "Q1") becomes a two-word phrase
 * with the word before it (the one after, when it's first), and that neighbor isn't searched alone.
 * "Grade 4 exam" → ["Grade 4", "exam"]; "4 exam" → ["4 exam"]; one word → [] (isOneWord: not accepted).
 */
export function titleTerms(search: string): string[] {
  const words = titleWords(search);
  if (words.length < 2) return [];
  const terms: string[] = [];
  const paired = new Set<number>();
  words.forEach((word, i) => {
    if (word.length > SHORT_WORD) return;
    const other = i > 0 ? i - 1 : 1;
    terms.push(i > 0 ? `${words[other]} ${word}` : `${word} ${words[other]}`);
    paired.add(other);
  });
  words.forEach((word, i) => {
    if (word.length > SHORT_WORD && !paired.has(i)) terms.push(word);
  });
  return [...new Set(terms)];
}

/** The grades from the list (e.g. "Grade 4") that a term names exactly, in any case. */
function namedGrades(terms: string[], gradeList: readonly string[]): string[] {
  return gradeList.filter((grade) => terms.some((term) => term.toLowerCase() === grade.toLowerCase()));
}

/**
 * A term as a database regex (PostgREST imatch, Postgres ~*): it must start a word (\y), and when it ends with a
 * number it must end one too, so "grade 1" doesn't find "Grade 10" but "exam" still finds "Exams". Every character
 * other than a letter, number or space becomes . (any one character), like contains() does: it means nothing to the
 * regex or to an or() list (comma, brackets, quotes, backslash), so a word can't break either.
 */
const ENDS_WITH_NUMBER = /\p{N}$/u;
const regexSafe = (term: string) => term.replace(/[^\p{L}\p{N} ]/gu, ".");
function termRegex(term: string): string {
  return `\\y${regexSafe(term)}${ENDS_WITH_NUMBER.test(term) ? "\\y" : ""}`;
}
/** The same rule in the browser's regex, for Claude's drafts (which aren't in the database). */
function termMatches(title: string, term: string): boolean {
  const word = "[\\p{L}\\p{N}_]";
  const end = ENDS_WITH_NUMBER.test(term) ? `(?!${word})` : "";
  return new RegExp(`(?<!${word})${regexSafe(term)}${end}`, "iu").test(title);
}

/**
 * The home search's main box: a presentation matches when its title has any one of the terms (titleTerms), in any
 * case, starting a word (termRegex), or when a term is a grade's name ("grade 4") and it has that grade (the grade
 * is its own field, often not in the title). "Grade 4 exam" finds "Fractions" for Grade 4 and "Science exam", not
 * "Grade 5 Math" or "Grade 40". Nothing typed = everything. gradeList is GRADES (schema.ts), passed in so this file
 * has no imports. titleFilter is the same rule for the database, as a PostgREST or() list (null = no filter); the
 * grade names come only from the list.
 */
export function titleSearchMatches(item: { title: string; grades: string[] }, search: string, gradeList: readonly string[]): boolean {
  const terms = titleTerms(search);
  return (
    !terms.length ||
    terms.some((term) => termMatches(item.title, term)) ||
    namedGrades(terms, gradeList).some((grade) => item.grades.includes(grade))
  );
}
export function titleFilter(search: string, gradeList: readonly string[]): string | null {
  const terms = titleTerms(search);
  if (!terms.length) return null;
  const byTitle = terms.map((term) => `title.imatch.${termRegex(term)}`);
  const byGrade = namedGrades(terms, gradeList).map((grade) => `grades.cs.{"${grade}"}`);
  return [...byTitle, ...byGrade].join(",");
}
