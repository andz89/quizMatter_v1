import { z } from "zod";
import { PROVINCES } from "./provinces";
import type { EducationLevel } from "./userSettings";

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

/**
 * The modal's widths, in px. The height always fits the text. Large is the normal modal (Modal's max-w-2xl). The
 * admin form's text box takes the same width, so a picture's size there is its size for teachers.
 */
export const MODAL_SIZES = [
  { key: "small", label: "Small (300 wide)", width: 300 },
  { key: "medium", label: "Medium (500 wide)", width: 500 },
  { key: "large", label: "Large (672 wide, normal)", width: 672 },
] as const;
export type ModalSize = (typeof MODAL_SIZES)[number]["key"];
const MODAL_SIZE_KEYS = MODAL_SIZES.map((size) => size.key) as [ModalSize, ...ModalSize[]];

/**
 * A picture's "Full width" size: as wide as the widest modal, keeping its shape. A picture is never wider than its
 * modal (max-width 100%), so it fills every size, also after the size is changed.
 */
export function fullWidthSize(width: number, height: number): { width: number; height: number } {
  const full = MODAL_SIZES[MODAL_SIZES.length - 1].width;
  return { width: full, height: Math.round((height * full) / width) };
}

export const ANNOUNCEMENT_LIMITS = {
  name: 100,
  modalHtml: 20_000,
  barHtml: 1_000,
  closeAfter: 60,
  ageMin: 18,
  ageMax: 100,
  presentationsMax: 50,
  words: 20,
  wordLength: 60,
};
const L = ANNOUNCEMENT_LIMITS;

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
export const announcementSchema = z
  .object({
    id: z.uuid().nullable(),
    name: z.string().max(L.name).refine((n) => n.trim() !== "", "Give it a name."),
    is_on: z.boolean(),
    starts_at: time,
    ends_at: time,
    show_modal: z.boolean(),
    modal_html: z.string().max(L.modalHtml),
    modal_close_after: z.number().int().min(0).max(L.closeAfter),
    show_bar: z.boolean(),
    bar_html: z.string().max(L.barHtml),
    bar_close_after: z.number().int().min(0).max(L.closeAfter),
    repeat: z.enum(REPEATS),
    pages: z.array(z.enum(["all", ...PAGE_GROUPS.map((g) => g.key)])).min(1),
    genders: z.array(z.enum(["male", "female"])),
    age_min: age,
    age_max: age,
    provinces: z.array(z.enum(PROVINCES)),
    town_words: words,
    education_levels: z.array(z.enum(EDUCATION_LEVELS)),
    field_words: words,
    presentations_min: count,
    presentations_max: count,
    roles: z.array(z.enum(ANNOUNCEMENT_ROLES)),
    modal_size: z.enum(MODAL_SIZE_KEYS),
  })
  .refine((a) => a.show_modal || a.show_bar, { message: "Turn on the modal or the bar.", path: ["show_modal"] })
  .refine((a) => !a.show_modal || a.modal_html.trim() !== "", { message: "The modal needs text.", path: ["modal_html"] })
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

// One row of my_announcements(). A closed part comes back with show_* false and no text.
export const myAnnouncementSchema = z.object({
  id: z.string(),
  show_modal: z.boolean(),
  modal_html: z.string(),
  modal_close_after: z.number(),
  show_bar: z.boolean(),
  bar_html: z.string(),
  bar_close_after: z.number(),
  repeat: z.enum(REPEATS),
  pages: z.array(z.string()),
  created_at: z.string(),
  // Missing (a row from before sizes, e.g. kept in a tab) = large, the size modals had then.
  modal_size: z.enum(MODAL_SIZE_KEYS).catch("large"),
});
export type MyAnnouncement = z.infer<typeof myAnnouncementSchema>;

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
