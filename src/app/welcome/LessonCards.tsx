import Link from "next/link";
import { LinkPending } from "@/components/LinkPending";
import { FluidSlidePreview } from "@/components/presentation/FluidSlidePreview";
import { CANVAS_HEIGHT, CANVAS_WIDTH, getSlideNumbers } from "@/lib/constants";
import { joinParts } from "@/lib/format";
import type { PublicLesson } from "@/lib/publicPresentation";
import { gradesLabel } from "@/lib/schema";

/**
 * The public home page's newest QuizMatter lessons: each card is a link to the lesson's public preview. Only what a
 * logged-out visitor may see (no bookmark, like or menu), and a video slide without YouTube's cover picture.
 */
export function LessonCards({ lessons }: { lessons: PublicLesson[] }) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {lessons.map((lesson) => (
        <li key={lesson.id}>
          <Link
            href={`/presentation/${lesson.id}`}
            className="flex h-full flex-col gap-3 rounded-card border border-border-default bg-bg-surface p-3 transition-colors hover:border-accent"
          >
            <div
              className="relative overflow-hidden rounded-dropdown border border-border-default"
              style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
            >
              {lesson.firstSlide ? (
                <FluidSlidePreview
                  slide={lesson.firstSlide}
                  questionNumber={getSlideNumbers([lesson.firstSlide]).get(lesson.firstSlide.id)}
                  showVideoCover={false}
                />
              ) : (
                <div className="flex h-full items-center justify-center bg-bg-page text-[13px] text-text-secondary">No slides yet</div>
              )}
            </div>
            <div className="px-1 pb-1">
              <p className="text-sm font-semibold text-text-primary">{lesson.title || "Untitled presentation"}</p>
              <p className="mt-0.5 text-[13px] text-text-secondary">{joinParts([lesson.subject, gradesLabel(lesson.grades)])}</p>
            </div>
            <LinkPending />
          </Link>
        </li>
      ))}
    </ul>
  );
}
