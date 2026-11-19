import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { LinkPending } from "@/components/LinkPending";
import { LoggedOutBar } from "@/components/LoggedOutBar";
import { NavBar, navLinkClass } from "@/components/NavBar";
import { getAccount } from "@/lib/account";
import { fetchPresentation } from "@/lib/fetchPresentation";
import { timeAgo } from "@/lib/format";
import { loadLessonExtras } from "@/lib/lessons";
import { getPublicPresentation, publicDescription } from "@/lib/publicPresentation";
import { DAYS, listOrder } from "@/lib/schema";
import { createClient } from "@/lib/supabase/server";
import { usesPeopleArt } from "@/lib/peopleArt";
import { PeopleArtGate } from "@/components/PeopleArtGate";
import { loadCardRows, toSavableCards } from "../../(home)/cards";
import type { PresentationCardData } from "../../PresentationCard";
import type { LessonWeekData } from "./LessonWeek";
import { PresentationPreview } from "./PresentationPreview";
import { PublicPresentation } from "./PublicPresentation";

/**
 * The tags search engines and link previews read (the picture comes from opengraph-image.tsx next to this page).
 * Only a published presentation gets its own; anything else is "QuizMatter" and kept out of search results.
 */
export async function generateMetadata({ params }: PageProps<"/presentation/[id]">): Promise<Metadata> {
  const { id } = await params;
  const preview = z.uuid().safeParse(id).success ? await getPublicPresentation(id) : null;
  if (!preview) return { title: "QuizMatter", robots: { index: false } };
  const title = preview.title || "Untitled presentation";
  const description = publicDescription(preview);
  return {
    title: `${title} · QuizMatter`,
    description,
    openGraph: { type: "article", title, description },
    alternates: { canonical: `/presentation/${id}` },
  };
}

/** A presentation to look at, not edit: mostly other teachers' published presentations (opened from the home page). */
export default async function PresentationPage({ params }: PageProps<"/presentation/[id]">) {
  const { id } = await params;
  // A broken link (not an id) would make the database fail; it's simply not found.
  if (!z.uuid().safeParse(id).success) notFound();
  const account = await getAccount();
  // Logged out (a visitor or a robot): a published one's public preview, else login, exactly as before.
  if (!account.id) {
    const preview = await getPublicPresentation(id);
    if (!preview) redirect(`/login?next=${encodeURIComponent(`/presentation/${id}`)}`);
    return (
      <>
        <LoggedOutBar />
        <PublicPresentation presentation={preview} />
      </>
    );
  }
  const result = await fetchPresentation(id);
  // Someone else's private presentation is hidden by the database, so it looks like it doesn't exist.
  if (!result) notFound();
  const { presentation } = result;
  const { lessonWeek, suggestions } =
    presentation.fromAdmin && presentation.isPublished ? await loadLessons(id) : { lessonWeek: null, suggestions: [] };

  return (
    <>
      <NavBar>
        <Link href="/" className={navLinkClass}>
          Home
          <LinkPending />
        </Link>
      </NavBar>
      <PeopleArtGate needed={usesPeopleArt(result.presentation.slides)}>
        <PresentationPreview
          presentation={result.presentation}
          isMine={result.isMine}
          // Admins open this page from Reports, so they see hidden slides too (a reported one may hide something).
          showHidden={result.isMine || account.isAdmin}
          ownerId={result.ownerId}
          profileSlugs={result.profileSlugs}
          publisherName={result.publisherName}
          isSaved={result.isSaved}
          likeCount={result.likeCount}
          isLiked={result.isLiked}
          // Teachers and editors like other people's published presentations; admins only see the count.
          canLike={!result.isMine && presentation.isPublished && !account.isAdmin}
          review={result.review}
          reviewers={result.reviewers}
          waitingSince={result.isMine ? waitingSince(result.submission) : null}
          lessonWeek={lessonWeek}
          suggestions={suggestions}
        />
      </PeopleArtGate>
    </>
  );
}

/**
 * A live QuizMatter presentation's week list (only if an editor made it) and its suggestions, in one lookup, then all
 * their cards in one read (see the lesson_extras migration). Left out if the lookup fails.
 */
async function loadLessons(id: string): Promise<{ lessonWeek: LessonWeekData | null; suggestions: PresentationCardData[] }> {
  const supabase = await createClient();
  const { week, suggestionIds } = await loadLessonExtras(supabase, id);
  const weekIds = week?.lessonIds ?? [];
  const rows = await loadCardRows(supabase, [...weekIds, ...suggestionIds]);
  const lessons = rows.filter((row) => weekIds.includes(row.id));
  // Day 1 … Day 5 (a day of the teacher's own after them), then by title.
  lessons.sort(
    (a, b) =>
      listOrder(DAYS, a.day) - listOrder(DAYS, b.day) || a.day.localeCompare(b.day) || a.title.localeCompare(b.title),
  );
  return {
    lessonWeek: week && { editorName: week.editorName, editorSlug: week.editorSlug, lessons },
    suggestions: await toSavableCards(
      supabase,
      rows.filter((row) => !weekIds.includes(row.id)),
    ),
  };
}

/** When my presentation was sent to QuizMatter, e.g. "2 hr ago", while it waits. null = not waiting. */
function waitingSince(submission: { status: string; submittedAt: number } | null): string | null {
  return submission?.status === "submitted" ? timeAgo(submission.submittedAt, Date.now()) : null;
}
