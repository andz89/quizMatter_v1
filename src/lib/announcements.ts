import { z } from "zod";
import { PHOTO_MAX_SIDE, PHOTO_URL_PREFIX } from "./constants";
import { facebookLink } from "./facebook";
import type { EducationLevel } from "./userSettings";
import { YOUTUBE_ID } from "./youtube";

// Announcements: the super admin shows a modal and/or a top bar to chosen teachers.
// Design: docs/superpowers/specs/2026-10-30-announcements-design.md. Database: 20261221000000_announcements.sql.
// The limits and lists below are the database's checks, number for number; change both together.

// The page groups an announcement can be limited to, in the order the form lists them.
export const PAGE_GROUPS = [
  { key: "my_presentations", label: "My presentations" },
  { key: "quizmatter", label: "From QuizMatter" },
  { key: "other_teachers", label: "Other teachers" },
  { key: "saved", label: "Saved" },
  { key: "liked", label: "Liked" },
  { key: "reviews_submissions", label: "Reviews & submissions" },
  { key: "search", label: "Search" },
  { key: "presentation_view", label: "Viewing a presentation" },
  { key: "editor", label: "The editor" },
  { key: "account", label: "Account" },
  { key: "teacher_profiles", label: "Teacher profiles" },
] as const;
export type PageGroup = (typeof PAGE_GROUPS)[number]["key"];

/** Which group a page belongs to, or null for a page that never shows announcements (admin, login, legal, …). */
export function pageGroup(pathname: string): PageGroup | null {
  if (pathname === "/" || pathname === "/presentations") return "my_presentations";
  if (pathname === "/quizmatter") return "quizmatter";
  if (pathname === "/teachers") return "other_teachers";
  if (/^\/teachers\/[^/]+$/.test(pathname)) return "teacher_profiles";
  if (pathname === "/saved") return "saved";
  if (pathname === "/liked") return "liked";
  if (pathname === "/reviews-submissions") return "reviews_submissions";
  if (pathname === "/search") return "search";
  if (pathname === "/presentation/new" || /^\/presentation\/[^/]+\/edit$/.test(pathname)) return "editor";
  if (/^\/presentation\/[^/]+$/.test(pathname)) return "presentation_view";
  if (pathname === "/account") return "account";
  return null;
}

export const REPEATS = ["once", "daily", "every_visit"] as const;
export const REPEAT_LABELS: Record<(typeof REPEATS)[number], string> = {
  once: "Once, until they close it",
  daily: "Once a day",
  every_visit: "Every visit",
};

export const ANNOUNCEMENT_ROLES = ["teacher", "editor", "admin"] as const;
export const ROLE_LABELS: Record<(typeof ANNOUNCEMENT_ROLES)[number], string> = {
  teacher: "Teachers",
  editor: "Editors",
  admin: "Admins",
};

export type AnnouncementPart = "modal" | "bar";

/** The modal's widths, in px. The height always fits its text and attachment. Large is the normal modal (Modal's max-w-2xl). */
export const MODAL_SIZES = [
  { key: "small", label: "Small (300 wide)", width: 300 },
  { key: "medium", label: "Medium (500 wide)", width: 500 },
  { key: "large", label: "Large (672 wide, normal)", width: 672 },
] as const;
export type ModalSize = (typeof MODAL_SIZES)[number]["key"];
const MODAL_SIZE_KEYS = MODAL_SIZES.map((size) => size.key) as [ModalSize, ...ModalSize[]];

export const ANNOUNCEMENT_LIMITS = {
  name: 100,
  modalText: 5_000,
  videoTitle: 200,
  barHtml: 1_000,
  closeAfter: 60,
  ageMin: 18,
  ageMax: 100,
  presentationsMax: 50,
  words: 20,
  wordLength: 60,
  // The HTML modal (20261230000000_announcement_html.sql checks the same numbers).
  modalHtml: 100_000,
  modalHeightMin: 100,
  modalHeightMax: 1_000,
  // The HTML top bar (20261231000000_announcement_bar_html.sql): its HTML has modalHtml's limit, a text bar barHtml's.
  barHeightMin: 30,
  barHeightMax: 300,
};
const L = ANNOUNCEMENT_LIMITS;

