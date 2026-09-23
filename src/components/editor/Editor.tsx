"use client";

import { useEffect } from "react";
import { useEditorStore } from "@/lib/store";
import { EditorTopBar } from "./EditorTopBar";
import { IconRail } from "./IconRail";
import { Workspace } from "./Workspace";
import { SlideGridModal } from "./SlideGridModal";
import { ElementsPanel } from "./ElementsPanel";
import { ColorPanel } from "./ColorPanel";
import { PresentationView } from "@/components/presentation/PresentationView";

export function Editor() {
  const isPresenting = useEditorStore((s) => s.isPresenting);
  const isGridViewOpen = useEditorStore((s) => s.isGridViewOpen);
  const isElementsPanelOpen = useEditorStore((s) => s.isElementsPanelOpen);
  const isColorPanelOpen = useEditorStore((s) => s.isColorPanelOpen);
  const closeColorPanel = useEditorStore((s) => s.closeColorPanel);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const clearElementSelection = useEditorStore((s) => s.clearElementSelection);
  const selectedContainerId = useEditorStore((s) => s.selectedContainerId);
  const selectContainer = useEditorStore((s) => s.selectContainer);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  // Ctrl/Cmd+Z undoes; Ctrl+Y or Ctrl/Cmd+Shift+Z redoes. This also runs while typing (replacing the
  // browser's own text undo), so there's only one undo history to think about.
  useEffect(() => {
    if (isPresenting) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === "y") {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPresenting, undo, redo]);

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

  return (
    <div className="flex h-screen flex-col">
      <EditorTopBar />
      <div className="flex flex-1 overflow-hidden">
        <IconRail />
        {isElementsPanelOpen && <ElementsPanel />}
        {isColorPanelOpen && <ColorPanel />}
        <Workspace />
      </div>
      {isGridViewOpen && <SlideGridModal />}
      {isPresenting && <PresentationView />}
    </div>
  );
}
