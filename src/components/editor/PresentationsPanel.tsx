"use client";

import { useEffect, useRef, useState } from "react";
import { useEditorStore, isPanelEscape } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { CANVAS_WIDTH, CANVAS_HEIGHT, SLIDE_DRAG_MIME, getSlideNumbers } from "@/lib/constants";
import { joinParts, slideCountLabel } from "@/lib/format";
import { parseSlide, type Slide } from "@/lib/schema";
import { Spinner } from "@/components/Spinner";
import { CloseIcon } from "@/components/icons/CloseIcon";
import { BackIcon } from "@/components/icons/BackIcon";
import { FluidSlidePreview } from "@/components/presentation/FluidSlidePreview";

// How many published presentations the list shows (newest first).
const PRESENTATION_LIMIT = 50;
// Width of the slide picture that follows the pointer while dragging.
const DRAG_IMAGE_WIDTH = 180;

type PresentationSummary = {
  id: string;
  title: string;
  // By author, grade, subject, slide count ("" parts left out). Searched too.
  meta: string;
  firstSlide: Slide | null;
};

// What the panel had loaded, kept after it closes so reopening it is instant (no new download) and
// comes back to the same presentation. Only for the presentation being edited; cleared on a full page reload.
let cache: { presentationId: string; presentations: PresentationSummary[]; openPresentation: PresentationSummary | null; slides: Slide[] | null } | null = null;

/**
 * Sidebar panel with the published presentations (mine too, except the one being edited). Clicking a presentation
 * shows its slides; clicking a slide adds a copy right after the active slide, dragging one onto the
 * workspace adds it right after the slide it's dropped on. Stays open so several can be added in a row.
 */
