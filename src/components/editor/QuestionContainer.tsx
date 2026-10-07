"use client";

import { useRef } from "react";
import { useEditorStore, selectedIdsOn } from "@/lib/store";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MIN_QUESTION_HEIGHT,
  MIN_QUESTION_WIDTH,
  QUESTION_CONTAINER_ID,
  QUESTION_FONT_SIZE,
  QUESTION_NUMBER_INDENT,
  getContainerBounds,
  getQuestionBox,
} from "@/lib/constants";
import { clamp } from "@/lib/geometry";
import { useElementDropTarget } from "@/lib/useElementDropTarget";
import { EditableText } from "./EditableText";
import { SvgElementItem } from "./SvgElementItem";
import { CORNERS, EDGE_HANDLES } from "./handles";
import { GroupSelectionOverlay } from "./GroupSelectionOverlay";
import { SnapGuides } from "./SnapGuides";
import { ResizeHandle } from "./ResizeHandle";
import { QuestionNumberBadge } from "@/components/presentation/SlideStaticView";
import type { Slide } from "@/lib/schema";

// Short-answer slides: the question box's resize handles, in the same spots and look as an element's.
// sx/sy = which side each one moves (-1 = left/top, 1 = right/bottom, 0 = neither).
const BOX_HANDLES = [
  ...CORNERS.map((corner) => ({
    sx: corner.sx,
    sy: corner.sy,
    className: `h-4 w-4 ${corner.className}`,
  })),
  ...EDGE_HANDLES.map((handle) => ({
    sx: handle.axis === "x" ? handle.dir : 0,
    sy: handle.axis === "y" ? handle.dir : 0,
    className: handle.className,
  })),
];

type Rect = { x: number; y: number; width: number; height: number };

