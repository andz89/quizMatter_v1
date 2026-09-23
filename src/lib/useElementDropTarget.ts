import { useRef, useState } from "react";
import { useEditorStore } from "./store";
import { ELEMENT_DRAG_MIME } from "./constants";

/**
 * Drag-enter/leave/drop handlers that turn a container into a drop target for an element asset
 * dragged from the Elements panel. `isDragOver` drives the hover highlight while something compatible
 * is being dragged over it; a depth counter (rather than a plain boolean) keeps that highlight stable
 * while the pointer moves across the container's own children, which fire their own drag-leave/enter.
 */
export function useElementDropTarget(slideId: string, containerId: string) {
  const addElement = useEditorStore((s) => s.addElement);
  const zoom = useEditorStore((s) => s.zoom);
  const dragDepth = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);

  const isElementDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(ELEMENT_DRAG_MIME);

  return {
    isDragOver,
    dropHandlers: {
      onDragEnter: (e: React.DragEvent) => {
        if (!isElementDrag(e)) return;
        e.preventDefault();
        dragDepth.current += 1;
        setIsDragOver(true);
      },
      onDragOver: (e: React.DragEvent) => {
        if (!isElementDrag(e)) return;
        e.preventDefault();
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!isElementDrag(e)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setIsDragOver(false);
      },
      onDrop: (e: React.DragEvent) => {
        const assetId = e.dataTransfer.getData(ELEMENT_DRAG_MIME);
        if (!assetId) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current = 0;
        setIsDragOver(false);
        const rect = e.currentTarget.getBoundingClientRect();
        addElement(slideId, assetId, containerId, {
          x: (e.clientX - rect.left) / zoom,
          y: (e.clientY - rect.top) / zoom,
        });
      },
    },
  };
}