// A modal is a post (text + one attachment) or HTML in a sealed box (sandboxedHtml); a top bar is text (the editor's
// cleaned HTML) or HTML in a sealed box.
export const MODAL_FORMATS = ["post", "html"] as const;
export type ModalFormat = (typeof MODAL_FORMATS)[number];
export const DEFAULT_MODAL_HEIGHT = 400;
export const BAR_FORMATS = ["text", "html"] as const;
export type BarFormat = (typeof BAR_FORMATS)[number];
export const DEFAULT_BAR_HEIGHT = 60;

// Same values as EDUCATION_LEVELS in userSettings.ts. That file can't load in a test (it imports svgLibrary,
// which a test can't load), so they're repeated here; the type check below fails if the two ever differ.
const EDUCATION_LEVELS = ["bachelor", "master", "doctorate", "other"] as const satisfies readonly EducationLevel[];
const _allLevels: EducationLevel extends (typeof EDUCATION_LEVELS)[number] ? true : never = true;
void _allLevels;

const words = z
  .array(z.string().max(L.wordLength).refine((w) => w.trim() !== "", "A word can't be empty."))
  .max(L.words);
const age = z.number().int().min(L.ageMin).max(L.ageMax).nullable();
const count = z.number().int().min(0).max(L.presentationsMax).nullable();
const time = z.iso.datetime({ offset: true }).nullable();

// Every key the database's save_announcement reads (a missing key counts as empty there and is refused).
// The modal's one attachment, under its text (spec docs/superpowers/specs/2026-10-31-announcement-post-design.md):
// one of our photos, a YouTube card whose thumbnail is our own copy, or a Facebook post / video (only its link; shown
// with Facebook's own player). Same rules as announcement_attachment_ok in 20261226000000_announcement_facebook.sql
// (src our R2 address; sizes 1–1920; a Facebook link as facebookLink gives it; only these keys).
// A picture's address must be ours (R2); also checks an announcement photo before its delete.
export const ourPhoto = z
  .string()
  .max(300)
  .refine((src) => src.startsWith(PHOTO_URL_PREFIX) && !/[\s"'<>]/.test(src), "Only our own photos.");
const side = z.number().int().min(1).max(PHOTO_MAX_SIDE).optional();
export const modalAttachmentSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("photo"), src: ourPhoto, width: side, height: side }),
  z.strictObject({
    kind: z.literal("youtube"),
    video_id: z.string().regex(YOUTUBE_ID),
    title: z.string().max(L.videoTitle),
    src: ourPhoto,
    width: side,
    height: side,
  }),
  z.strictObject({
    kind: z.literal("facebook"),
    href: z.string().refine((href) => facebookLink(href)?.href === href, "Only a Facebook post or video link."),
    video: z.boolean(),
  }),
]);
export type ModalAttachment = z.infer<typeof modalAttachmentSchema>;

// Admin → Announcements → Photos (20261229000000_announcement_photos.sql). Same limit as add_announcement_photo.
export const ANNOUNCEMENT_PHOTOS_MAX = 500;

/** One row of admin_announcement_photos(): `used_by` = the names of the announcements whose modal shows it. */
export type AnnouncementPhoto = {
  src: string;
  // Empty only for a photo copied from an older announcement that didn't keep its size.
  width: number | null;
  height: number | null;
  created_at: string;
  used_by: string[];
};

