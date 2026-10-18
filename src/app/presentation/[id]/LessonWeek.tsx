import Link from "next/link";
import { UserIcon } from "lucide-react";
import { CANVAS_WIDTH, CANVAS_HEIGHT, getSlideNumbers } from "@/lib/constants";
import { profileHref } from "@/lib/profiles";
import { parseSlide } from "@/lib/schema";
import { LinkPending } from "@/components/LinkPending";
import { FluidSlidePreview } from "@/components/presentation/FluidSlidePreview";
import type { CardPresentation } from "../../(home)/cards";

/** The editor's lessons for one week (sorted, the viewed one included), and who made them (see the lesson_week migration). */
export type LessonWeekData = { editorName: string; editorSlug: string; lessons: CardPresentation[] };

/**
 * "This week's lessons by <editor>": every lesson of the week (all versions), the one I'm on marked, then a link to
 * the editor's profile. Only the link shows when there's no other lesson that week.
 */
export function LessonWeek({ week, currentId }: { week: LessonWeekData; currentId: string }) {
  const hasList = week.lessons.length > 1;
  if (!hasList && !week.editorSlug) return null;
  return (
    <section className="mb-6 rounded-card border border-border-default bg-bg-surface px-5 py-4 text-sm">
      {hasList && (
        <>
          <h2 className="font-sans text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">
            This week&apos;s lessons by {week.editorName}
          </h2>
          <ul className="mt-2 flex flex-col">
            {week.lessons.map((lesson) => {
              const row = <LessonRow lesson={lesson} isCurrent={lesson.id === currentId} />;
              return (
                <li key={lesson.id} className="border-t border-border-default first:border-t-0">
                  {lesson.id === currentId ? (
                    row
                  ) : (
                    <Link href={`/presentation/${lesson.id}`} className="group block">
                      {row}
                      <LinkPending />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {week.editorSlug && (
        <Link
          href={profileHref(week.editorSlug)}
          className={`${hasList ? "mt-3" : ""} inline-flex items-center gap-2 rounded-button border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:border-text-secondary`}
        >
          <UserIcon size={16} />
          See all {week.editorName}&apos;s presentations
          <LinkPending />
        </Link>
      )}
    </section>
  );
}

function LessonRow({ lesson, isCurrent }: { lesson: CardPresentation; isCurrent: boolean }) {
  const slide = parseSlide(lesson.first_slide[0]?.data);
  return (
    <div className="flex items-center gap-3 py-2">
      <div
        className="w-16 shrink-0 overflow-hidden rounded-dropdown border border-border-default bg-bg-page"
        style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
      >
        {slide && <FluidSlidePreview slide={slide} questionNumber={getSlideNumbers([slide]).get(slide.id)} />}
      </div>
      <p
        className={`min-w-0 flex-1 truncate font-semibold ${
          isCurrent ? "text-text-primary" : "text-text-primary group-hover:text-accent"
        }`}
      >
        {lesson.title || "Untitled presentation"}
      </p>
      {isCurrent && <span className="text-[13px] text-text-secondary">You&apos;re here</span>}
      {lesson.day && (
        <span className="rounded-dropdown bg-accent-soft px-2 py-0.5 text-[13px] font-semibold whitespace-nowrap text-accent">
          {lesson.day}
        </span>
      )}
    </div>
  );
}
