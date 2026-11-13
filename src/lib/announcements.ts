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

export const REPEATS = ["once", "daily", "every_visit", "interval"] as const;
export const REPEAT_LABELS: Record<(typeof REPEATS)[number], string> = {
  once: "Once, until they close it",
  daily: "Once a day",
  every_visit: "Every visit",
  interval: "Again every N minutes",
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
  // The corner box closes itself after this many seconds, or never (0) (20261231000300_announcement_corner_box.sql).
  autoCloseMin: 5,
  autoCloseMax: 600,
  // A modal or corner box shows after this many seconds in the tab (0 = at once)
  // (20261231000600_announcement_show_after.sql).
  showAfterMax: 600,
  // "Again every N minutes": N is 1–1,440 (20261231000700_announcement_interval.sql).
  repeatMinutesMax: 1440,
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

// Where a modal row shows (spec docs/superpowers/specs/2026-11-02-announcement-corner-box-design.md): in the middle
// (the modal) or as a box at the bottom-right that doesn't block the page (the corner box), Small or Medium only.
export const MODAL_DISPLAYS = ["center", "corner"] as const;
export type ModalDisplay = (typeof MODAL_DISPLAYS)[number];
export const CORNER_SIZES: ModalSize[] = ["small", "medium"];

/** The three types an announcement can be, as the admin pages name them; each has its own "one on" slot. */
export type AnnouncementType = "modal" | "bar" | "corner";
export function announcementType(a: { show_bar: boolean; modal_display: ModalDisplay }): AnnouncementType {
  if (a.show_bar) return "bar";
  return a.modal_display === "corner" ? "corner" : "modal";
}
export const TYPE_WORDS: Record<AnnouncementType, string> = { modal: "modal", bar: "top bar", corner: "corner box" };

/** The admin list's status label ("off" shows as Draft). Same rule as the database's announcement_is_live. */
export type AnnouncementStatus = "live" | "scheduled" | "ended" | "off";
export function announcementStatus(
  a: { is_on: boolean; starts_at: string | null; ends_at: string | null },
  now: Date,
): AnnouncementStatus {
  if (a.ends_at !== null && new Date(a.ends_at) <= now) return "ended";
  if (!a.is_on) return "off";
  if (a.starts_at !== null && new Date(a.starts_at) > now) return "scheduled";
  return "live";
}

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
// An empty height box sends 0: say which box is wrong, not zod's "Too small".
const MODAL_HEIGHT_WRONG = `The box height must be ${L.modalHeightMin}–${L.modalHeightMax.toLocaleString("en-US")} px.`;
const BAR_HEIGHT_WRONG = `The bar height must be ${L.barHeightMin}–${L.barHeightMax} px.`;
const AUTO_CLOSE_WRONG = `It closes itself after ${L.autoCloseMin}–${L.autoCloseMax} seconds, or never.`;
const SHOW_AFTER_WRONG = `It shows after 0–${L.showAfterMax} seconds.`;
const MINUTES_WRONG = `Pick 1–${L.repeatMinutesMax.toLocaleString("en-US")} minutes.`;

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

/**
 * A YouTube title as the card keeps it: trimmed, and cut to `L.videoTitle` by whole characters (an emoji, even one
 * joined from several, is kept whole or left out whole), so a long title never makes the card fail its check.
 */
export function cutVideoTitle(title: string): string {
  let cut = "";
  for (const { segment } of new Intl.Segmenter().segment(title.trim())) {
    if (cut.length + segment.length > L.videoTitle) break;
    cut += segment;
  }
  return cut.trimEnd();
}

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
    modal_height: z.number().int(MODAL_HEIGHT_WRONG).min(L.modalHeightMin, MODAL_HEIGHT_WRONG).max(L.modalHeightMax, MODAL_HEIGHT_WRONG),
    bar_format: z.enum(BAR_FORMATS),
    bar_height: z.number().int(BAR_HEIGHT_WRONG).min(L.barHeightMin, BAR_HEIGHT_WRONG).max(L.barHeightMax, BAR_HEIGHT_WRONG),
    modal_display: z.enum(MODAL_DISPLAYS),
    modal_auto_close: z
      .number()
      .int(AUTO_CLOSE_WRONG)
      .refine((n) => n === 0 || (n >= L.autoCloseMin && n <= L.autoCloseMax), AUTO_CLOSE_WRONG),
    modal_show_after: z.number().int(SHOW_AFTER_WRONG).min(0, SHOW_AFTER_WRONG).max(L.showAfterMax, SHOW_AFTER_WRONG),
    repeat_minutes: z.number().int(MINUTES_WRONG),
  })
  // Same rule as the table's announcements_repeat_minutes check.
  .refine((a) => a.repeat !== "interval" || (a.repeat_minutes >= 1 && a.repeat_minutes <= L.repeatMinutesMax), {
    message: MINUTES_WRONG,
    path: ["repeat_minutes"],
  })
  .refine((a) => a.repeat === "interval" || a.repeat_minutes === 0, {
    message: "Minutes go only with 'Again every N minutes'.",
    path: ["repeat_minutes"],
  })
  .refine((a) => a.modal_display === "center" || CORNER_SIZES.includes(a.modal_size), {
    message: "A corner box is Small or Medium.",
    path: ["modal_size"],
  })
  .refine((a) => a.modal_display === "corner" || a.modal_auto_close === 0, {
    message: "Only a corner box closes itself.",
    path: ["modal_auto_close"],
  })
  .refine((a) => !a.show_bar || a.modal_show_after === 0, {
    message: "A top bar shows at once.",
    path: ["modal_show_after"],
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
  // Missing (a row from before the corner box) = a centered modal that never closes itself.
  modal_display: z.enum(MODAL_DISPLAYS).catch("center"),
  modal_auto_close: z.number().catch(0),
  // Missing (a row from before the wait) = shows at once.
  modal_show_after: z.number().catch(0),
  // Missing (a row from before "every N minutes") = 0.
  repeat_minutes: z.number().catch(0),
});
export type MyAnnouncement = z.infer<typeof myAnnouncementSchema>;

