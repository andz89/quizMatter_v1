import { useRef, useState } from "react";
import { useEditorStore, withGroupMembers } from "./store";

// Where a rectangle drag selects: which slide, and the part of the page holding its elements.
export type MarqueeTarget = { slideId: string; root: HTMLElement };

/**
 * Rectangle selection: dragging on empty space (anything that isn't a shape, button or handle — e.g.
 * the gray workspace, the slide, or a question/option box that isn't being typed in) draws a
 * rectangle, and every element inside `target.root` it touches gets selected. Shift+drag adds to the
 * current selection. All points are screen (client) pixels.
 *
 * `pickTarget` decides the slide when the mouse is pressed (null = don't start). `containerId` is the
 * box that stays selected afterwards (null = none). `scale` is the zoom of the element that gets
 * `pointerHandlers` (1 = not zoomed). Draw `marqueeBox` inside that element, or in a box with the
 * same top-left corner.
 */
export function useMarqueeSelection(
  pickTarget: (e: React.PointerEvent<HTMLElement>) => MarqueeTarget | null,
  containerId: string | null,
  scale: number
) {
  // A press that hasn't moved far enough to count as a drag yet. Until it does, nothing is captured,
  // so plain clicks and double-clicks still reach the box under the mouse.
  const pressStart = useRef<{ x: number; y: number; keptIds: string[]; target: MarqueeTarget } | null>(null);
  // originX/Y = the handler element's top-left on screen when the drag began, for drawing the rectangle.
  const [marquee, setMarquee] = useState<{
    originX: number;
    originY: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    keptIds: string[];
    target: MarqueeTarget;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    // Buttons, grip handles and text being typed in keep their own mouse behavior.
    // (Shapes and their handles stop the event themselves.)
    if ((e.target as HTMLElement).closest("button, [role='button'], [contenteditable='true'], input, textarea")) return;
    const target = pickTarget(e);
    if (!target) return;
    // Read the store now: the editor's "click outside deselects" runs right after this.
    const state = useEditorStore.getState();
    const keptIds = e.shiftKey && state.selectedSlideId === target.slideId ? state.selectedElementIds : [];
    pressStart.current = { x: e.clientX, y: e.clientY, keptIds, target };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (marquee) {
      setMarquee({ ...marquee, x: e.clientX, y: e.clientY });
      return;
    }
    const start = pressStart.current;
    // The button may have been let go outside, where we never heard about it.
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
      target: start.target,
    });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    pressStart.current = null;
    if (!marquee) return;
    setMarquee(null);
    const left = Math.min(marquee.startX, e.clientX);
    const right = Math.max(marquee.startX, e.clientX);
    const top = Math.min(marquee.startY, e.clientY);
    const bottom = Math.max(marquee.startY, e.clientY);

    // The drag ends with a click, which would clear the new selection (e.g. on the slide) — swallow
    // that one click. It comes right after this, so the catcher is removed on the next tick either way.
    const swallowClick = (click: MouseEvent) => click.stopPropagation();
    window.addEventListener("click", swallowClick, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallowClick, { capture: true }));

    // Compare on-screen boxes, so this works at any zoom and inside any box (question, option, canvas).
    const touchedIds = Array.from(marquee.target.root.querySelectorAll<HTMLElement>("[data-element-id]"))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left < right && r.right > left && r.top < bottom && r.bottom > top;
      })
      .map((el) => el.dataset.elementId!);

    const { slideId } = marquee.target;
    const state = useEditorStore.getState();
    const elements = state.presentation.slides.find((s) => s.id === slideId)?.elements ?? [];
    state.selectContainer(containerId, slideId);
    // Touching any part of a group selects the whole group.
    state.selectElements(withGroupMembers(elements, [...new Set([...marquee.keptIds, ...touchedIds])]));
  };

  // The rectangle in the handler element's own (unzoomed) pixels, for drawing it.
  const marqueeBox = marquee
    ? {
        left: (Math.min(marquee.startX, marquee.x) - marquee.originX) / scale,
        top: (Math.min(marquee.startY, marquee.y) - marquee.originY) / scale,
        width: Math.abs(marquee.x - marquee.startX) / scale,
        height: Math.abs(marquee.y - marquee.startY) / scale,
      }
    : null;

  return { pointerHandlers: { onPointerDown, onPointerMove, onPointerUp }, marqueeBox };
}
