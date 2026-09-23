"use client";

import { useRef } from "react";
import { useEditorStore } from "@/lib/store";
import { QUESTION_CONTAINER_ID, QUESTION_CONTAINER_WIDTH } from "@/lib/constants";
import { useElementDropTarget } from "@/lib/useElementDropTarget";
import { EditableText } from "./EditableText";
import { SvgElementItem } from "./SvgElementItem";
import { GroupSelectionOverlay } from "./GroupSelectionOverlay";
import type { Slide } from "@/lib/schema";

export function QuestionContainer({ slide }: { slide: Slide }) {
  const updateQuestion = useEditorStore((s) => s.updateQuestion);
  const setQuestionHeight = useEditorStore((s) => s.setQuestionHeight);
  const zoom = useEditorStore((s) => s.zoom);
  const selectedContainerId = useEditorStore((s) => s.selectedContainerId);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const selectContainer = useEditorStore((s) => s.selectContainer);

  const resizeState = useRef<{ y: number; height: number } | null>(null);
  const { isDragOver, dropHandlers } = useElementDropTarget(slide.id, QUESTION_CONTAINER_ID);

  const isSelected = selectedContainerId === QUESTION_CONTAINER_ID || isDragOver;
  const boundElements = slide.elements.filter((el) => el.containerId === QUESTION_CONTAINER_ID);
  const bounds = { width: QUESTION_CONTAINER_WIDTH, height: slide.questionHeight };

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    resizeState.current = { y: e.clientY, height: slide.questionHeight };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeState.current) return;
    const { y, height } = resizeState.current;
    setQuestionHeight(slide.id, height + (e.clientY - y) / zoom);
  };

  const stopResize = () => {
    resizeState.current = null;
  };

  return (
    <div
      data-container-id={QUESTION_CONTAINER_ID}
      onClick={() => selectContainer(QUESTION_CONTAINER_ID, slide.id)}
      {...dropHandlers}
      className="relative shrink-0 rounded-button border p-4 transition-colors"
      style={{
        height: slide.questionHeight,
        borderColor: isSelected ? "var(--accent-navy)" : "var(--border-default)",
        background: isDragOver ? "rgba(25, 26, 44, 0.05)" : undefined,
      }}
    >
      <EditableText
        value={slide.question}
        onChange={(text) => updateQuestion(slide.id, text)}
        placeholder="Type your question…"
        resetKey={slide.id}
        minFontSize={22}
        maxFontSize={40}
        className="font-semibold text-text-primary"
      />

      <div className="pointer-events-none absolute inset-0">
        {boundElements.map((element) => (
          <SvgElementItem
            key={element.id}
            slideId={slide.id}
            element={element}
            allElements={boundElements}
            isSelected={selectedElementIds.includes(element.id)}
            bounds={bounds}
          />
        ))}
        <GroupSelectionOverlay slideId={slide.id} elements={boundElements} bounds={bounds} />
      </div>

      <div
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={stopResize}
        onPointerLeave={stopResize}
        onClick={(e) => e.stopPropagation()}
        title="Drag to resize"
        className="group absolute -bottom-1.5 left-1/2 flex h-3 w-16 -translate-x-1/2 cursor-ns-resize items-center justify-center"
      >
        <div className="h-1 w-10 rounded-full bg-border-default transition-colors group-hover:bg-accent-navy" />
      </div>
    </div>
  );
}
