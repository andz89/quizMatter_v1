"use client";

import { useEffect, useRef, useState } from "react";
import { useEditorStore, isPanelEscape } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { CANVAS_WIDTH, CANVAS_HEIGHT, SLIDE_DRAG_MIME } from "@/lib/constants";
import { joinParts, slideCountLabel } from "@/lib/format";
import { parseSlide, type Slide } from "@/lib/schema";
import { Spinner } from "@/components/Spinner";
import { CloseIcon } from "@/components/icons/CloseIcon";
import { BackIcon } from "@/components/icons/BackIcon";
import { FluidSlidePreview } from "@/components/presentation/FluidSlidePreview";

// How many published lessons the list shows (newest first).
const LESSON_LIMIT = 50;
// Width of the slide picture that follows the pointer while dragging.
const DRAG_IMAGE_WIDTH = 180;

type LessonSummary = {
  id: string;
  title: string;
  // By author, grade, subject, slide count ("" parts left out). Searched too.
  meta: string;
  firstSlide: Slide | null;
};

// What the panel had loaded, kept after it closes so reopening it is instant (no new download) and
// comes back to the same lesson. Only for the lesson being edited; cleared on a full page reload.
let cache: { quizId: string; lessons: LessonSummary[]; openLesson: LessonSummary | null; slides: Slide[] | null } | null = null;

/**
 * Sidebar panel with the published lessons (mine too, except the one being edited). Clicking a lesson
 * shows its slides; clicking a slide adds a copy right after the active slide, dragging one onto the
 * workspace adds it right after the slide it's dropped on. Stays open so several can be added in a row.
 */