export const announcementSchema = z
  .object({
    id: z.uuid().nullable(),
    name: z.string().max(L.name).refine((n) => n.trim() !== "", "Give it a name."),
    is_on: z.boolean(),
    starts_at: time,
    ends_at: time,
    show_modal: z.boolean(),
    modal_text: z.string().max(L.modalText),
    modal_attachment: modalAttachmentSchema.nullable(),
    modal_close_after: z.number().int().min(0).max(L.closeAfter),
    show_bar: z.boolean(),
    // Up to modalHtml for an html bar; a text bar is held to barHtml below.
    bar_html: z.string().max(L.modalHtml),
    bar_close_after: z.number().int().min(0).max(L.closeAfter),
    repeat: z.enum(REPEATS),
    pages: z.array(z.enum(["all", ...PAGE_GROUPS.map((g) => g.key)])).min(1),
    genders: z.array(z.enum(["male", "female"])),
    age_min: age,
    age_max: age,
    education_levels: z.array(z.enum(EDUCATION_LEVELS)),
    field_words: words,
    presentations_min: count,
    presentations_max: count,
    roles: z.array(z.enum(ANNOUNCEMENT_ROLES)),
    modal_size: z.enum(MODAL_SIZE_KEYS),
    modal_format: z.enum(MODAL_FORMATS),
    modal_html: z.string().max(L.modalHtml),
    modal_height: z.number().int().min(L.modalHeightMin).max(L.modalHeightMax),
    bar_format: z.enum(BAR_FORMATS),
    bar_height: z.number().int().min(L.barHeightMin).max(L.barHeightMax),
  })
  .refine((a) => a.bar_format !== "text" || a.bar_html.length <= L.barHtml, {
    message: `The bar's text is too long (${L.barHtml} characters at most, with its formatting).`,
    path: ["bar_html"],
  })
  .refine((a) => a.show_modal || a.show_bar, { message: "Turn on the modal or the bar.", path: ["show_modal"] })
  .refine((a) => !a.show_modal || a.modal_format !== "html" || a.modal_html.trim() !== "", {
    message: "The HTML box needs HTML.",
    path: ["modal_html"],
  })
  // One type per announcement; the database refuses both too (20261228000000_announcement_one_on.sql).
  .refine((a) => !(a.show_modal && a.show_bar), { message: "Pick a modal or a top bar, not both.", path: ["show_bar"] })
  .refine((a) => !a.show_modal || a.modal_format !== "post" || a.modal_text.trim() !== "" || a.modal_attachment !== null, {
    message: "The modal needs text, a picture or a YouTube video.",
    path: ["modal_text"],
  })
  .refine((a) => !a.show_bar || a.bar_html.trim() !== "", { message: "The bar needs text.", path: ["bar_html"] })
  .refine((a) => a.age_min === null || a.age_max === null || a.age_min <= a.age_max, {
    message: "The youngest age can't be above the oldest.",
    path: ["age_max"],
  })
  .refine(
    (a) => a.presentations_min === null || a.presentations_max === null || a.presentations_min <= a.presentations_max,
    { message: "The fewest presentations can't be above the most.", path: ["presentations_max"] },
  )
  .refine((a) => !a.starts_at || !a.ends_at || new Date(a.ends_at) > new Date(a.starts_at), {
    message: "It must end after it starts.",
    path: ["ends_at"],
  });
export type AnnouncementInput = z.infer<typeof announcementSchema>;

// One row of my_announcements(). A closed part comes back with show_* false and no text. A row kept in a tab from
// before the post fields has none: no text, no attachment.
export const myAnnouncementSchema = z.object({
  id: z.string(),
  show_modal: z.boolean(),
  modal_text: z.string().catch(""),
  modal_attachment: modalAttachmentSchema.nullable().catch(null),
  modal_close_after: z.number(),
  show_bar: z.boolean(),
  bar_html: z.string(),
  bar_close_after: z.number(),
  repeat: z.enum(REPEATS),
  pages: z.array(z.string()),
  created_at: z.string(),
  // Missing (a row from before sizes, e.g. kept in a tab) = large, the size modals had then.
  modal_size: z.enum(MODAL_SIZE_KEYS).catch("large"),
  // Missing (a row from before the HTML modal) = a post.
  modal_format: z.enum(MODAL_FORMATS).catch("post"),
  modal_html: z.string().catch(""),
  modal_height: z.number().catch(DEFAULT_MODAL_HEIGHT),
  // Missing (a row from before the HTML bar) = a text bar.
  bar_format: z.enum(BAR_FORMATS).catch("text"),
  bar_height: z.number().catch(DEFAULT_BAR_HEIGHT),
});
export type MyAnnouncement = z.infer<typeof myAnnouncementSchema>;

