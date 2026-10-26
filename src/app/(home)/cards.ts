import type { PostgrestFilterBuilder, SupabaseClient } from "@supabase/supabase-js";
import { getAccount } from "@/lib/account";
import type { DraftSummary } from "@/lib/drafts";
import { loadPublisherNames } from "@/lib/publishers";
import { creditLines, detailsLabel, joinParts, slideCountLabel, timeAgo } from "@/lib/format";
import { DAYS, GRADES, OTHER_CHOICE, SUBJECTS, TERMS, WEEKS, gradesTitle, isOtherDay, isOtherGrade, isOtherSubject, isOtherTerm, isOtherWeek, parseSlide } from "@/lib/schema";
import { contains, searchWords } from "@/lib/search";
import { loadMySubmissions, type SubmissionStatus } from "@/lib/submissions";
import type { PresentationCardData } from "../PresentationCard";
import { changedSince, NO_SUBJECT, type HomeSearch } from "../homeSearch";

// Each presentation's first slide only (for the card's picture), not all of them, to keep the page light.
// reviewers: who is in its "Reviewed by" list, for the check and the Reviewer row on its card (everyone sees them).
// Only reviewer_id and name: teachers may read just some of that table's columns (see 20261023000000_hide_review_approver.sql).
// likes: how many likes it has (no row = none yet; see the presentation_likes migration).
export const CARD_COLUMNS =
  "id, owner_id, title, grades, subject, term, week, day, author, is_published, from_admin, hidden_at, created_at, updated_at, slides(count), first_slide:slides(data, position), reviewers:presentation_reviewers(reviewer_id, name), likes:presentation_like_counts(total)";

export type CardPresentation = {
  id: string;
  owner_id: string;
  title: string;
  grades: string[];
  subject: string;
  term: string;
  week: string;
  day: string;
  author: string;
  is_published: boolean;
  from_admin: boolean;
  hidden_at: string | null;
  created_at: string;
  updated_at: string;
  slides: { count: number }[];
  first_slide: { data: unknown }[];
  reviewers: { reviewer_id: string | null; name: string }[];
  // One row at most (presentation_id is its key): the database sends it as an object, the types guess a list.
  likes: { total: number }[] | { total: number } | null;
};

// "saved": my saved row for it (only mine come back), for sorting by when I saved it.
export type SavedPresentation = CardPresentation & { saved?: { saved_at: string }[] };

// A presentations query, whatever columns it selects ("any": each select gives its rows their own type).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PresentationQuery = PostgrestFilterBuilder<any, any, any, any, any, any, any>;

/** The logged-in teacher's id ("" if none). */
export async function myId(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase.auth.getClaims();
  return data?.claims.sub ?? "";
}

/** Every search option as filters on a presentations query (Look in, Sort and Show more are applied elsewhere). */
export function applySearch<Q extends PresentationQuery>(query: Q, search: HomeSearch): Q {
  const since = changedSince(search);
  // search_text: every searched detail as one line of text (see the presentation_search_text migration). Each
  // word must be in it somewhere, in any order: "adding fractions" finds "Fractions: adding and subtracting".
  for (const word of searchWords(search.q)) query = query.ilike("search_text", contains(word)) as Q;
  if (search.title) query = query.ilike("title", contains(search.title)) as Q;
  if (search.subject === OTHER_CHOICE) query = query.neq("subject", "").not("subject", "in", inList(SUBJECTS)) as Q;
  else if (search.subject) query = query.eq("subject", search.subject) as Q;
  if (search.author) query = query.ilike("author", contains(search.author)) as Q;
  // tags_text: the tags as one line of text, so part of a tag is found too (see the presentation_tags migration).
  if (search.tags) query = query.ilike("tags_text", contains(search.tags)) as Q;
  // None of these words anywhere.
  for (const word of searchWords(search.not)) query = query.not("search_text", "ilike", contains(word)) as Q;
  // Has a grade not on the list (its grades aren't all list grades); or includes this grade.
  if (search.grade === OTHER_CHOICE) query = query.not("grades", "cd", `{${GRADES.map((grade) => `"${grade}"`).join(",")}}`) as Q;
  else if (search.grade) query = query.contains("grades", [search.grade]) as Q;
  if (search.term === OTHER_CHOICE) query = query.neq("term", "").not("term", "in", inList(TERMS)) as Q;
  else if (search.term) query = query.eq("term", search.term) as Q;
  if (search.week === OTHER_CHOICE) query = query.neq("week", "").not("week", "in", inList(WEEKS)) as Q;
  else if (search.week) query = query.eq("week", search.week) as Q;
  if (search.day === OTHER_CHOICE) query = query.neq("day", "").not("day", "in", inList(DAYS)) as Q;
  else if (search.day) query = query.eq("day", search.day) as Q;
  if (since) query = query.gte("updated_at", new Date(since).toISOString()) as Q;
  return query;
}