export function LessonsPanel() {
  const closeLessonsPanel = useEditorStore((s) => s.closeLessonsPanel);
  const insertSlides = useEditorStore((s) => s.insertSlides);
  const quizId = useEditorStore((s) => s.quiz.id);

  const [cached] = useState(() => (cache?.quizId === quizId ? cache : null));
  // null while loading.
  const [lessons, setLessons] = useState<LessonSummary[] | null>(cached?.lessons ?? null);
  const [search, setSearch] = useState("");
  const [openLesson, setOpenLesson] = useState<LessonSummary | null>(cached?.openLesson ?? null);
  // The open lesson's slides; null while loading.
  const [slides, setSlides] = useState<Slide[] | null>(cached?.slides ?? null);
  // Kept apart, so a failed lesson doesn't hide the list after going Back.
  const [listError, setListError] = useState(false);
  const [slidesError, setSlidesError] = useState(false);
  // The lesson whose slides were asked for last; an older, slower answer is ignored.
  const latestLessonId = useRef<string | null>(null);
  // The slide being dragged, faded in the panel while it's dragged.
  const [draggingSlideId, setDraggingSlideId] = useState<string | null>(null);

  useEffect(() => {
    if (cache?.quizId === quizId) return;
    let cancelled = false;
    createClient()
      .from("quizzes")
      .select("id, title, grade, subject, author, slides(count), first_slide:slides(data, position)")
      .eq("is_published", true)
      .neq("id", quizId)
      .order("updated_at", { ascending: false })
      .order("position", { referencedTable: "first_slide" })
      .limit(1, { referencedTable: "first_slide" })
      .limit(LESSON_LIMIT)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) return setListError(true);
        setLessons(
          data.map((quiz) => ({
            id: quiz.id,
            title: quiz.title || "Untitled lesson",
            meta: joinParts([
              quiz.author && `By ${quiz.author}`,
              quiz.grade,
              quiz.subject,
              slideCountLabel(quiz.slides[0]?.count ?? 0),
            ]),
            firstSlide: parseSlide(quiz.first_slide[0]?.data),
          })),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [quizId]);

  // A lesson whose slides were still loading isn't kept: that request stops when the panel closes.
  useEffect(() => {
    if (lessons) cache = { quizId, lessons, openLesson: slides ? openLesson : null, slides };
  }, [quizId, lessons, openLesson, slides]);

  // Escape steps back one level: out of a lesson first, then closes the panel.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPanelEscape(e)) return;
      if (openLesson) setOpenLesson(null);
      else closeLessonsPanel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openLesson, closeLessonsPanel]);

  const showLesson = async (lesson: LessonSummary) => {
    setOpenLesson(lesson);
    setSlides(null);
    setSlidesError(false);
    latestLessonId.current = lesson.id;
    const { data, error } = await createClient()
      .from("slides")
      .select("data")
      .eq("quiz_id", lesson.id)
      .order("position");
    if (latestLessonId.current !== lesson.id) return;
    if (error) return setSlidesError(true);
    // A slide in an old or broken shape is left out instead of breaking the panel.
    setSlides(data.map((row) => parseSlide(row.data)).filter((slide) => slide !== null));
  };

  // Right after the active slide (at the end if none is active).
  const addSlide = (slide: Slide) => {
    const selectedSlideId = useEditorStore.getState().selectedSlideId;
    insertSlides([slide], selectedSlideId ? { slideId: selectedSlideId } : undefined);
  };

  const handleDragStart = (e: React.DragEvent, slide: Slide) => {
    e.dataTransfer.setData(SLIDE_DRAG_MIME, JSON.stringify(slide));
    e.dataTransfer.effectAllowed = "copy";
    setDraggingSlideId(slide.id);

    // The browser's own snapshot of the big card comes out faded or empty, so drag a small copy of the
    // picture instead: placed off-screen, shrunk with CSS zoom, then removed.
    const picture = e.currentTarget.querySelector<HTMLElement>("[data-drag-image]");
    if (!picture) return;
    const rect = picture.getBoundingClientRect();
    const scale = DRAG_IMAGE_WIDTH / rect.width;
    const copy = picture.cloneNode(true) as HTMLElement;
    // The height is set too: replacing the inline style drops the picture's aspect-ratio.
    copy.style.cssText = `position:fixed;top:-1000px;left:0;width:${rect.width}px;height:${rect.height}px;zoom:${scale}`;
    document.body.appendChild(copy);
    // Keep the pointer at the same spot on the picture it was grabbed from.
    e.dataTransfer.setDragImage(copy, (e.clientX - rect.left) * scale, (e.clientY - rect.top) * scale);
    setTimeout(() => copy.remove());
  };

  // The panel accepts slide drags too (dropping here adds nothing), so the pointer doesn't show
  // "not allowed" while it crosses the panel on its way to the workspace.
  const panelDragHandlers = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(SLIDE_DRAG_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDrop: (e: React.DragEvent) => e.preventDefault(),
  };

  const query = search.trim().toLowerCase();
  const shownLessons = lessons?.filter((lesson) => `${lesson.title} ${lesson.meta}`.toLowerCase().includes(query));

  return (
    <div
      data-keep-container-selection="true"
      {...panelDragHandlers}
      className="flex w-[440px] shrink-0 flex-col overflow-y-auto border-r border-border-default bg-bg-surface p-5"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          {openLesson && (
            <button
              type="button"
              onClick={() => setOpenLesson(null)}
              title="Back"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
            >
              <BackIcon />
            </button>
          )}
          <h2 className="truncate text-[15px] font-semibold text-text-primary">{openLesson ? openLesson.title : "Lessons"}</h2>
        </div>
        <button
          type="button"
          onClick={closeLessonsPanel}
          title="Close (Esc)"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
        >
          <CloseIcon />
        </button>
      </div>
      <p className="mb-4 text-xs text-text-secondary">
        {openLesson
          ? "Click a slide to add it after the active slide, or drag it onto a slide."
          : "Published lessons. Open one to add its slides to this lesson."}
      </p>

      {(openLesson ? slidesError : listError) ? (
        <Message>Couldn&apos;t load. Please close the panel and try again.</Message>
      ) : openLesson ? (
        slides === null ? (
          <Loading />
        ) : slides.length === 0 ? (
          <Message>This lesson has no slides.</Message>
        ) : (
          <div className="flex flex-col gap-4">
            {slides.map((slide, index) => (
              <button
                key={slide.id}
                type="button"
                draggable
                onDragStart={(e) => handleDragStart(e, slide)}
                onDragEnd={() => setDraggingSlideId(null)}
                onClick={() => addSlide(slide)}
                title="Click to add after the active slide, or drag onto a slide"
                className={`group cursor-grab text-left transition-opacity active:cursor-grabbing ${
                  draggingSlideId === slide.id ? "opacity-40" : ""
                }`}
              >
                <SlidePicture slide={slide} />
                <span className="mt-1 block text-[13px] text-text-secondary">{index + 1}</span>
              </button>
            ))}
          </div>
        )
      ) : (
        <>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search lessons"
            aria-label="Search lessons"
            className="mb-4 w-full rounded-input border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary"
          />
          {shownLessons === undefined ? (
            <Loading />
          ) : shownLessons.length === 0 ? (
            <Message>{query ? `No published lessons match “${search.trim()}”.` : "No published lessons yet."}</Message>
          ) : (
            <div className="flex flex-col gap-4">
              {shownLessons.map((lesson) => (
                <button key={lesson.id} type="button" onClick={() => showLesson(lesson)} className="group min-w-0 text-left">
                  <SlidePicture slide={lesson.firstSlide} />
                  <span className="mt-1.5 block truncate text-sm font-semibold text-text-primary">{lesson.title}</span>
                  <span className="block truncate text-[13px] text-text-secondary">{lesson.meta}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SlidePicture({ slide }: { slide: Slide | null }) {
  return (
    <div
      data-drag-image
      className="overflow-hidden rounded-dropdown border border-border-default bg-bg-surface transition-colors group-hover:border-text-secondary"
      style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
    >
      {slide ? (
        <FluidSlidePreview slide={slide} />
      ) : (
        <div className="flex h-full items-center justify-center bg-bg-page text-[13px] text-text-secondary">No preview</div>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="flex justify-center py-10">
      <Spinner />
    </div>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-text-secondary">{children}</p>;
}
