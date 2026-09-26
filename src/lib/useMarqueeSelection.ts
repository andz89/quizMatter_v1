import { useRef, useState } from "react";
import { useEditorStore, withGroupMembers } from "./store";

/**
 * Rectangle selection for a canvas (the slide, or its answer canvas): dragging anywhere on it that
 * isn't a shape, button or handle (empty space, or a question/option box that isn't being typed in)
 * draws a rectangle, and every element it touches gets selected. Shift+drag adds to the current
 * selection. All points are screen (client) pixels.
 *
 * `containerId` is the box that stays selected afterwards (null = none). Put `rootRef` and
 * `pointerHandlers` on the canvas, draw `marqueeBox` inside it, and start its onClick with
 * `if (takeSkippedClick()) return;`.
 */
export function useMarqueeSelection(slideId: string, containerId: string | null) {
  const zoom = useEditorStore((s) => s.zoom);
  const rootRef = useRef<HTMLDivElement>(null);
  // A press that hasn't moved far enough to count as a drag yet. Until it does, nothing is captured,
  // so plain clicks and double-clicks still reach the box under the mouse.
  const pressStart = useRef<{ x: number; y: number; keptIds: string[] } | null>(null);
  // originX/Y = the canvas's top-left on screen when the drag began, for drawing the rectangle.
  const [marquee, setMarquee] = useState<{
    originX: number;
    originY: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    keptIds: string[];
  } | null>(null);

  // A rectangle drag ends with a click on the canvas, which would clear the new selection — skip that one click.
  const skipNextClick = useRef(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // A drag that ended off the canvas never gets its click, so don't carry the skip over.
    skipNextClick.current = false;
    if (e.button !== 0) return;
    // Buttons, grip handles and text being typed in keep their own mouse behavior.
    // (Shapes and their handles stop the event themselves.)
    if ((e.target as HTMLElement).closest("button, [role='button'], [contenteditable='true']")) return;
    // Read the store now: the editor's "click outside deselects" runs right after this.
    const state = useEditorStore.getState();
    const keptIds = e.shiftKey && state.selectedSlideId === slideId ? state.selectedElementIds : [];
    pressStart.current = { x: e.clientX, y: e.clientY, keptIds };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (marquee) {
      setMarquee({ ...marquee, x: e.clientX, y: e.clientY });
      return;
    }
    const start = pressStart.current;
    // The button may have been let go outside the canvas, where we never heard about it.
    if (!start || (e.buttons & 1) === 0) {
      pressStart.current = null;
      return;
    }
    // A tiny wiggle is still just a click.
    if (Math.abs(e.clientX - start.x) < 4 && Math.abs(e.clientY - start.y) < 4) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const origin = e.currentTarget.getBoundingClientRect();
    setMarquee({
      originX: origin.left,
      originY: origin.top,
      startX: start.x,
      startY: start.y,
      x: e.clientX,
      y: e.clientY,
      keptIds: start.keptIds,
    });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pressStart.current = null;
    if (!marquee || !rootRef.current) return;
    setMarquee(null);
    const left = Math.min(marquee.startX, e.clientX);
    const right = Math.max(marquee.startX, e.clientX);
    const top = Math.min(marquee.startY, e.clientY);
    const bottom = Math.max(marquee.startY, e.clientY);
    skipNextClick.current = true;

    // Compare on-screen boxes, so this works at any zoom and inside any box (question, option, canvas).
    const touchedIds = Array.from(rootRef.current.querySelectorAll<HTMLElement>("[data-element-id]"))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left < right && r.right > left && r.top < bottom && r.bottom > top;
      })
      .map((el) => el.dataset.elementId!);

    const state = useEditorStore.getState();
    const elements = state.quiz.slides.find((s) => s.id === slideId)?.elements ?? [];
    state.selectContainer(containerId, slideId);
    // Touching any part of a group selects the whole group.
    state.selectElements(withGroupMembers(elements, [...new Set([...marquee.keptIds, ...touchedIds])]));
  };

  // The rectangle in the canvas's own (unzoomed) coordinates, for drawing it.
  const marqueeBox = marquee
    ? {
        left: (Math.min(marquee.startX, marquee.x) - marquee.originX) / zoom,
        top: (Math.min(marquee.startY, marquee.y) - marquee.originY) / zoom,
        width: Math.abs(marquee.x - marquee.startX) / zoom,
        height: Math.abs(marquee.y - marquee.startY) / zoom,
      }
    : null;

  // True (once) for the click that ends a rectangle drag.
  const takeSkippedClick = () => {
    if (!skipNextClick.current) return false;
    skipNextClick.current = false;
    return true;
  };

  return { rootRef, pointerHandlers: { onPointerDown, onPointerMove, onPointerUp }, marqueeBox, takeSkippedClick };
}
