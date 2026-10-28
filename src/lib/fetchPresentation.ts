import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "./supabase/server";
import { loadVisibleProfiles } from "./profiles";
import { loadPublisherNames } from "./publishers";
import { NO_REVIEW, loadReviewers, loadReviewStatus, type Reviewer, type ReviewStatus } from "./reviewStatus";
import { presentationSchema, type Presentation } from "./schema";
import type { SharedCopy } from "./sharing";
import { loadSubmissionStatus } from "./submissions";

/**
 * The whole presentation (details + every slide, in order) and who owns it, or null if there's none the user
 * can read: their own presentations, and other people's published ones. `publisherName` is the owner's display
 * name, only looked up for other people's presentations ("" if they have none). `isSaved`: it's in my "Saved"
 * row (see the saved_presentations migration). `review`: its review status, `reviewers`: its "Reviewed by" list
 * (see the presentation_reviews migration). `submission`: my presentation sent to QuizMatter, or null (see the
 * quizmatter_submissions migration). `sharedFrom`: set when this is a shared copy (the original's id).
 * `sharedCopy`: my presentation's shared copy, or null (see the shared_copy migration). `likeCount` and `isLiked`
 * (I liked it): see the presentation_likes migration. `authorId`: the editor whose name the database keeps as the
 * Author, or null (see the author_link migration). Server-only.
 */
export async function fetchPresentation(id: string): Promise<{
  presentation: Presentation;
  isMine: boolean;
  // The owner's account, for the link to their profile.
  ownerId: string;
  // Profile link names by account id, for the owner and reviewers whose profile this user may open (not a hidden
  // admin's, not someone without a display name): only these names are links.
  profileSlugs: Record<string, string>;
  publisherName: string;
  isSaved: boolean;
  likeCount: number;
  isLiked: boolean;
  review: ReviewStatus;
  reviewers: Reviewer[];
  submission: Awaited<ReturnType<typeof loadSubmissionStatus>>;
  sharedFrom: string | null;
  sharedCopy: SharedCopy | null;
  authorId: string | null;
} | null> {
  const supabase = await createClient();
  const [result, { data: claims }, { data: saved }, { data: likes }, { data: liked }, review, reviewers, submission, { data: copy }] = await Promise.all([
    loadPresentation(supabase, id),
    supabase.auth.getClaims(),
    // The database only gives back my own saved rows.
    supabase.from("saved_presentations").select("presentation_id").eq("presentation_id", id).maybeSingle(),
    // If these fail, the page opens with 0 likes, not liked.
    supabase.from("presentation_like_counts").select("total").eq("presentation_id", id).maybeSingle(),
    // The database only gives back my own likes.
    supabase.from("presentation_likes").select("presentation_id").eq("presentation_id", id).maybeSingle(),
    // If these fail, the page still opens without the review parts (the database still enforces the lock).
    loadReviewStatus(supabase, id).catch(() => NO_REVIEW),
    loadReviewers(supabase, id).catch((): Reviewer[] => []),
    // If it fails, the page opens without it; the database still enforces the lock.
    loadSubmissionStatus(supabase, id).catch(() => null),
    // My presentation's shared copy, if it's published (the database only gives back my own).
    supabase.from("presentations").select("id, shared_at, hidden_at").eq("shared_from", id).maybeSingle(),
  ]);
  if (!result) return null;

  const { presentation, ownerId } = result;
  const isMine = ownerId === claims?.claims.sub;
  const [publisherNames, profileSlugs] = await Promise.all([
    isMine ? new Map<string, string>() : loadPublisherNames(supabase, [ownerId]),
    loadVisibleProfiles(supabase, [ownerId, ...reviewers.flatMap((reviewer) => reviewer.reviewerId ?? [])]),
  ]);
  const publisherName = publisherNames.get(ownerId) ?? "";
  return {
    presentation,
    isMine,
    ownerId,
    profileSlugs: Object.fromEntries(profileSlugs),
    publisherName,
    isSaved: saved !== null,
    likeCount: likes?.total ?? 0,
    isLiked: liked !== null,
    review,
    reviewers,
    submission,
    sharedFrom: result.sharedFrom,
    sharedCopy: isMine && copy ? { id: copy.id, sharedAt: Date.parse(copy.shared_at), isHidden: copy.hidden_at !== null } : null,
    authorId: result.authorId,
  };
}

/**
 * The presentation, its owner's id and its linked author's id, read with the given client (so the database decides
 * what that user may read), or null if there's none they can read. Also used by the MCP server, which logs in with
 * Claude's token.
 */
export async function loadPresentation(
  supabase: SupabaseClient,
  id: string,
): Promise<{ presentation: Presentation; ownerId: string; sharedFrom: string | null; authorId: string | null } | null> {
  const { data, error } = await supabase
    .from("presentations")
    .select(PRESENTATION_COLUMNS)
    .eq("id", id)
    .order("position", { referencedTable: "slides" })
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  // Checked against the schema (which upgrades older shapes first), so a slide saved in a broken shape fails here
  // instead of inside the editor. Admin → Data check finds these before a deploy.
  const presentation = presentationSchema.parse(rowToPresentationInput(data));
  return { presentation, ownerId: data.owner_id, sharedFrom: data.shared_from, authorId: data.author_id };
}

/** The presentation columns (and its slides) read to open one. Order the slides by position. */
export const PRESENTATION_COLUMNS =
  "id, owner_id, title, description, grades, subject, term, week, day, curriculum, learning_competency, author, author_id, reference_links, tags, transition, transition_speed, is_published, from_admin, shared_from, created_at, updated_at, slides(data, position)";

/** A presentations row (PRESENTATION_COLUMNS) in the app's shape, ready for presentationSchema. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToPresentationInput(data: any): unknown {
  return {
    id: data.id,
    title: data.title,
    description: data.description,
    grades: data.grades,
    subject: data.subject,
    term: data.term,
    week: data.week,
    day: data.day,
    curriculum: data.curriculum,
    learningCompetency: data.learning_competency,
    author: data.author,
    referenceLinks: data.reference_links,
    tags: data.tags,
    transition: data.transition,
    transitionSpeed: data.transition_speed,
    isPublished: data.is_published,
    fromAdmin: data.from_admin,
    createdAt: Date.parse(data.created_at),
    updatedAt: Date.parse(data.updated_at),
    slides: data.slides.map((slide: { data: unknown }) => slide.data),
  };
}
