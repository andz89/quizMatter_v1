import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewerFields } from "./schema";

/**
 * A presentation's review (see the presentation_reviews migration): the latest round's status, its reviewer's
 * name, whether it's locked (reviewing or submitted), whether I'm its reviewer, and whether I may start one.
 */
export type ReviewStatus = {
  status: "reviewing" | "submitted" | "canceled" | "published" | null;
  reviewerName: string;
  isLocked: boolean;
  isMine: boolean;
  canStart: boolean;
};

export const NO_REVIEW: ReviewStatus = { status: null, reviewerName: "", isLocked: false, isMine: false, canStart: false };

/** One entry of a presentation's "Reviewed by" list. `reviewerId` links to their profile page. */
export type Reviewer = ReviewerFields & { reviewerId: string };

/** The review status, with the server or browser client. Throws if the lookup fails. */
export async function loadReviewStatus(supabase: SupabaseClient, id: string): Promise<ReviewStatus> {
  const { data, error } = await supabase.rpc("review_status", { target_id: id }).maybeSingle<{
    status: ReviewStatus["status"];
    reviewer_name: string;
    is_locked: boolean;
    is_mine: boolean;
    can_start: boolean;
  }>();
  if (error) throw error;
  if (!data) return NO_REVIEW;
  return {
    status: data.status,
    reviewerName: data.reviewer_name,
    isLocked: data.is_locked,
    isMine: data.is_mine,
    canStart: data.can_start,
  };
}

/** Everyone who reviewed the presentation, newest review first. Throws if the lookup fails. */
export async function loadReviewers(supabase: SupabaseClient, id: string): Promise<Reviewer[]> {
  const { data, error } = await supabase
    .from("presentation_reviewers")
    .select("reviewer_id, name, email, reviewed_on")
    .eq("presentation_id", id)
    .order("reviewed_on", { ascending: false });
  if (error) throw error;
  return data.map((row) => ({ reviewerId: row.reviewer_id, name: row.name, email: row.email, reviewedOn: row.reviewed_on }));
}
