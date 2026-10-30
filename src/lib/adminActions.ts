import { z } from "zod";

/**
 * The steps the admin log records (Admin → Admin log), with the words shown for each. The database writes the rows
 * (see the admin_log migration); its `action` check lists the same keys, so add a new one in both places.
 */
export const ADMIN_ACTION_LABELS = {
  review_published: "Published a review",
  review_sent_back: "Sent a review back",
  review_canceled: "Canceled a review",
  review_opened: "Opened to all editors",
  review_closed: "Closed to other editors",
  submission_approved: "Approved a submission",
  submission_sent_back: "Sent a submission back",
  presentation_shared: "Shared with teachers",
  presentation_unshared: "Made a draft again",
  presentation_moved: "Moved to QuizMatter",
  presentation_hidden: "Hid a presentation",
  presentation_unhidden: "Unhid a presentation",
  reports_dismissed: "Dismissed reports",
  presentation_deleted: "Deleted a presentation",
  teacher_banned: "Banned a teacher",
  ban_updated: "Changed a ban reason",
  teacher_unbanned: "Unbanned a teacher",
  editor_added: "Made an editor",
  editor_removed: "Removed an editor",
  pause_released: "Released a pause",
  category_created: "Made a category",
  category_renamed: "Renamed a category",
  category_deleted: "Deleted a category",
  photo_deleted: "Deleted a photo",
  profile_photo_removed: "Removed a profile photo",
  maintenance_on: "Turned maintenance on",
  maintenance_off: "Turned maintenance off",
  maintenance_announced: "Announced maintenance",
  announcement_saved: "Saved an announcement",
  announcement_deleted: "Deleted an announcement",
} as const satisfies Record<string, string>;

export type AdminAction = keyof typeof ADMIN_ACTION_LABELS;

/** One action key, e.g. for the log page's filter (checked with zod). */
export const adminActionSchema = z.enum(Object.keys(ADMIN_ACTION_LABELS) as [AdminAction, ...AdminAction[]]);
