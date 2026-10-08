"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEditorStore, isPanelEscape } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { CANVAS_WIDTH, CANVAS_HEIGHT, SLIDE_DRAG_MIME, getSlideNumbers } from "@/lib/constants";
import { joinParts, publishedByLine, slideCountLabel } from "@/lib/format";
import { loadPublisherNames } from "@/lib/publishers";
import { MAX_SLIDES, TOO_MANY_SLIDES_MESSAGE, gradesLabel, gradesTitle, parseSlide, type Slide } from "@/lib/schema";
import { Spinner } from "@/components/Spinner";
import { FluidSlidePreview } from "@/components/presentation/FluidSlidePreview";
import { SaveCardButton } from "@/app/SaveCardButton";
import { ChevronLeftIcon, XIcon } from "lucide-react";

// How many published presentations the list shows (newest first). The Saved tab shows up to this many more.
const PRESENTATION_LIMIT = 50;
// Width of the slide picture that follows the pointer while dragging.
const DRAG_IMAGE_WIDTH = 180;

// Each presentation's first slide only (for its picture), not all of them, to keep the panel light.
const SUMMARY_COLUMNS = "id, owner_id, title, grades, subject, author, slides(count), first_slide:slides(data, position)";

type PresentationSummary = {
  id: string;
  ownerId: string;
  title: string;
  // By author, published by, grade, subject, slide count ("" parts left out). Searched too.
  meta: string;
  // Full grade names when the meta line shortens Kindergarten to "K" (shown as its tooltip).
  metaTitle?: string;
  firstSlide: Slide | null;
};

type Tab = "all" | "saved";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "saved", label: "Saved" },
];

// What the panel had loaded, kept after it closes so reopening it is instant (no new download) and
// comes back to the same presentation. Only for the presentation being edited; cleared on a full page reload.
let cache: {
  presentationId: string;
  presentations: PresentationSummary[];
  // The ones I saved that aren't in `presentations` (loaded when the Saved tab first opens; null before).
  savedExtras: PresentationSummary[] | null;
  savedIds: string[];
  myId: string;
  tab: Tab;
  openPresentation: PresentationSummary | null;
  slides: Slide[] | null;
} | null = null;

/**
 * Sidebar panel with the published presentations (mine too, except the one being edited), and a Saved tab with
 * the ones I saved (bookmarked). Clicking a presentation shows its slides; clicking a slide adds a copy right after
 * the active slide, dragging one onto the workspace adds it right after the slide it's dropped on. Stays open so
 * several can be added in a row. Other people's presentations have the bookmark button, to save or remove them.
 */
