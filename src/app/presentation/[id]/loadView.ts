// Server-only (it reads the login cookies).
import { getAccount } from "@/lib/account";
import { fetchPresentation } from "@/lib/fetchPresentation";
import { timeAgo } from "@/lib/format";
import { loadLessonExtras } from "@/lib/lessons";
import { DAYS, listOrder, type Presentation } from "@/lib/schema";
import { createClient } from "@/lib/supabase/server";
import type { Reviewer, ReviewStatus } from "@/lib/reviewStatus";
import { loadCardRows } from "../../(home)/cards";
import type { LessonWeekData } from "./LessonWeek";

/** Everything the presentation's page and its modal show (PresentationDetails), read for the logged-in user. */
export type PresentationViewData = {
  presentation: Presentation;
  isMine: boolean;
  // The owner and admins (who open it from Reports) see hidden slides too.
  showHidden: boolean;
  ownerId: string;
  profileSlugs: Record<string, string>;
  publisherName: string;
  isSaved: boolean;
  likeCount: number;
  isLiked: boolean;
  canLike: boolean;
  review: ReviewStatus;
  reviewers: Reviewer[];
  // My presentation sent to QuizMatter and waiting: when, e.g. "2 hr ago". null = not waiting.
  waitingSince: string | null;
  // null = not a live QuizMatter presentation an editor made.
  lessonWeek: LessonWeekData | null;
  // "View more by <name>": the lesson's editor, or the teacher who published it (only with a profile to open).
  maker: { name: string; slug: string } | null;
  // A live QuizMatter presentation: "More like this" can be loaded (loadMoreLikeThis).
  hasMoreLikeThis: boolean;
};

/**
 * The presentation for the page and the modal, or null when there's none this user may read (someone else's private
 * one looks like it doesn't exist). The week list comes with it; "More like this" is loaded only on its button.
 */
export async function loadPresentationView(id: string): Promise<PresentationViewData | null> {
  const [account, result] = await Promise.all([getAccount(), fetchPresentation(id)]);
  if (!result) return null;
  const { presentation } = result;
  const isLesson = presentation.fromAdmin && presentation.isPublished;
  const lessonWeek = isLesson ? await loadLessonWeek(id) : null;
  const publisherSlug = result.profileSlugs[result.ownerId];
  const maker = lessonWeek?.editorSlug
    ? { name: lessonWeek.editorName, slug: lessonWeek.editorSlug }
    : !presentation.fromAdmin && !result.isMine && result.publisherName && publisherSlug
      ? { name: result.publisherName, slug: publisherSlug }
      : null;
  return {
    presentation,
    isMine: result.isMine,
    showHidden: result.isMine || account.isAdmin,
    ownerId: result.ownerId,
    profileSlugs: result.profileSlugs,
    publisherName: result.publisherName,
    isSaved: result.isSaved,
    likeCount: result.likeCount,
    isLiked: result.isLiked,
    // Teachers and editors like other people's published presentations; admins only see the count.
    canLike: !result.isMine && presentation.isPublished && !account.isAdmin,
    review: result.review,
    reviewers: result.reviewers,
    waitingSince:
      result.isMine && result.submission?.status === "submitted" ? timeAgo(result.submission.submittedAt, Date.now()) : null,
    lessonWeek,
    maker,
    hasMoreLikeThis: isLesson,
  };
}

/** A live QuizMatter presentation's week list (only if an editor made it), Day 1 … Day 5 then by title. */
async function loadLessonWeek(id: string): Promise<LessonWeekData | null> {
  const supabase = await createClient();
  const { week } = await loadLessonExtras(supabase, id);
  if (!week) return null;
  const lessons = await loadCardRows(supabase, week.lessonIds);
  lessons.sort(
    (a, b) =>
      listOrder(DAYS, a.day) - listOrder(DAYS, b.day) || a.day.localeCompare(b.day) || a.title.localeCompare(b.title),
  );
  return { editorName: week.editorName, editorSlug: week.editorSlug, lessons };
}
