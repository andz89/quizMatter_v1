"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useEditorStore } from "@/lib/store";
import { useEditorShortcuts } from "@/lib/useEditorShortcuts";
import { EditorTopBar } from "./EditorTopBar";
import { IconRail } from "./IconRail";
import { Workspace } from "./Workspace";
import { ElementsPanel } from "./ElementsPanel";
import { ColorPanel } from "./ColorPanel";
import { BackgroundPanel } from "./BackgroundPanel";
import type { Quiz } from "@/lib/schema";

// Only downloaded the first time they're opened, so the editor itself loads faster.
const SlideGridModal = dynamic(() => import("./SlideGridModal").then((mod) => mod.SlideGridModal));
const PresentationView = dynamic(() =>
  import("@/components/presentation/PresentationView").then((mod) => mod.PresentationView)
);

export function Editor({ quiz }: { quiz: Quiz }) {
  // Until the quiz below is in the store, the store still holds the placeholder (or the last quiz opened).
  const isLoaded = useEditorStore((s) => s.quiz.id === quiz.id);
  const hasUnsavedChanges = useEditorStore((s) => s.quiz !== s.savedQuiz);
  const isPresenting = useEditorStore((s) => s.isPresenting);
  const isGridViewOpen = useEditorStore((s) => s.isGridViewOpen);
  const isElementsPanelOpen = useEditorStore((s) => s.isElementsPanelOpen);
  const isColorPanelOpen = useEditorStore((s) => s.isColorPanelOpen);
  const isBackgroundPanelOpen = useEditorStore((s) => s.isBackgroundPanelOpen);
  const closeColorPanel = useEditorStore((s) => s.closeColorPanel);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const clearElementSelection = useEditorStore((s) => s.clearElementSelection);
  const selectedContainerId = useEditorStore((s) => s.selectedContainerId);
  const selectContainer = useEditorStore((s) => s.selectContainer);

  useEditorShortcuts();

  useEffect(() => {
    useEditorStore.getState().loadQuiz(quiz);
  }, [quiz]);

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
        <Workspace />
      </div>
      {isGridViewOpen && <SlideGridModal />}
      {isPresenting && <PresentationView />}
    </div>
  );
}