/** The search's Sort, plus each card's first slide only. */
export function orderBy<Q extends PresentationQuery>(query: Q, sort: HomeSearch["sort"]): Q {
  return query
    .order(sort === "title" ? "title" : sort === "newest" ? "created_at" : "updated_at", { ascending: sort === "title" })
    .order("position", { referencedTable: "first_slide" })
    .limit(1, { referencedTable: "first_slide" }) as Q;
}

/**
 * Claude's drafts aren't in the database yet, so they're checked here the same way the database checks the rest.
 * Drafts have no author, so an Author search leaves them out.
 */
export function draftMatches(draft: DraftSummary, search: HomeSearch, since: number): boolean {
  const has = (text: string, part: string) => text.toLowerCase().includes(part.toLowerCase());
  const details = `${draft.title} ${draft.subject} ${draft.term} ${draft.week} ${draft.day} ${draft.curriculum} ${draft.learningCompetency} ${draft.tags}`;
  return (
    searchWords(search.q).every((word) => has(details, word)) &&
    has(draft.title, search.title) &&
    (search.subject === OTHER_CHOICE ? isOtherSubject(draft.subject) : !search.subject || draft.subject === search.subject) &&
    (search.grade === OTHER_CHOICE ? draft.grades.some(isOtherGrade) : !search.grade || draft.grades.includes(search.grade)) &&
    (search.term === OTHER_CHOICE ? isOtherTerm(draft.term) : !search.term || draft.term === search.term) &&
    (search.week === OTHER_CHOICE ? isOtherWeek(draft.week) : !search.week || draft.week === search.week) &&
    (search.day === OTHER_CHOICE ? isOtherDay(draft.day) : !search.day || draft.day === search.day) &&
    has(draft.tags, search.tags) &&
    !search.author &&
    !searchWords(search.not).some((word) => has(details, word)) &&
    draft.createdAt >= since
  );
}

/** A list for the database's "in" filter: ("Grade 1","Grade 2",…). */
function inList(list: readonly string[]): string {
  return `(${list.map((value) => `"${value}"`).join(",")})`;
}

/**
 * These presentations as card rows (first slide only), in the order of `ids`. One the user can't read (the database
 * decides) is left out, and so is a batch whose lookup fails. Read 50 at a time, so the request's link stays short.
 */
