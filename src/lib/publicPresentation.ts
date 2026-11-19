import { cache } from "react";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
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
  return `${p.title}${by} on QuizMatter: ${slidesWords(p.slideCount)}.`;
}

/** "1 slide", "3 slides". */
export function slidesWords(count: number): string {
  return `${count} ${count === 1 ? "slide" : "slides"}`;
}

/**
 * Reads the preview, the same for everyone (no login cookies: a plain client with the public anon key), so the
 * page, its metadata and its picture agree. Remembered for one request (React's `cache`). Server only.
 */
export const getPublicPresentation = cache(async (id: string): Promise<PublicPresentation | null> => {
  const supabase = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("public_presentation", { p_id: id });
  if (error) throw error;
  return toPublicPresentation(id, data?.[0]);
});
