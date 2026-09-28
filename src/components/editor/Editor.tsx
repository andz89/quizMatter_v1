"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useEditorStore } from "@/lib/store";
import { buildSlides } from "@/lib/importPresentation";
import { useEditorShortcuts } from "@/lib/useEditorShortcuts";
import { EditorTopBar } from "./EditorTopBar";
import { IconRail } from "./IconRail";
import { Workspace } from "./Workspace";
import { ElementsPanel } from "./ElementsPanel";
import { ColorPanel } from "./ColorPanel";
import { BackgroundPanel } from "./BackgroundPanel";
import { DetailsPanel } from "./DetailsPanel";
import { PresentationsPanel } from "./PresentationsPanel";
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
 */
export function Editor({ presentation, draft }: { presentation: Presentation; draft?: unknown }) {
  // Until the presentation below is in the store, the store still holds the placeholder (or the last presentation opened).
  const isLoaded = useEditorStore((s) => s.presentation.id === presentation.id);
  const hasUnsavedChanges = useEditorStore((s) => s.presentation !== s.savedPresentation);
  const isPresenting = useEditorStore((s) => s.isPresenting);
  const isGridViewOpen = useEditorStore((s) => s.isGridViewOpen);
  const isElementsPanelOpen = useEditorStore((s) => s.isElementsPanelOpen);
  const isColorPanelOpen = useEditorStore((s) => s.isColorPanelOpen);
  const isBackgroundPanelOpen = useEditorStore((s) => s.isBackgroundPanelOpen);
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
    if (draft === undefined) return;

    // Show the presentation's own address instead of /presentation/new?draft=…, so a reload after saving opens the
    // saved presentation instead of another new copy.
    window.history.replaceState(null, "", `/presentation/${presentation.id}/edit`);
    const result = buildSlides(draft);
    if ("errors" in result) alert(`Couldn't load the slides from Claude:\n\n${result.errors.join("\n")}`);
    else store.importSlides(result.slides);
    useEditorStore.setState({ fromDraft: true });
  }, [presentation, draft]);

  // Closing or reloading the tab with unsaved changes makes the browser ask "Leave page?" first.
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

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
      <div className="flex flex-1 overflow-hidden">
        <IconRail />
        {isElementsPanelOpen && <ElementsPanel />}
        {isColorPanelOpen && <ColorPanel />}
        {isBackgroundPanelOpen && <BackgroundPanel />}
        {isDetailsPanelOpen && <DetailsPanel />}
        {isPresentationsPanelOpen && <PresentationsPanel />}
        <Workspace />
      </div>
      {isGridViewOpen && <SlideGridModal />}
      {isPresenting && <PresentationView />}
    </div>
  );
}
