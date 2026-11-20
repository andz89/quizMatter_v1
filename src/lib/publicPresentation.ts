import { cache } from "react";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { slideCountLabel } from "@/lib/format";
import { parseSlide, type Slide } from "@/lib/schema";

/**
 * A published presentation's public preview: what a logged-out visitor (or a robot: Google, Facebook's link reader)
 * may see on its page and in its link picture. From the `public_presentation` database function
 * (20261231002200_public_presentation.sql): only published, not hidden ones; anything else is null.
 * `slideCount` and `firstSlide` follow `shownSlides` (hidden slides are left out, unless every one is hidden).
 */
export type PublicPresentation = {
  id: string;
  title: string;
  description: string;
  subject: string;
  grades: string[];
  fromAdmin: boolean;
  authorName: string;
  slideCount: number;
  firstSlide: Slide | null;
};

type Row = Database["public"]["Functions"]["public_presentation"]["Returns"][number];

/** The database row in the app's shape, or null for none. A first slide in a broken shape becomes no slide. */
export function toPublicPresentation(id: string, row: unknown): PublicPresentation | null {
  if (!row) return null;
  const r = row as Row;
  return {
    id,
    title: r.title,
    description: r.description,
    subject: r.subject,
    grades: r.grades,
    fromAdmin: r.from_admin,
    authorName: r.author_name,
    slideCount: r.slide_count,
    firstSlide: r.first_slide ? parseSlide(r.first_slide) : null,
  };
}

const DESCRIPTION_MAX = 160;

/** The page's description for search results and link previews: its own (cut to 160 characters), else a line about it. */
export function publicDescription(p: PublicPresentation): string {
  const own = p.description.trim().replace(/\s+/g, " ");
  if (own) return own.length <= DESCRIPTION_MAX ? own : `${own.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…`;
  const by = p.authorName ? ` by ${p.authorName}` : "";
  return `${p.title}${by} on QuizMatter: ${slideCountLabel(p.slideCount)}.`;
}

/**
 * A newest QuizMatter lesson for the public home page (`public_lessons`, 20261231002400_public_lessons.sql): no name,
 * the first shown slide without its answer.
 */
export type PublicLesson = {
  id: string;
  title: string;
  subject: string;
  grades: string[];
  updatedAt: number;
  firstSlide: Slide | null;
};

type LessonRow = Database["public"]["Functions"]["public_lessons"]["Returns"][number];

/** The database rows as cards. A first slide in a broken shape becomes no slide. */
export function toPublicLessons(rows: unknown): PublicLesson[] {
  return ((rows ?? []) as LessonRow[]).map((r) => ({
    id: r.id,
    title: r.title,
    subject: r.subject,
    grades: r.grades,
    updatedAt: Date.parse(r.updated_at),
    firstSlide: r.first_slide ? parseSlide(r.first_slide) : null,
  }));
}

/**
 * The same for everyone (no login cookies: a plain client with the public anon key), so every visitor and robot
 * sees what a logged-out one does. Server only.
 */
function anonClient() {
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Reads the preview, so the page, its metadata and its picture agree. Remembered for one request (React's `cache`). */
export const getPublicPresentation = cache(async (id: string): Promise<PublicPresentation | null> => {
  const { data, error } = await anonClient().rpc("public_presentation", { p_id: id });
  if (error) throw error;
  return toPublicPresentation(id, data?.[0]);
});

/** The newest QuizMatter lessons (1–50) for the public home page. */
export async function getPublicLessons(limit: number): Promise<PublicLesson[]> {
  const { data, error } = await anonClient().rpc("public_lessons", { p_limit: limit });
  if (error) throw error;
  return toPublicLessons(data);
}

// A request gives 1,000 rows at most, and a sitemap holds 50,000 addresses at most.
const SITEMAP_PAGE = 1000;
const SITEMAP_MAX = 50_000;

/** Every QuizMatter lesson's id and last change, newest first, for sitemap.xml (read 1,000 at a time). */
export async function getPublicLessonIds(): Promise<{ id: string; updatedAt: number }[]> {
  const supabase = anonClient();
  const all: { id: string; updatedAt: number }[] = [];
  while (all.length < SITEMAP_MAX) {
    const { data, error } = await supabase.rpc("public_lesson_ids").range(all.length, all.length + SITEMAP_PAGE - 1);
    if (error) throw error;
    all.push(...data.map((row) => ({ id: row.id, updatedAt: Date.parse(row.updated_at) })));
    if (data.length < SITEMAP_PAGE) break;
  }
  return all.slice(0, SITEMAP_MAX);
}
