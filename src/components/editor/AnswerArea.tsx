"use client";

import { useEffect, useRef, useState } from "react";
import { useEditorStore, selectedIdsOn } from "@/lib/store";
import { ANSWER_CONTAINER_ID, CANVAS_WIDTH, CANVAS_HEIGHT, getContainerBounds } from "@/lib/constants";
import { useElementDropTarget } from "@/lib/useElementDropTarget";
import { useMarqueeSelection } from "@/lib/useMarqueeSelection";
import { getElementAsset } from "@/lib/svgLibrary";
import { SvgElementItem } from "./SvgElementItem";
import { GroupSelectionOverlay } from "./GroupSelectionOverlay";
import { SnapGuides } from "./SnapGuides";
import { ContainerClearButton } from "./ContainerClearButton";
import { ElementContextMenu } from "./ElementContextMenu";
import { CloseIcon } from "@/components/icons/CloseIcon";
import { MAX_ANSWER_LENGTH, type Slide } from "@/lib/schema";

const ANSWER_TYPES: { value: NonNullable<Slide["answerType"]>; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "canvas", label: "Canvas" },
];

interface AnswerAreaProps {
  slide: Slide;
  onClose: () => void;
}

/**
 * Modal with the answer of a short-answer or blank slide: a typed text, or a canvas the size of a
 * slide where elements are dropped, pasted and edited just like on the slide itself.
 * It covers only the workspace (Workspace draws it inside itself), so the top toolbar and the
 * Elements panel stay usable — elements can be dragged from the panel straight into the canvas.
 */
export function AnswerArea({ slide, onClose }: AnswerAreaProps) {
  const updateCorrectAnswer = useEditorStore((s) => s.updateCorrectAnswer);
  const setAnswerType = useEditorStore((s) => s.setAnswerType);
  // The slide's zoom: element dragging and resizing read it from the store, so the canvas must use it too.
  const zoom = useEditorStore((s) => s.zoom);
  const answerType = slide.answerType ?? "text";
  const answer = slide.correctAnswer ?? "";
  // A blank slide's answer isn't a correct answer but content shown during the discussion: "Reveal", in navy.
  const isReveal = slide.type === "lesson";
  // A drag that starts in the canvas and ends on the dim backdrop also "clicks" the backdrop, so
  // only close when the press started on the backdrop too.
  const pressedBackdrop = useRef(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape while typing in a canvas text only stops the typing.
      if (e.key === "Escape" && !(e.target as HTMLElement | null)?.isContentEditable) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      // Clicks in here keep the selection (the editor clears it on clicks elsewhere).
      data-keep-container-selection="true"
      className="absolute inset-0 z-30 flex overflow-auto bg-black/40 p-6"
      onPointerDown={(e) => (pressedBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (pressedBackdrop.current && e.target === e.currentTarget) onClose();
      }}
    >
      {/* m-auto centers the card, and still lets it scroll from its top when zoomed in past the screen. */}
      <div
        className="m-auto flex flex-col gap-4 rounded-card bg-bg-surface px-6 py-5"
        style={{ width: answerType === "canvas" ? CANVAS_WIDTH * zoom + 48 : 640 }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span
              className={`text-xs font-semibold uppercase tracking-[0.05em] ${isReveal ? "text-accent-navy" : "text-accent-green"}`}
            >
              {isReveal ? "Reveal" : "Correct answer"}
            </span>
            {/* Filled pill for the chosen kind of answer. */}
            <div className="flex items-center gap-0.5 rounded-dropdown bg-bg-page p-0.5">
              {ANSWER_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setAnswerType(slide.id, type.value)}
                  className={`h-7 rounded-[6px] px-3 text-sm font-semibold ${
                    answerType === type.value
                      ? `${isReveal ? "bg-accent-navy" : "bg-accent-green"} text-white`
                      : "text-text-primary hover:bg-bg-surface"
                  }`}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close answer"
            className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        {answerType === "text" ? (
          <div className="flex flex-col gap-1.5">
            <textarea
              autoFocus
              rows={5}
              maxLength={MAX_ANSWER_LENGTH}
              value={answer}
              onChange={(e) => updateCorrectAnswer(slide.id, e.target.value)}
              placeholder={isReveal ? "Type what to reveal…" : "Type the correct answer…"}
              // Google Forms look: light gray fill, a single bottom line, which gets thicker on focus.
              // The line is an inset shadow so the thicker one doesn't push the text.
              className="resize-none rounded-t-[4px] bg-[#F8F9FA] px-4 py-3 text-base font-normal text-[#202124] shadow-[inset_0_-1px_0_#80868B] outline-none placeholder:text-[#70757A] focus:shadow-[inset_0_-2px_0_var(--accent-navy)]"
            />
            <span className="self-end text-xs text-text-secondary tabular-nums">
              {answer.length} / {MAX_ANSWER_LENGTH}
            </span>
          </div>
        ) : (
          // Same CSS zoom as the slide, so elements look the same size in both.
          <div style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, zoom }}>
            <AnswerCanvas slide={slide} />
          </div>
        )}
      </div>
    </div>
  );
}

