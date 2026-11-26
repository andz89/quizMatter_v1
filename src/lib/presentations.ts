import { z, ZodError } from "zod";
import { createClient } from "./supabase/client";
import { pausedUntilFromError } from "./clickLimits";
import {
  DATA_VERSION,
  MAX_PRESENTATIONS,
  MAX_SLIDES,
  PUBLISH_NEEDS_CONTENT,
  TOO_MANY_SLIDES_MESSAGE,
  idSchema,
  presentationSchema,
  type Presentation,
  type Slide,
} from "./schema";
import { SUPPORT_EMAIL } from "./support";

/** A save the database refused on purpose. `message` tells the user why. */
export class SaveRefusedError extends Error {
  // isConflict: someone saved a newer copy (another tab or device) since this one was opened or saved.
  // isOutdated: newer app code saved it (QMOLD), so this tab's older code must reload first (see keptWork.ts).
  // (Written out, not `readonly isConflict` in the constructor: Node's test runner can't read that shortcut.)
  readonly isConflict: boolean;
  readonly isOutdated: boolean;
  constructor(message: string, isConflict = false, isOutdated = false) {
    super(message);
    this.isConflict = isConflict;
    this.isOutdated = isOutdated;
  }
}

/** The SaveRefusedError for a refusal code the app knows (see REFUSALS), else null. */
export function refusalFromCode(code: string): SaveRefusedError | null {
  return REFUSALS[code] ? new SaveRefusedError(REFUSALS[code], code === "QM409", code === "QMOLD") : null;
}

// The database's error codes for refused saves (see the supabase/migrations), and what the user is told. Also
// used by the Save (bookmark) button.
export const REFUSALS: Record<string, string> = {
  QM409: "This presentation was saved in another tab or device. Reload the page to get the newest copy.",
  QMMAX: `You have ${MAX_PRESENTATIONS} presentations, the most allowed. Delete some to make new ones.`,
  QM429: "You're saving too fast. Wait a minute and try again.",
  QMBAN: `Your account is blocked, so you can't save. If you think this is a mistake, email ${SUPPORT_EMAIL}.`,
  // Saved by newer app code (see the data_version migration).
  QMOLD: "QuizMatter was updated. Reload the page to keep editing.",
  // Maintenance (Admin → Maintenance): the tab goes to /maintenance right after (src/components/MaintenanceWatch.tsx).
  QMMNT: "QuizMatter is under maintenance. Your unsaved work is kept in this browser.",
  // Presentation reviews and submissions (see the presentation_reviews and quizmatter_submissions migrations).
  QMREV: "This presentation is under review or waiting for QuizMatter, so it can't be changed right now. Copy anything you need before leaving.",
  QMRVW: "Someone else is reviewing this presentation, or you can't review it right now.",
  QMSUB: "This presentation is already waiting for QuizMatter, or already in QuizMatter.",
  // Publishing an empty presentation (see the share_limits migration).
  QMPUB: PUBLISH_NEEDS_CONTENT,
  // A slide got back a photo the teacher uploaded that no longer counted, and it doesn't fit their photo storage
  // (sync_slide_photos, see the photo_storage_fixes migration).
  QMSTO: "Your photo storage is full, so a photo you put back on a slide can't be saved. Remove that photo, or free space by removing photos from My photos and from your slides.",
  // Deleting an original whose shared copy QuizMatter hid (see the sharing_fixes migration).
  QMHID: `QuizMatter hid this presentation's shared copy, so it can't be deleted. If you think this is a mistake, email ${SUPPORT_EMAIL}.`,
};

/** What to tell the user when a save failed, e.g. saveErrorMessage(error, "make a copy"). */
export function saveErrorMessage(error: unknown, action: string): string {
  if (error instanceof SaveRefusedError) return error.message;
  // A zod error says what's wrong (e.g. a link that isn't valid); anything else is most likely the connection.
  if (error instanceof ZodError) return `Couldn't ${action}: ${error.issues[0].message}`;
  // A click limit paused it (e.g. too many new presentations today); the notice at the bottom says until when.
  if (pausedUntilFromError(error as { code?: string; details?: string })) return `Couldn't ${action}: it's paused for now. The notice at the bottom says until when.`;
  return `Couldn't ${action}. Please check your internet and try again.`;
}

/**
 * The SaveRefusedError for a database error that says why a save can't work (a refusal code, or a limit a teacher
 * can reach), else null: the error is then most likely the connection or a bug.
 */
