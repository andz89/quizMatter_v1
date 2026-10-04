import { createClient } from "./supabase/client";
import { REFUSALS, SaveRefusedError } from "./presentations";
import { presentationSchema, reviewerSchema, savedPresentationSchema, type Presentation, type ReviewerFields } from "./schema";

// The reviewer's steps (see the presentation_reviews migration). Each is checked with zod right before the
// database call (see CLAUDE.md, "Saving Data"), and throws a SaveRefusedError with a message for refusals.

function throwIfRefused(error: { code: string; message: string } | null) {
  if (error && REFUSALS[error.code]) throw new SaveRefusedError(REFUSALS[error.code], error.code === "QM409");
  if (error?.code === "22023" && error.message.startsWith("A presentation needs")) throw new SaveRefusedError(error.message);
  if (error) throw error;
}

// The whole draft: details and every slide. Empty reference rows are dropped, like a normal save.
function parseDraft(presentation: Presentation) {
  const referenceLinks = presentation.referenceLinks.map((link) => link.trim()).filter(Boolean);
  return presentationSchema.parse({ ...presentation, referenceLinks });
}

/** Makes me the reviewer of this shared QuizMatter presentation. */
export async function startReview(id: string): Promise<void> {
  const { presentation_id } = savedPresentationSchema.parse({ presentation_id: id });
  const { error } = await createClient().rpc("start_review", { target_id: presentation_id });
  throwIfRefused(error);
}

/** Saves my draft. `baseUpdatedAt`: when the copy being edited was saved. Returns the new save time. */
export async function saveReviewDraft(presentation: Presentation, baseUpdatedAt: number | null): Promise<number> {
  const { data, error } = await createClient().rpc("save_review_draft", {
    target_id: presentation.id,
    review_draft: parseDraft(presentation),
    base_updated_at: baseUpdatedAt,
  });
  throwIfRefused(error);
  return data;
}

/** Saves my draft with my "Reviewed by" details and sends them to the admins. */
export async function submitReview(presentation: Presentation, fields: ReviewerFields): Promise<void> {
  const { error } = await createClient().rpc("submit_review", {
    target_id: presentation.id,
    review_draft: parseDraft(presentation),
    fields: reviewerSchema.parse(fields),
  });
  throwIfRefused(error);
}

/** Ends my review: the draft is thrown away and the live presentation stays as it was. */
export async function stopReview(id: string): Promise<void> {
  const { presentation_id } = savedPresentationSchema.parse({ presentation_id: id });
  const { error } = await createClient().rpc("stop_review", { target_id: presentation_id });
  throwIfRefused(error);
}