const ANSWER_BOUNDS = getContainerBounds(ANSWER_CONTAINER_ID, { questionHeight: 0, layout: "grid" });

/** A slide-sized canvas for the answer's elements: drop, paste, drag, resize and rectangle-select like on a slide. */
function AnswerCanvas({ slide }: { slide: Slide }) {
  const selectedElementIds = useEditorStore(selectedIdsOn(slide.id));
  const isContainerSelected = useEditorStore(
    (s) => s.selectedSlideId === slide.id && s.selectedContainerId === ANSWER_CONTAINER_ID
  );
  const selectContainer = useEditorStore((s) => s.selectContainer);
  const copySelectedElements = useEditorStore((s) => s.copySelectedElements);
  const pasteClipboard = useEditorStore((s) => s.pasteClipboard);
  const fitElementsToContainer = useEditorStore((s) => s.fitElementsToContainer);

  const { isDragOver, dropHandlers } = useElementDropTarget(slide.id, ANSWER_CONTAINER_ID);
  const { rootRef, pointerHandlers, marqueeBox, takeSkippedClick } = useMarqueeSelection(slide.id, ANSWER_CONTAINER_ID);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; canPaste: boolean } | null>(null);

  const answerElements = slide.elements.filter((el) => el.containerId === ANSWER_CONTAINER_ID);
  const isHighlighted = isContainerSelected || isDragOver;

  return (
    <div
      ref={rootRef}
      // Its own canvas root, so a drag here never counts the slide's boxes as drop spots.
      data-canvas-root="true"
      data-container-id={ANSWER_CONTAINER_ID}
      className="group/box relative h-full w-full select-none overflow-hidden rounded-card border bg-bg-surface"
      style={{
        borderColor: isHighlighted ? "var(--accent-navy)" : "var(--border-default)",
        background: isDragOver ? "rgba(25, 26, 44, 0.04)" : undefined,
      }}
      {...dropHandlers}
      {...pointerHandlers}
      onClick={() => {
        if (takeSkippedClick()) return;
        selectContainer(ANSWER_CONTAINER_ID, slide.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        // Read once here instead of listening to the clipboard, which would redraw on every copy.
        setContextMenu({ x: e.clientX, y: e.clientY, canPaste: useEditorStore.getState().clipboard !== null });
      }}
    >
      {answerElements.length === 0 && (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-2xl text-text-secondary">
          Drag or paste elements here
        </p>
      )}

      <div data-element-layer className="pointer-events-none absolute inset-0">
        {answerElements.map((element) => (
          <SvgElementItem
            key={element.id}
            slideId={slide.id}
            element={element}
            allElements={answerElements}
            isSelected={selectedElementIds.includes(element.id)}
            bounds={ANSWER_BOUNDS}
          />
        ))}
        <GroupSelectionOverlay slideId={slide.id} elements={answerElements} bounds={ANSWER_BOUNDS} />
        <SnapGuides slideId={slide.id} containerId={ANSWER_CONTAINER_ID} />
      </div>

      <ContainerClearButton
        slideId={slide.id}
        containerId={ANSWER_CONTAINER_ID}
        hasElements={answerElements.length > 0}
        className="absolute right-2 top-2"
        large
      />

      {marqueeBox && (
        <div
          className="pointer-events-none absolute z-40 border border-accent-navy"
          style={{ ...marqueeBox, background: "rgba(25, 26, 44, 0.08)" }}
        />
      )}

      {contextMenu && (
        <ElementContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          canCopy={selectedElementIds.length > 0}
          canPaste={contextMenu.canPaste}
          onCopy={copySelectedElements}
          // "Fit to box" skips text boxes, like on the slide.
          canFit={answerElements.some((el) => selectedElementIds.includes(el.id) && !getElementAsset(el.assetId)?.isTextBox)}
          onPaste={() => pasteClipboard(slide.id, ANSWER_CONTAINER_ID)}
          onFit={() => fitElementsToContainer(slide.id, selectedElementIds)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