/** What the sealed box sends the page (postMessage) when Escape is pressed inside it; the modal then closes. */
export const SEALED_BOX_ESCAPE = "qm-box:escape";

// Our helper, before the admin's HTML: Escape tells the page (key presses inside the box never reach it), and a
// "#part" link scrolls inside the box instead of opening an empty tab (<base target="_blank">).
const SEALED_BOX_HELPER = `<script>
addEventListener("keydown", function (e) { if (e.key === "Escape") parent.postMessage("${SEALED_BOX_ESCAPE}", "*"); });
addEventListener("click", function (e) {
  var link = e.target.closest && e.target.closest('a[href^="#"]');
  if (!link) return;
  e.preventDefault();
  var id = decodeURIComponent(link.getAttribute("href").slice(1));
  var target = id ? document.getElementById(id) || document.getElementsByName(id)[0] : document.body;
  if (target) target.scrollIntoView({ behavior: "smooth" });
}, true);
</script>`;

/**
 * The document an HTML modal or top bar runs in (spec docs/superpowers/specs/2026-11-01-announcement-html-design.md):
 * our helper, links open a new tab, then the admin's HTML, which may load pictures, fonts and code from other sites
 * (the Privacy Policy says so). It's shown only in AnnouncementView's sandboxed frame, which keeps it away from
 * QuizMatter and the teacher's login.
 */
export function sandboxedHtml(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base target="_blank">${SEALED_BOX_HELPER}</head><body style="margin:0">${html}</body></html>`;
}

/**
 * What to show on a page: the announcements that fit it, without parts this tab closed (key "<id>:modal" or
 * "<id>:bar"; a corner box closes as its modal), newest first. At most 2 bars. A modal or corner box waits until
 * `waited` (the tab's seconds on QuizMatter, AnnouncementsWatch) reaches its `modal_show_after`. Corner boxes wait
 * while a modal shows: under its backdrop the box can't be seen or hovered, so its "closes itself" timer would run out
 * unseen (and count as seen).
 */
export function pickForPage(
  list: MyAnnouncement[],
  group: PageGroup,
  closed: ReadonlySet<string>,
  waited: number,
): { modals: MyAnnouncement[]; bars: MyAnnouncement[]; boxes: MyAnnouncement[] } {
  const fits = list
    .filter((a) => a.pages.includes("all") || a.pages.includes(group))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const open = fits.filter((a) => a.show_modal && !closed.has(`${a.id}:modal`) && a.modal_show_after <= waited);
  const modals = open.filter((a) => a.modal_display === "center");
  return {
    modals,
    bars: fits.filter((a) => a.show_bar && !closed.has(`${a.id}:bar`)).slice(0, 2),
    boxes: modals.length > 0 ? [] : open.filter((a) => a.modal_display === "corner"),
  };
}

/** Whether a modal or corner box not closed in this tab still waits for the clock (on any page): the clock runs only then. */
export function isWaiting(list: MyAnnouncement[], closed: ReadonlySet<string>, waited: number): boolean {
  return list.some((a) => a.show_modal && !closed.has(`${a.id}:modal`) && a.modal_show_after > waited);
}

/**
 * When a part closed in this tab (key "<id>:modal" / "<id>:bar", closed at `closedAt[key]`, ms) comes back: N minutes
 * after it was closed for "Again every N minutes"; never (null) for the other repeats or without a closed time.
 */
export function reopenAt(list: MyAnnouncement[], key: string, closedAt: Record<string, number>): number | null {
  const announcement = list.find((a) => key.startsWith(`${a.id}:`));
  const closedTime = closedAt[key];
  if (announcement?.repeat !== "interval" || closedTime === undefined) return null;
  return closedTime + announcement.repeat_minutes * 60_000;
}

/** The parts closed in this tab that haven't come back yet at `now` (what pickForPage and isWaiting skip). */
export function stillClosed(
  list: MyAnnouncement[],
  closed: string[],
  closedAt: Record<string, number>,
  now: number,
): Set<string> {
  return new Set(
    closed.filter((key) => {
      const back = reopenAt(list, key, closedAt);
      return back === null || back > now;
    }),
  );
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