export function saveRefusal(error: { code: string; message: string }): SaveRefusedError | null {
  const refusal = refusalFromCode(error.code);
  if (refusal) return refusal;
  // The database's slide-count check (same limit as slideIdsSchema). Its code, 22023, is shared with checks that
  // only fail on a bug, so the message tells them apart.
  if (error.code === "22023" && error.message.startsWith("A presentation needs")) {
    return new SaveRefusedError(TOO_MANY_SLIDES_MESSAGE);
  }
  // A slide over the database's 2 MB (slides_data_is_small_object). zod checks each text, not a whole slide, so
  // many big drawings or long texts on one slide get here.
  if (error.code === "23514" && error.message.includes("slides_data_is_small_object")) {
    return new SaveRefusedError("A slide you changed is too big to save. Remove some drawings or long text from it, then click Save.");
  }
  return null;
}

const slideIdsSchema = z
  .array(z.string().max(100))
  .min(1)
  .max(MAX_SLIDES, TOO_MANY_SLIDES_MESSAGE);

// Where on a slide a text is too long, by the first part of zod's path inside the slide.
const TEXT_PLACES: Record<string, string> = {
  question: "its question",
  questionHtml: "its question",
  options: "an answer choice",
  correctAnswer: "its answer",
  name: "its name",
  elements: "a text box or table",
};

const ORDINAL_ENDINGS: Partial<Record<Intl.LDMLPluralRule, string>> = { one: "st", two: "nd", few: "rd" };

/** 1st, 2nd, 3rd, 4th, 11th, 21st, … */
function ordinal(n: number): string {
  return `${n}${ORDINAL_ENDINGS[new Intl.PluralRules("en", { type: "ordinal" }).select(n)] ?? "th"}`;
}

/**
 * zod's refusal of a slide as a SaveRefusedError naming the slide (its place in the slide list) and, for a text
 * that's too long, the box: the editor doesn't stop typing at the limits, so a teacher can reach them. Null when the
 * problem isn't on a slide. `sent` is the slides that were checked (only the changed ones).
 */
function slideRefusal(error: z.ZodError, presentation: Presentation, sent: Slide[]): SaveRefusedError | null {
  const issue = error.issues[0];
  const [field, index, part] = issue.path;
  if (field !== "slides" || typeof index !== "number") return null;
  const slide = `The ${ordinal(presentation.slides.indexOf(sent[index]) + 1)} slide`;
  if (issue.code === "too_big" && issue.origin === "string") {
    return new SaveRefusedError(`${slide} has too much text in ${TEXT_PLACES[String(part)] ?? "one box"}. Shorten it, then click Save.`);
  }
  return new SaveRefusedError(`${slide} can't be saved (${issue.message}). Fix it, then click Save.`);
}

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
 * Throws if it fails: a SaveRefusedError (too many presentations or saves, a conflict, or a slide over a limit), a
 * ZodError if other data isn't valid, or the database's error.
 */
export async function savePresentationToDb(
  presentation: Presentation,
  {
    baseUpdatedAt = null,
    savedSlides,
    copiedFrom,
  }: {
    baseUpdatedAt?: number | null;
    savedSlides?: Slide[];
    // Make a copy: the presentation it was copied from (kept only on the first save, see the
    // editor_author_and_copy_source migration).
    copiedFrom?: string;
  } = {},
): Promise<number> {
  const unchanged = new Set(savedSlides);
  // Empty reference rows (added but not filled in) are dropped, not saved.
  const referenceLinks = presentation.referenceLinks.map((link) => link.trim()).filter(Boolean);
  const slides = presentation.slides.filter((slide) => !unchanged.has(slide));
  // Checked with zod first (see CLAUDE.md, "Saving Data"): bad data throws here and is never saved. The slide
  // count is checked first, on every slide (only changed slides are in `slides`).
  const slideIds = slideIdsSchema.parse(presentation.slides.map((slide) => slide.id));
  const checked = presentationSchema.safeParse({ ...presentation, referenceLinks, slides });
  if (!checked.success) throw slideRefusal(checked.error, presentation, slides) ?? checked.error;
  const source = copiedFrom && idSchema.parse(copiedFrom);
  const { data, error } = await createClient().rpc("save_presentation", {
    presentation: { ...checked.data, copiedFrom: source },
    slide_ids: slideIds,
    // null = a new presentation; the generated types can't say an argument may be null.
    base_updated_at: baseUpdatedAt as number,
    app_version: DATA_VERSION,
  });
  const refusal = error && saveRefusal(error);
  if (refusal) throw refusal;
  // A slide thought to be saved isn't in the database: save again with every slide.
  if (error?.code === "QM422" && savedSlides) return savePresentationToDb(presentation, { baseUpdatedAt, copiedFrom });
  if (error) throw error;
  return data;
}