export function QuestionContainer({
  slide,
  questionNumber,
}: {
  slide: Slide;
  questionNumber?: number;
}) {
  const updateQuestion = useEditorStore((s) => s.updateQuestion);
  const setQuestionHeight = useEditorStore((s) => s.setQuestionHeight);
  const setQuestionBox = useEditorStore((s) => s.setQuestionBox);
  const zoom = useEditorStore((s) => s.zoom);
  const selectedElementIds = useEditorStore(selectedIdsOn(slide.id));
  // Every slide's question box shares the same id, so also check this is the slide being edited.
  // Only yes/no values, so a click elsewhere doesn't redraw this box.
  const isContainerSelected = useEditorStore(
    (s) =>
      s.selectedSlideId === slide.id &&
      s.selectedContainerIds.includes(QUESTION_CONTAINER_ID),
  );
  const isElementDragOver = useEditorStore(
    (s) =>
      s.selectedSlideId === slide.id &&
      s.dragOverContainerId === QUESTION_CONTAINER_ID,
  );
  const selectContainer = useEditorStore((s) => s.selectContainer);

  const { isDragOver, dropHandlers } = useElementDropTarget(
    slide.id,
    QUESTION_CONTAINER_ID,
  );

  const isSelected = isContainerSelected || isDragOver || isElementDragOver;
  const boundElements = slide.elements.filter(
    (el) => el.containerId === QUESTION_CONTAINER_ID,
  );
  const bounds = getContainerBounds(QUESTION_CONTAINER_ID, slide);

  // Short-answer slides: the box can be moved and resized anywhere on the slide (it can't be deleted).
  const isMovable = slide.type === "short-answer";
  const box = getQuestionBox(slide);
  // A move or resize in progress: where the pointer and the box were when it started, and which
  // sides move (sx = sy = 0 moves the whole box).
  const dragStart = useRef<{
    pointerX: number;
    pointerY: number;
    start: Rect;
    sx: number;
    sy: number;
  } | null>(null);

  const startDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    sx: number,
    sy: number,
  ) => {
    if (e.button !== 0) return;
    // Keep the workspace from starting a rectangle selection.
    e.stopPropagation();
    dragStart.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      start: { ...box, height: slide.questionHeight },
      sx,
      sy,
    };
    selectContainer(QUESTION_CONTAINER_ID, slide.id);
  };

  // Like a text box: a press anywhere on the box moves it, except while typing (a double-click starts
  // typing; then clicks place the cursor). Shift+click is left to onClick, to add the box to the selection.
  const startMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (
      e.shiftKey ||
      (e.target as HTMLElement).closest('[contenteditable="true"]')
    )
      return;
    startDrag(e, 0, 0);
  };

  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    const { pointerX, pointerY, start, sx, sy } = dragStart.current;
    const isMove = sx === 0 && sy === 0;
    // A move holds on to the pointer only once it moves: holding it on the press would send the
    // double-click that starts typing to the box instead of to the text. (A resize handle holds it itself.)
    if (isMove && !e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.setPointerCapture(e.pointerId);
    // The pointer moves in screen px; divide by zoom to get slide px.
    const dx = (e.clientX - pointerX) / zoom;
    const dy = (e.clientY - pointerY) / zoom;
    if (isMove) {
      setQuestionBox(slide.id, { ...start, x: start.x + dx, y: start.y + dy });
      return;
    }
    // Each dragged side stops at the slide's edge, and never gets closer to the other side than the smallest size.
    let left = start.x;
    let top = start.y;
    let right = start.x + start.width;
    let bottom = start.y + start.height;
    if (sx === -1) left = clamp(left + dx, 0, right - MIN_QUESTION_WIDTH);
    if (sx === 1)
      right = clamp(right + dx, left + MIN_QUESTION_WIDTH, CANVAS_WIDTH);
    if (sy === -1) top = clamp(top + dy, 0, bottom - MIN_QUESTION_HEIGHT);
    if (sy === 1)
      bottom = clamp(bottom + dy, top + MIN_QUESTION_HEIGHT, CANVAS_HEIGHT);
    setQuestionBox(slide.id, {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    });
  };

  const stopDrag = () => {
    dragStart.current = null;
  };

  return (
    <>
      {/* On short-answer slides the number stays at the box's usual spot while the box moves. */}
      {isMovable && questionNumber !== undefined && (
        <QuestionNumberBadge number={questionNumber} atDefaultSpot />
      )}
      <div
        data-container-id={QUESTION_CONTAINER_ID}
        // Shift+click selects more boxes, to change their text together.
        onClick={(e) =>
          selectContainer(QUESTION_CONTAINER_ID, slide.id, e.shiftKey)
        }
        {...dropHandlers}
        // A resize handle's drag reaches these through bubbling too (it holds the pointer itself).
        {...(isMovable && {
          onPointerDown: startMove,
          onPointerMove: drag,
          onPointerUp: stopDrag,
        })}
        className={`group/box rounded-button border p-4 transition-colors ${isMovable ? "absolute cursor-move" : "relative shrink-0"}`}
        style={{
          ...(isMovable
            ? {
                left: box.x,
                top: box.y,
                width: box.width,
                height: slide.questionHeight,
              }
            : {
                height: slide.questionHeight,
                marginLeft: QUESTION_NUMBER_INDENT,
              }),
          borderColor: isSelected ? "var(--accent)" : "transparent",
          background:
            isDragOver || isElementDragOver
              ? "color-mix(in srgb, var(--accent) 5%, transparent)"
              : undefined,
        }}
      >
        {!isMovable && questionNumber !== undefined && (
          <QuestionNumberBadge number={questionNumber} />
        )}
        <EditableText
          text={slide.question}
          html={slide.questionHtml}
          onChange={(text, html) => updateQuestion(slide.id, text, html)}
          placeholder="Type your question…"
          target={{ kind: "question", slideId: slide.id }}
          fontSize={slide.questionFontSize ?? QUESTION_FONT_SIZE}
          isSelected={isContainerSelected}
          className="font-normal text-text-primary"
        />

        <div
          data-element-layer
          className="pointer-events-none absolute inset-0"
        >
          {boundElements.map((element) => (
            <SvgElementItem
              key={element.id}
              slideId={slide.id}
              element={element}
              isSelected={selectedElementIds.includes(element.id)}
              bounds={bounds}
            />
          ))}
          <GroupSelectionOverlay
            slideId={slide.id}
            elements={boundElements}
            bounds={bounds}
          />
          <SnapGuides slideId={slide.id} containerId={QUESTION_CONTAINER_ID} />
        </div>

        {isMovable &&
          isContainerSelected &&
          BOX_HANDLES.map((handle) => (
            <div
              key={handle.className}
              onPointerDown={(e) => {
                startDrag(e, handle.sx, handle.sy);
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              // The drag already selected the box; don't let the click select it again as a Shift+click.
              onClick={(e) => e.stopPropagation()}
              title="Resize"
              className={`absolute z-30 rounded-full border-2 border-white shadow-sm ${handle.className}`}
              style={{ background: "var(--accent)" }}
            />
          ))}
        {!isMovable && (
          <ResizeHandle
            height={slide.questionHeight}
            onResize={(height) => setQuestionHeight(slide.id, height)}
          />
        )}
      </div>
    </>
  );
}