export function PresentationsPanel() {
  const closePresentationsPanel = useEditorStore((s) => s.closePresentationsPanel);
  const insertSlides = useEditorStore((s) => s.insertSlides);
  const isFull = useEditorStore((s) => s.presentation.slides.length >= MAX_SLIDES);
  const presentationId = useEditorStore((s) => s.presentation.id);

  const [cached] = useState(() => (cache?.presentationId === presentationId ? cache : null));
  // null while loading.
  const [presentations, setPresentations] = useState<PresentationSummary[] | null>(cached?.presentations ?? null);
  const [savedExtras, setSavedExtras] = useState<PresentationSummary[] | null>(cached?.savedExtras ?? null);
  // The presentations I saved, newest saved first.
  const [savedIds, setSavedIds] = useState<string[]>(cached?.savedIds ?? []);
  const [myId, setMyId] = useState(cached?.myId ?? "");
  const [tab, setTab] = useState<Tab>(cached?.tab ?? "all");
  const [search, setSearch] = useState("");
  const [openPresentation, setOpenPresentation] = useState<PresentationSummary | null>(cached?.openPresentation ?? null);
  // The open presentation's slides; null while loading.
  const [slides, setSlides] = useState<Slide[] | null>(cached?.slides ?? null);
  // Kept apart, so a failed presentation doesn't hide the list after going Back.
  const [listError, setListError] = useState(false);
  const [savedError, setSavedError] = useState(false);
  const [slidesError, setSlidesError] = useState(false);
  // The presentation whose slides were asked for last; an older, slower answer is ignored.
  const latestPresentationId = useRef<string | null>(null);
  // The slide being dragged, faded in the panel while it's dragged.
  const [draggingSlideId, setDraggingSlideId] = useState<string | null>(null);

  useEffect(() => {
    if (cache?.presentationId === presentationId) return;
    let cancelled = false;
    const supabase = createClient();
    Promise.all([
      publishedPresentations(supabase, presentationId).order("updated_at", { ascending: false }).limit(PRESENTATION_LIMIT),
      // The database only gives back my own saved rows.
      supabase.from("saved_presentations").select("presentation_id").order("saved_at", { ascending: false }),
      supabase.auth.getClaims(),
    ]).then(async ([list, saved, { data: claims }]) => {
      if (list.error || saved.error) {
        if (!cancelled) setListError(true);
        return;
      }
      const summaries = await toSummaries(supabase, list.data);
      if (cancelled) return;
      setSavedIds(saved.data.map((row) => row.presentation_id));
      setMyId(claims?.claims.sub ?? "");
      setPresentations(summaries);
    });
    return () => {
      cancelled = true;
    };
  }, [presentationId]);

  // A presentation whose slides were still loading isn't kept: that request stops when the panel closes.
  useEffect(() => {
    if (presentations) {
      cache = { presentationId, presentations, savedExtras, savedIds, myId, tab, openPresentation: slides ? openPresentation : null, slides };
    }
  }, [presentationId, presentations, savedExtras, savedIds, myId, tab, openPresentation, slides]);

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

  // The Saved tab's presentations that the list doesn't have are loaded the first time it shows (the newest saved,
  // up to PRESENTATION_LIMIT), once the list is in. Ones that were unpublished or hidden since don't come back, so
  // they're left out. An effect, not the tab's click, so a click before the list loaded, or reopening the panel
  // after a failed try, still loads them.
  useEffect(() => {
    if (tab !== "saved" || savedExtras || savedError || !presentations) return;
    const listIds = new Set(presentations.map((presentation) => presentation.id));
    const missingIds = savedIds.filter((id) => !listIds.has(id)).slice(0, PRESENTATION_LIMIT);
    let cancelled = false;
    const supabase = createClient();
    const load = async () => {
      if (missingIds.length === 0) return [];
      const { data, error } = await publishedPresentations(supabase, presentationId).in("id", missingIds);
      if (error) return null;
      return toSummaries(supabase, data);
    };
    load().then((summaries) => {
      if (cancelled) return;
      if (summaries) setSavedExtras(summaries);
      else setSavedError(true);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, savedExtras, savedError, presentations, savedIds, presentationId]);

  // After the bookmark saved or removed one.
  const changeSaved = (presentation: PresentationSummary, isSaved: boolean) => {
    setSavedIds((ids) => (isSaved ? [presentation.id, ...ids] : ids.filter((id) => id !== presentation.id)));
    // Saved again on the Saved tab: keep it at hand, even if it isn't in the list.
    if (isSaved) {
      setSavedExtras((extras) => (extras && !extras.some((extra) => extra.id === presentation.id) ? [...extras, presentation] : extras));
    }
  };

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

  // The Saved tab: newest saved first. undefined while loading.
  const byId = new Map([...(presentations ?? []), ...(savedExtras ?? [])].map((presentation) => [presentation.id, presentation]));
  const savedPresentations =
    presentations && savedExtras ? savedIds.map((id) => byId.get(id)).filter((presentation) => presentation !== undefined) : undefined;
  const savedIdSet = new Set(savedIds);

  const query = search.trim().toLowerCase();
  const shownPresentations = (tab === "saved" ? savedPresentations : presentations)?.filter((presentation) =>
    `${presentation.title} ${presentation.meta}`.toLowerCase().includes(query)
  );

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
              <ChevronLeftIcon size={16} />
            </button>
          )}
          <h2 className="truncate text-[15px] font-extrabold text-text-primary">{openPresentation ? openPresentation.title : "Presentations"}</h2>
        </div>
        <button
          type="button"
          onClick={closePresentationsPanel}
          title="Close (Esc)"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
        >
          <XIcon size={16} />
        </button>
      </div>
      <p className="mb-4 text-xs text-text-secondary">
        {openPresentation
          ? "Click a slide to add it after the active slide, or drag it onto a slide."
          : "Published presentations. Open one to add its slides to this presentation."}
      </p>

      {(openPresentation ? slidesError : listError || (tab === "saved" && savedError)) ? (
        <Message>Couldn&apos;t load. Please close the panel and try again.</Message>
      ) : openPresentation ? (
        slides === null ? (
          <Loading />
        ) : slides.length === 0 ? (
          <Message>This presentation has no slides.</Message>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Adding is refused at MAX_SLIDES (store.ts), so say so before the teacher tries. */}
            {isFull && (
              <p className="text-sm text-text-secondary">{TOO_MANY_SLIDES_MESSAGE} Delete some to add these.</p>
            )}
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
          <div className="mb-3 flex gap-1">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
                className={`rounded-dropdown px-2.5 py-1 text-[13px] font-semibold transition-colors ${
                  tab === id ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
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
            <Message>
              {query
                ? `No ${tab === "saved" ? "saved" : "published"} presentations match “${search.trim()}”.`
                : tab === "saved"
                  ? "Nothing saved yet. Click the bookmark on a presentation to save it."
                  : "No published presentations yet."}
            </Message>
          ) : (
            <div className="flex flex-col gap-4">
              {shownPresentations.map((presentation) => (
                // The bookmark sits next to the button, not in it (a button can't go inside a button).
                <div key={presentation.id} className="relative min-w-0">
                  <button type="button" onClick={() => showPresentation(presentation)} className="group w-full min-w-0 text-left">
                    <SlidePicture slide={presentation.firstSlide} />
                    <span className="mt-1.5 block truncate text-sm font-semibold text-text-primary">{presentation.title}</span>
                    <span title={presentation.metaTitle} className="block truncate text-[13px] text-text-secondary">{presentation.meta}</span>
                  </button>
                  {/* My own presentations can't be saved. */}
                  {presentation.ownerId !== myId && (
                    <SaveCardButton
                      presentationId={presentation.id}
                      title={presentation.title}
                      isSaved={savedIdSet.has(presentation.id)}
                      onChange={(isSaved) => changeSaved(presentation, isSaved)}
                      className="top-2 right-2"
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Published presentations (except the one being edited), each with its first slide only. */
function publishedPresentations(supabase: SupabaseClient, presentationId: string) {
  return (
    supabase
      .from("presentations")
      .select(SUMMARY_COLUMNS)
      .eq("is_published", true)
      // Already left out by the database, except for admins.
      .is("hidden_at", null)
      .neq("id", presentationId)
      .order("position", { referencedTable: "first_slide" })
      .limit(1, { referencedTable: "first_slide" })
  );
}

type SummaryRow = {
  id: string;
  owner_id: string;
  title: string;
  grades: string[];
  subject: string;
  author: string;
  slides: { count: number }[];
  first_slide: { data: unknown }[];
};

async function toSummaries(supabase: SupabaseClient, rows: SummaryRow[]): Promise<PresentationSummary[]> {
  const publisherNames = await loadPublisherNames(supabase, rows.map((row) => row.owner_id));
  return rows.map((row) => ({
    id: row.id,
    ownerId: row.owner_id,
    title: row.title || "Untitled presentation",
    meta: joinParts([
      publishedByLine(row.author, publisherNames.get(row.owner_id)),
      gradesLabel(row.grades),
      row.subject,
      slideCountLabel(row.slides[0]?.count ?? 0),
    ]),
    metaTitle: gradesTitle(row.grades),
    firstSlide: parseSlide(row.first_slide[0]?.data),
  }));
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
