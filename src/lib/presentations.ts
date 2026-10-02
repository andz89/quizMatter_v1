import { z, ZodError } from "zod";
import { createClient } from "./supabase/client";
import {
  MAX_PRESENTATIONS,
  MAX_SLIDES,
  TOO_MANY_SLIDES_MESSAGE,
  presentationSchema,
  type Presentation,
  type Slide,
} from "./schema";

/** A save the database refused on purpose. `message` tells the user why. */
export class SaveRefusedError extends Error {
  // isConflict: someone saved a newer copy (another tab or device) since this one was opened or saved.
  constructor(message: string, readonly isConflict = false) {
    super(message);
  }
}

// The database's error codes for refused saves (see the supabase/migrations), and what the user is told.
const REFUSALS: Record<string, string> = {
  QM409: "This presentation was saved in another tab or device. Reload the page to get the newest copy.",
  QMMAX: `You have ${MAX_PRESENTATIONS} presentations, the most allowed. Delete some to make new ones.`,
  QM429: "You're saving too fast. Wait a minute and try again.",
  QMBAN: "Your account is blocked, so you can't save. Contact QuizMatter if you think this is a mistake.",
};

/** What to tell the user when a save failed, e.g. saveErrorMessage(error, "make a copy"). */
export function saveErrorMessage(error: unknown, action: string): string {
  if (error instanceof SaveRefusedError) return error.message;
  // A zod error says what's wrong (e.g. a link that isn't valid); anything else is most likely the connection.
  if (error instanceof ZodError) return `Couldn't ${action}: ${error.issues[0].message}`;
  return `Couldn't ${action}. Please check your internet and try again.`;
}

const slideIdsSchema = z
  .array(z.string().max(100))
  .min(1)
  .max(MAX_SLIDES, TOO_MANY_SLIDES_MESSAGE);

/**
 * Saves the presentation (details + slides, in order) in one step. The `save_presentation` database function also
 * removes slides that were deleted. Returns the new save time (Unix ms), the next save's `baseUpdatedAt`.
 *
 * - `baseUpdatedAt`: when the copy being edited was last saved; null for a presentation that was never saved. If
 *   someone saved since then, nothing is saved and it throws a SaveRefusedError (isConflict).
 * - `savedSlides`: the slides as they were last saved. Only slides that aren't one of these (same object) are
 *   sent; the editor never changes a slide in place, so the same object means the same content. Leave it out
 *   to send every slide.
 *
 * Throws if it fails: a SaveRefusedError (too many presentations or saves, or a conflict), a ZodError if the data
 * isn't valid, or the database's error.
 */
export async function savePresentationToDb(
  presentation: Presentation,
  { baseUpdatedAt = null, savedSlides }: { baseUpdatedAt?: number | null; savedSlides?: Slide[] } = {},
): Promise<number> {
  const unchanged = new Set(savedSlides);
  // Empty reference rows (added but not filled in) are dropped, not saved.
  const referenceLinks = presentation.referenceLinks.map((link) => link.trim()).filter(Boolean);
  const slides = presentation.slides.filter((slide) => !unchanged.has(slide));
  // Checked with zod first (see CLAUDE.md, "Saving Data"): bad data throws here and is never saved. The slide
  // count is checked first, on every slide (only changed slides are in `slides`).
  const slideIds = slideIdsSchema.parse(presentation.slides.map((slide) => slide.id));
  const { data, error } = await createClient().rpc("save_presentation", {
    presentation: presentationSchema.parse({ ...presentation, referenceLinks, slides }),
    slide_ids: slideIds,
    base_updated_at: baseUpdatedAt,
  });
  if (error && REFUSALS[error.code]) throw new SaveRefusedError(REFUSALS[error.code], error.code === "QM409");
  // The database's slide-count check (same limit as slideIdsSchema). Its code, 22023, is shared with checks that
  // only fail on a bug, so the message tells them apart.
  if (error?.code === "22023" && error.message.startsWith("A presentation needs")) {
    throw new SaveRefusedError(TOO_MANY_SLIDES_MESSAGE);
  }
  // A slide thought to be saved isn't in the database: save again with every slide.
  if (error?.code === "QM422" && savedSlides) return savePresentationToDb(presentation, { baseUpdatedAt });
  if (error) throw error;
  return data;
}
