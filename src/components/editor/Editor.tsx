"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useEditorStore, type EditorReview } from "@/lib/store";
import { buildSlides } from "@/lib/importPresentation";
import { useEditorShortcuts } from "@/lib/useEditorShortcuts";
import { EditorTopBar } from "./EditorTopBar";
import { IconRail } from "./IconRail";
import { Workspace } from "./Workspace";
import { ElementsPanel } from "./ElementsPanel";
import { PhotosPanel } from "./PhotosPanel";
import { ColorPanel } from "./ColorPanel";
import { BackgroundPanel } from "./BackgroundPanel";
import { EffectsPanel } from "./EffectsPanel";
import { DetailsPanel } from "./DetailsPanel";
import { PresentationsPanel } from "./PresentationsPanel";
import { SmallScreenNote } from "./SmallScreenNote";
import { ReviewBanner } from "./ReviewControls";
import { Spinner } from "@/components/Spinner";
import type { Presentation } from "@/lib/schema";

// Only downloaded the first time they're opened, so the editor itself loads faster. While one
// downloads, a dimmed screen with the spinner shows over the editor. Without `loading`, the whole
// page blanks to white for that moment.
const LoadingOverlay = () => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
    <Spinner />
  </div>
);
const SlideGridModal = dynamic(() => import("./SlideGridModal").then((mod) => mod.SlideGridModal), {
  loading: LoadingOverlay,
});
const PresentationView = dynamic(
  () => import("@/components/presentation/PresentationView").then((mod) => mod.PresentationView),
  { loading: LoadingOverlay }
);

/**
 * `draft` is the slides recipe of a presentation Claude sent through the MCP server (see /presentation/new): its
 * slides replace the new presentation's sample slide, unsaved, like the Paste button does.
 * `review` opens an editor's review of someone else's QuizMatter presentation: saves go to their draft (see the
 * presentation_reviews migration).
 */
export function Editor({ presentation, draft, review }: { presentation: Presentation; draft?: unknown; review?: EditorReview }) {
  // Until the presentation below is in the store, the store still holds the placeholder (or the last presentation opened).
  const isLoaded = useEditorStore((s) => s.presentation.id === presentation.id);
  const hasUnsavedChanges = useEditorStore((s) => s.presentation !== s.savedPresentation);
  const isPresenting = useEditorStore((s) => s.isPresenting);
  const isGridViewOpen = useEditorStore((s) => s.isGridViewOpen);
  const isElementsPanelOpen = useEditorStore((s) => s.isElementsPanelOpen);
  const isPhotosPanelOpen = useEditorStore((s) => s.isPhotosPanelOpen);
  const isColorPanelOpen = useEditorStore((s) => s.isColorPanelOpen);
  const isBackgroundPanelOpen = useEditorStore((s) => s.isBackgroundPanelOpen);
  const isEffectsPanelOpen = useEditorStore((s) => s.isEffectsPanelOpen);
  const isDetailsPanelOpen = useEditorStore((s) => s.isDetailsPanelOpen);
  const isPresentationsPanelOpen = useEditorStore((s) => s.isPresentationsPanelOpen);
  const closeColorPanel = useEditorStore((s) => s.closeColorPanel);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const clearElementSelection = useEditorStore((s) => s.clearElementSelection);
  const selectedContainerId = useEditorStore((s) => s.selectedContainerId);
  const selectContainer = useEditorStore((s) => s.selectContainer);

  useEditorShortcuts();

  useEffect(() => {
    const store = useEditorStore.getState();
    store.loadPresentation(presentation);
    useEditorStore.setState({ review: review ?? null });
    if (draft === undefined) return;

    // Show the presentation's own address instead of /presentation/new?draft=…, so a reload after saving opens the
    // saved presentation instead of another new copy.
    window.history.replaceState(null, "", `/presentation/${presentation.id}/edit`);
    const result = buildSlides(draft);
    if ("errors" in result) alert(`Couldn't load the slides from Claude:\n\n${result.errors.join("\n")}`);
    else store.importSlides(result.slides);
    // Not in the database yet: its first save sends every slide, and fails if another tab saved it first.
    useEditorStore.setState({ fromDraft: true, savedAt: null });
    // A new presentation/draft/review object from the server (e.g. after router.refresh()) loads it again and
    // drops unsaved edits, so don't refresh the editor page while someone is editing.
  }, [presentation, draft, review]);

  // Closing or reloading the tab with unsaved changes makes the browser ask "Leave page?" first.
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // A file dropped outside the slide's drop spots would make the browser open it, leaving the editor.
  useEffect(() => {
    const ignoreFileDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", ignoreFileDrop);
    window.addEventListener("drop", ignoreFileDrop);
    return () => {
      window.removeEventListener("dragover", ignoreFileDrop);
      window.removeEventListener("drop", ignoreFileDrop);
    };
  }, []);

  // Clicking anywhere except a selected SVG element/toolbar or a selected container deselects them.
  useEffect(() => {
    if (selectedElementIds.length === 0 && selectedContainerId === null) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-svg-element], [data-element-toolbar], [data-container-id], [data-keep-container-selection]'))
        return;
      clearElementSelection();
      selectContainer(null);
      closeColorPanel();
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [selectedElementIds, selectedContainerId, clearElementSelection, selectContainer, closeColorPanel]);

  if (!isLoaded) return null;

  return (
    <div className="flex h-screen flex-col">
      <EditorTopBar />
      <ReviewBanner />
      <div className="relative flex flex-1 overflow-hidden">
        <IconRail />
        {/* On laptops and bigger, an open panel sits beside the slides. On smaller screens it opens over them
            (next to the icon rail) and is kept narrower than the screen, so the slide isn't squeezed. */}
        <div className="absolute inset-y-0 left-24 z-30 flex max-w-[calc(100%-6rem)] max-lg:[&>*]:max-w-full lg:static lg:max-w-none">
          {isElementsPanelOpen && <ElementsPanel />}
          {isPhotosPanelOpen && <PhotosPanel />}
          {isColorPanelOpen && <ColorPanel />}
          {isBackgroundPanelOpen && <BackgroundPanel />}
          {isEffectsPanelOpen && <EffectsPanel />}
          {isDetailsPanelOpen && <DetailsPanel />}
          {isPresentationsPanelOpen && <PresentationsPanel />}
        </div>
        <Workspace />
      </div>
      <SmallScreenNote />
      {isGridViewOpen && <SlideGridModal />}
      {isPresenting && <PresentationView />}
    </div>
  );
}
