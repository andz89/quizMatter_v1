import type { MetadataRoute } from "next";
import { getPublicLessonIds } from "@/lib/publicPresentation";

// /sitemap.xml: the pages logged-out visitors may open, and every QuizMatter lesson's public preview
// (docs/superpowers/specs/2026-11-20-public-home-and-seo-design.md). Teachers' own shared presentations are public
// to anyone with their link, but never listed here: QuizMatter doesn't advertise a teacher's work to search engines.
// Made on each request (the lessons change), from public_lesson_ids, 1,000 at a time, 50,000 at most.
export const dynamic = "force-dynamic";

const SITE = "https://quizmatter.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lessons = await getPublicLessonIds();
  return [
    { url: `${SITE}/`, changeFrequency: "daily", priority: 1 },
    ...["/signup", "/login", "/privacy", "/terms"].map((path) => ({ url: `${SITE}${path}`, priority: 0.5 })),
    ...lessons.map((lesson) => ({
      url: `${SITE}/presentation/${lesson.id}`,
      lastModified: new Date(lesson.updatedAt),
      priority: 0.8,
    })),
  ];
}