export async function loadCardRows(supabase: SupabaseClient, ids: string[]): Promise<CardPresentation[]> {
  const batches = Array.from({ length: Math.ceil(ids.length / 50) }, (_, i) => ids.slice(i * 50, i * 50 + 50));
  const results = await Promise.all(
    batches.map((batch) =>
      supabase
        .from("presentations")
        .select(CARD_COLUMNS)
        .in("id", batch)
        .order("position", { referencedTable: "first_slide" })
        .limit(1, { referencedTable: "first_slide" }),
    ),
  );
  const byId = new Map(results.flatMap(({ data }) => (data ?? []) as unknown as CardPresentation[]).map((row) => [row.id, row]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/**
 * Cards of QuizMatter presentations (or other people's), like the home tabs: Author / Publisher / Reviewer rows and the
 * Save (bookmark) button. If the saved lookup fails, plain cards without them.
 */
export async function toSavableCards(supabase: SupabaseClient, rows: CardPresentation[]): Promise<PresentationCardData[]> {
  try {
    const { toSavableCard } = await loadCardContext(supabase, rows, await myId(supabase));
    return rows.map(toSavableCard);
  } catch {
    const now = Date.now();
    return rows.map((row) => toCard(row, `/presentation/${row.id}`, now));
  }
}

export function toCard(presentation: CardPresentation, href: string, now: number): PresentationCardData {
  const slideCount = presentation.slides[0]?.count ?? 0;
  return {
    id: presentation.id,
    href,
    title: presentation.title || "Untitled presentation",
    subject: presentation.subject,
    meta: joinParts([detailsLabel(presentation), slideCountLabel(slideCount), timeAgo(Date.parse(presentation.updated_at), now)]),
    metaTitle: gradesTitle(presentation.grades),
    firstSlide: parseSlide(presentation.first_slide[0]?.data),
    isReviewed: presentation.reviewers.length > 0,
    likeCount: [presentation.likes ?? []].flat()[0]?.total ?? 0,
  };
}

/** My submissions' statuses by presentation id (editors only; see the quizmatter_submissions migration). */
export async function mySubmissionStatuses(supabase: SupabaseClient, isEditor: boolean): Promise<Map<string, SubmissionStatus>> {
  if (!isEditor) return new Map();
  const submissions = await loadMySubmissions(supabase);
  // A receipt whose original I deleted has no card.
  return new Map(submissions.flatMap((s) => (s.presentationId ? [[s.presentationId, s.status] as const] : [])));
}

/** My shared copies by their original's id (see the shared_copy migration): my published presentations. */
export async function mySharedCopies(supabase: SupabaseClient): Promise<Map<string, { hiddenAt: string | null }>> {
  const { data, error } = await supabase
    .from("presentations")
    .select("shared_from, hidden_at")
    .eq("owner_id", await myId(supabase))
    .not("shared_from", "is", null);
  if (error) throw error;
  return new Map(data.map((row) => [row.shared_from as string, { hiddenAt: row.hidden_at as string | null }]));
}

/**
 * My own presentation as a card: opens the editor; shows Published / Hidden, and its QuizMatter submission.
 * Editors may submit it unless it's waiting or already approved (see the quizmatter_submissions migration).
 */
export function myCard(
  p: CardPresentation,
  canMoveToQuizMatter: boolean,
  now: number,
  extra: { isEditor: boolean; submission?: SubmissionStatus; sharedCopy?: { hiddenAt: string | null } },
) {
  const isHidden = Boolean(p.hidden_at || extra.sharedCopy?.hiddenAt);
  return {
    ...toCard(p, `/presentation/${p.id}/edit`, now),
    // Published = it has a shared copy. Hidden = an admin hid it (or its copy): other teachers can't see it.
    badge: isHidden ? ("hidden" as const) : extra.sharedCopy ? ("published" as const) : undefined,
    canMoveToQuizMatter,
    submission: extra.submission,
    canSubmit: extra.isEditor && !isHidden && extra.submission !== "submitted" && extra.submission !== "approved",
    createdAt: Date.parse(p.created_at),
    updatedAt: Date.parse(p.updated_at),
  };
}

/** One of Claude's drafts (not saved yet) as a card. Its slides are only a recipe, so no picture. */
export function draftCard(draft: DraftSummary, now: number) {
  return {
    id: draft.id,
    href: `/presentation/new?draft=${draft.id}`,
    title: draft.title || "Untitled presentation",
    subject: draft.subject,
    meta: joinParts([detailsLabel(draft), slideCountLabel(draft.slideCount), timeAgo(draft.createdAt, now)]),
    metaTitle: gradesTitle(draft.grades),
    firstSlide: null,
    badge: ({ ready: "draft", checking: "checking", unfinished: "unfinished" } as const)[draft.state],
    createdAt: draft.createdAt,
    updatedAt: draft.createdAt,
  };
}

/**
 * Which of these presentations I liked: only these ids are read, never every like (a request returns 1,000 rows at
 * the most). The database only gives back my own likes. 50 ids at a time, so the request's link stays short.
 */
async function myLikedIds(supabase: SupabaseClient, ids: string[]): Promise<string[]> {
  const batches = Array.from({ length: Math.ceil(ids.length / 50) }, (_, i) => ids.slice(i * 50, i * 50 + 50));
  const results = await Promise.all(batches.map((batch) => supabase.from("presentation_likes").select("presentation_id").in("presentation_id", batch)));
  return results.flatMap(({ data, error }) => {
    if (error) throw error;
    return data.map((row) => row.presentation_id as string);
  });
}

/** Only the presentations under a subject chip: a list subject, "Other" (one not on the list), or NO_SUBJECT. */
export function bySubjectChip<Q extends PresentationQuery>(query: Q, chip: string): Q {
  if (chip === NO_SUBJECT) return query.eq("subject", "") as Q;
  if (chip === OTHER_CHOICE) return query.neq("subject", "").not("subject", "in", inList(SUBJECTS)) as Q;
  return query.eq("subject", chip) as Q;
}

/**
 * What cards of other people's presentations need: which ones I saved (bookmark) and liked, and the publisher's name
 * for other teachers' ones. `toSavableCard` is someone else's presentation, which I can save (bookmark) and like
 * (not admins: they only see the count) from its card.
 * An admin's own QuizMatter ones show in "From QuizMatter" too, but the database doesn't let anyone save their own.
 */
export async function loadCardContext(supabase: SupabaseClient, rows: CardPresentation[], me: string) {
  const [savedRows, likedRows, publisherNames, account] = await Promise.all([
    supabase.from("saved_presentations").select("presentation_id"),
    myLikedIds(supabase, rows.map((p) => p.id)),
    loadPublisherNames(supabase, rows.filter((p) => !p.from_admin).map((p) => p.owner_id)),
    getAccount(),
  ]);
  if (savedRows.error) throw savedRows.error;
  const likedIds = new Set<string>(likedRows);
  const savedIds = new Set<string>(savedRows.data.map((row) => row.presentation_id));
  const now = Date.now();
  const toSavableCard = (p: CardPresentation): PresentationCardData => ({
    ...toCard(p, `/presentation/${p.id}`, now),
    credits: creditLines({
      author: p.author,
      fromAdmin: p.from_admin,
      publisherName: publisherNames.get(p.owner_id),
      reviewerNames: p.reviewers.map((reviewer) => reviewer.name),
    }),
    canSave: p.owner_id !== me,
    isSaved: savedIds.has(p.id),
    canLike: p.owner_id !== me && p.is_published && !account.isAdmin,
    isLiked: likedIds.has(p.id),
    isReviewedByMe: p.reviewers.some((reviewer) => reviewer.reviewer_id === me),
  });
  return { savedIds, toSavableCard };
}
