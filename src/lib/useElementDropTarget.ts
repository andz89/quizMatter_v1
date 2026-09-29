import { useRef, useState } from "react";
import { toast } from "sonner";
import { useEditorStore } from "./store";
import { ELEMENT_DRAG_MIME, PHOTO_DRAG_MIME } from "./constants";
import { addPhotoToSlide, uploadPhoto } from "./photos";
import { photoSchema } from "./schema";
import { PHOTO_ID } from "./svgLibrary";

/**
 * Drag-enter/leave/drop handlers that turn a container into a drop target for an element asset
 * dragged from the Elements panel, a photo from the Photos panel, or photo files dragged from the computer. `isDragOver` drives the hover highlight while something compatible
 * is being dragged over it; a depth counter (rather than a plain boolean) keeps that highlight stable
 * while the pointer moves across the container's own children, which fire their own drag-leave/enter.
 */
export function useElementDropTarget(slideId: string, containerId: string | null) {
  const addElement = useEditorStore((s) => s.addElement);
  const zoom = useEditorStore((s) => s.zoom);
  const dragDepth = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);

  const isElementDrag = (e: React.DragEvent) =>
    [ELEMENT_DRAG_MIME, PHOTO_DRAG_MIME, "Files"].some((type) => e.dataTransfer.types.includes(type));

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
        const photoJson = e.dataTransfer.getData(PHOTO_DRAG_MIME);
        // Anything that isn't a photo is still dropped here (so the browser doesn't open it), and
        // uploadPhoto says it can't be added.
        const files = [...e.dataTransfer.files];
        if (!assetId && !photoJson && files.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current = 0;
        setIsDragOver(false);
        // Measure from the box's elements area (it can be inset, e.g. past an option's ✓/A button).
        // The slide itself is measured whole: the layer inside it belongs to its question box.
        const layer = (containerId !== null && e.currentTarget.querySelector("[data-element-layer]")) || e.currentTarget;
        const rect = layer.getBoundingClientRect();
        const position = { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
        if (assetId) return addElement(slideId, assetId, containerId, position);
        if (photoJson) {
          // Already uploaded, so it's placed at once.
          const photo = photoSchema.safeParse(JSON.parse(photoJson));
          if (photo.success) addElement(slideId, PHOTO_ID, containerId, position, undefined, photo.data);
          return;
        }
        // One photo at a time.
        if (files.length > 1) toast.error("Please drop one photo at a time.");
        else addPhotoToSlide(() => uploadPhoto(files[0]), { slideId, containerId, position });
      },
    },
  };
}
