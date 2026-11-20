import { z } from "zod";
import { joinParts, slideCountLabel } from "@/lib/format";
import { getPublicPresentation } from "@/lib/publicPresentation";
import { gradesLabel } from "@/lib/schema";
import { OG_SIZE, ogCard } from "../../ogCard";

// A published presentation's link picture: the QuizMatter title card with its title, Author and details. Anything
// else (private, hidden, unknown, made up) is 404 without drawing anything, so a script asking for random ids costs
// almost nothing; private and unknown answer the same, so it never tells whether a presentation exists.
export const alt = "A presentation on QuizMatter";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const preview = z.uuid().safeParse(id).success ? await getPublicPresentation(id) : null;
  if (!preview) return new Response(null, { status: 404 });
  return ogCard({
    title: preview.title || "Untitled presentation",
    byline: preview.authorName ? `By ${preview.authorName}` : "",
    details: joinParts([preview.subject, gradesLabel(preview.grades), slideCountLabel(preview.slideCount)]),
  });
}