export function PresentationsPanel() {
  const closePresentationsPanel = useEditorStore((s) => s.closePresentationsPanel);
  const insertSlides = useEditorStore((s) => s.insertSlides);
  const presentationId = useEditorStore((s) => s.presentation.id);

  const [cached] = useState(() => (cache?.presentationId === presentationId ? cache : null));
  // null while loading.
  const [presentations, setPresentations] = useState<PresentationSummary[] | null>(cached?.presentations ?? null);
  const [search, setSearch] = useState("");
  const [openPresentation, setOpenPresentation] = useState<PresentationSummary | null>(cached?.openPresentation ?? null);
  // The open presentation's slides; null while loading.
  const [slides, setSlides] = useState<Slide[] | null>(cached?.slides ?? null);
  // Kept apart, so a failed presentation doesn't hide the list after going Back.
  const [listError, setListError] = useState(false);
  const [slidesError, setSlidesError] = useState(false);
  // The presentation whose slides were asked for last; an older, slower answer is ignored.
  const latestPresentationId = useRef<string | null>(null);
  // The slide being dragged, faded in the panel while it's dragged.
  const [draggingSlideId, setDraggingSlideId] = useState<string | null>(null);

  useEffect(() => {
    if (cache?.presentationId === presentationId) return;
    let cancelled = false;
    createClient()
      .from("presentations")
      .select("id, title, grade, subject, author, slides(count), first_slide:slides(data, position)")
      .eq("is_published", true)
      .neq("id", presentationId)
      .order("updated_at", { ascending: false })
      .order("position", { referencedTable: "first_slide" })
      .limit(1, { referencedTable: "first_slide" })
      .limit(PRESENTATION_LIMIT)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) return setListError(true);
        setPresentations(
          data.map((presentation) => ({
            id: presentation.id,
            title: presentation.title || "Untitled presentation",
            meta: joinParts([
              presentation.author && `By ${presentation.author}`,
              presentation.grade,
              presentation.subject,
              slideCountLabel(presentation.slides[0]?.count ?? 0),
            ]),
            firstSlide: parseSlide(presentation.first_slide[0]?.data),
          })),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [presentationId]);

  // A presentation whose slides were still loading isn't kept: that request stops when the panel closes.
  useEffect(() => {
    if (presentations) cache = { presentationId, presentations, openPresentation: slides ? openPresentation : null, slides };
  }, [presentationId, presentations, openPresentation, slides]);

  // Escape steps back one level: out of a presentation first, then closes the panel.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPanelEscape(e)) return;
      if (openPresentation) setOpenPresentation(null);
      else closePresentationsPanel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openPresentation, closePresentationsPanel]);

  const showPresentation = async (presentation: PresentationSummary) => {
    setOpenPresentation(presentation);
    setSlides(null);
    setSlidesError(false);
    latestPresentationId.current = presentation.id;
    const { data, error } = await createClient()
      .from("slides")
      .select("data")
      .eq("presentation_id", presentation.id)
      .order("position");
    if (latestPresentationId.current !== presentation.id) return;
    if (error) return setSlidesError(true);
    // A slide in an old or broken shape is left out instead of breaking the panel.
    setSlides(data.map((row) => parseSlide(row.data)).filter((slide) => slide !== null));
  };

  const slideNumbers = getSlideNumbers(slides ?? []);

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
  const shownPresentations = presentations?.filter((presentation) => `${presentation.title} ${presentation.meta}`.toLowerCase().includes(query));

  return (
    <div
      data-keep-container-selection="true"
      {...panelDragHandlers}
      className="flex w-[440px] shrink-0 flex-col overflow-y-auto border-r border-border-default bg-bg-surface p-5"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          {openPresentation && (
            <button
              type="button"
              onClick={() => setOpenPresentation(null)}
              title="Back"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
            >
              <BackIcon />
            </button>
          )}
          <h2 className="truncate text-[15px] font-semibold text-text-primary">{openPresentation ? openPresentation.title : "Presentations"}</h2>
        </div>
        <button
          type="button"
          onClick={closePresentationsPanel}
          title="Close (Esc)"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
        >
          <CloseIcon />
        </button>
      </div>
      <p className="mb-4 text-xs text-text-secondary">
        {openPresentation
          ? "Click a slide to add it after the active slide, or drag it onto a slide."
          : "Published presentations. Open one to add its slides to this presentation."}
      </p>

      {(openPresentation ? slidesError : listError) ? (
        <Message>Couldn&apos;t load. Please close the panel and try again.</Message>
      ) : openPresentation ? (
        slides === null ? (
          <Loading />
        ) : slides.length === 0 ? (
          <Message>This presentation has no slides.</Message>
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
                <SlidePicture slide={slide} questionNumber={slideNumbers.get(slide.id)} />
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
            placeholder="Search presentations"
            aria-label="Search presentations"
            className="mb-4 w-full rounded-input border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary"
          />
          {shownPresentations === undefined ? (
            <Loading />
          ) : shownPresentations.length === 0 ? (
            <Message>{query ? `No published presentations match “${search.trim()}”.` : "No published presentations yet."}</Message>
          ) : (
            <div className="flex flex-col gap-4">
              {shownPresentations.map((presentation) => (
                <button key={presentation.id} type="button" onClick={() => showPresentation(presentation)} className="group min-w-0 text-left">
                  <SlidePicture slide={presentation.firstSlide} />
                  <span className="mt-1.5 block truncate text-sm font-semibold text-text-primary">{presentation.title}</span>
                  <span className="block truncate text-[13px] text-text-secondary">{presentation.meta}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** `questionNumber` missing = worked out as the presentation's first slide (for the presentation list). */
function SlidePicture({ slide, questionNumber }: { slide: Slide | null; questionNumber?: number }) {
  return (
    <div
      data-drag-image
      className="overflow-hidden rounded-dropdown border border-border-default bg-bg-surface transition-colors group-hover:border-text-secondary"
      style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
    >
      {slide ? (
        <FluidSlidePreview slide={slide} questionNumber={questionNumber ?? getSlideNumbers([slide]).get(slide.id)} />
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