// The sealed box's lock list (Content Security Policy): its own inline scripts and styles, pictures and media only
// from our storage, nothing else (no outside scripts, fonts or frames, and no sending data anywhere: connect-src
// falls back to 'none').
const PHOTO_ORIGIN = new URL(PHOTO_URL_PREFIX).origin;
const SEALED_BOX_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  `img-src ${PHOTO_ORIGIN} data: blob:`,
  `media-src ${PHOTO_ORIGIN} data: blob:`,
  "font-src data:",
  "form-action 'none'",
].join("; ");

/**
 * The document an HTML modal runs in (spec docs/superpowers/specs/2026-11-01-announcement-html-design.md): the lock
 * list first (a later one in the admin's HTML can only tighten it), links open a new tab, then the admin's HTML. It's
 * shown only in AnnouncementView's sandboxed frame, which keeps it away from QuizMatter and the teacher's login.
 */
export function sandboxedHtml(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${SEALED_BOX_POLICY}"><meta name="viewport" content="width=device-width, initial-scale=1"><base target="_blank"></head><body style="margin:0">${html}</body></html>`;
}

/**
 * What to show on a page: the announcements that fit it, without parts this tab closed (key "<id>:modal" or
 * "<id>:bar"), newest first. At most 2 bars.
 */
export function pickForPage(
  list: MyAnnouncement[],
  group: PageGroup,
  closed: ReadonlySet<string>,
): { modals: MyAnnouncement[]; bars: MyAnnouncement[] } {
  const fits = list
    .filter((a) => a.pages.includes("all") || a.pages.includes(group))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return {
    modals: fits.filter((a) => a.show_modal && !closed.has(`${a.id}:modal`)),
    bars: fits.filter((a) => a.show_bar && !closed.has(`${a.id}:bar`)).slice(0, 2),
  };
}

/**
 * A path inside QuizMatter ("/saved"), not another site ("//x.com", "https://…"). Browsers read "\" as "/" and skip
 * tabs and line breaks, so "/\x.com" and "/<tab>/x.com" are other sites too: a path has no "\" or spaces.
 */
export function isInternalLink(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//") && !/[\s\\]/.test(href);
}

/** Links an announcement may hold: http(s) addresses and paths inside the app. */
export function isAllowedLink(href: string): boolean {
  return /^https?:\/\//i.test(href) || isInternalLink(href);
}

/** Where a tab keeps the teacher's announcements (sessionStorage; AnnouncementsWatch). */
export const ANNOUNCEMENTS_STORE = "qm:announcements";

/** Forgets this tab's list (on log out), so the next teacher on a shared computer can't find the last one's. */
export function forgetAnnouncements() {
  try {
    sessionStorage.removeItem(ANNOUNCEMENTS_STORE);
  } catch {
    // Storage blocked: nothing was kept.
  }
}

/** The date in the Philippines, "YYYY-MM-DD" (the database's manila_today). */
export function manilaDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);
}

/**
 * Whether a tab's saved announcements (and the parts closed in it) still belong to this visit: the same account and
 * the same Philippine day. Another teacher logging in on a shared computer, or midnight, starts over.
 */
export function isSameVisit(
  saved: { day: string; userId: string } | null,
  now: { day: string; userId: string },
): boolean {
  return saved !== null && saved.day === now.day && saved.userId === now.userId;
}
