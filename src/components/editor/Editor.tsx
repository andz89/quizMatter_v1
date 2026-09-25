"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useEditorStore } from "@/lib/store";
import { buildSlides } from "@/lib/importQuiz";
import { useEditorShortcuts } from "@/lib/useEditorShortcuts";
import { EditorTopBar } from "./EditorTopBar";
import { IconRail } from "./IconRail";
import { Workspace } from "./Workspace";
import { ElementsPanel } from "./ElementsPanel";
import { ColorPanel } from "./ColorPanel";
import { BackgroundPanel } from "./BackgroundPanel";
import { DetailsPanel } from "./DetailsPanel";
import { LessonsPanel } from "./LessonsPanel";
import { Spinner } from "@/components/Spinner";
import type { Quiz } from "@/lib/schema";

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
 * `draft` is the slides recipe of a quiz Claude sent through the MCP server (see /quiz/new): its
 * slides replace the new quiz's sample slide, unsaved, like the Paste button does.
 */
export function Editor({ quiz, draft }: { quiz: Quiz; draft?: unknown }) {
  // Until the quiz below is in the store, the store still holds the placeholder (or the last quiz opened).
  const isLoaded = useEditorStore((s) => s.quiz.id === quiz.id);
  const hasUnsavedChanges = useEditorStore((s) => s.quiz !== s.savedQuiz);
  const isPresenting = useEditorStore((s) => s.isPresenting);
  const isGridViewOpen = useEditorStore((s) => s.isGridViewOpen);
  const isElementsPanelOpen = useEditorStore((s) => s.isElementsPanelOpen);
  const isColorPanelOpen = useEditorStore((s) => s.isColorPanelOpen);
  const isBackgroundPanelOpen = useEditorStore((s) => s.isBackgroundPanelOpen);
  const isDetailsPanelOpen = useEditorStore((s) => s.isDetailsPanelOpen);
  const isLessonsPanelOpen = useEditorStore((s) => s.isLessonsPanelOpen);
  const closeColorPanel = useEditorStore((s) => s.closeColorPanel);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const clearElementSelection = useEditorStore((s) => s.clearElementSelection);
  const selectedContainerId = useEditorStore((s) => s.selectedContainerId);
  const selectContainer = useEditorStore((s) => s.selectContainer);

  useEditorShortcuts();

  useEffect(() => {
    const store = useEditorStore.getState();
    store.loadQuiz(quiz);
    if (draft === undefined) return;

    // Show the quiz's own address instead of /quiz/new?draft=…, so a reload after saving opens the
    // saved quiz instead of another new copy.
    window.history.replaceState(null, "", `/quiz/${quiz.id}`);
    const result = buildSlides(draft);
    if ("errors" in result) alert(`Couldn't load the slides from Claude:\n\n${result.errors.join("\n")}`);
    else store.importSlides(result.slides);
  }, [quiz, draft]);

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
        {isLessonsPanelOpen && <LessonsPanel />}
        <Workspace />
      </div>
      {isGridViewOpen && <SlideGridModal />}
      {isPresenting && <PresentationView />}
    </div>
  );
}
