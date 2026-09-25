"use client";

import { useEditorStore, selectedIdsOn } from "@/lib/store";
import { QUESTION_CONTAINER_ID, QUESTION_CONTAINER_WIDTH } from "@/lib/constants";
import { useElementDropTarget } from "@/lib/useElementDropTarget";
import { EditableText } from "./EditableText";
import { SvgElementItem } from "./SvgElementItem";
import { GroupSelectionOverlay } from "./GroupSelectionOverlay";
import { SnapGuides } from "./SnapGuides";
import { ResizeHandle } from "./ResizeHandle";
import type { Slide } from "@/lib/schema";

export function QuestionContainer({ slide }: { slide: Slide }) {
  const updateQuestion = useEditorStore((s) => s.updateQuestion);
  const setQuestionHeight = useEditorStore((s) => s.setQuestionHeight);
  const selectedElementIds = useEditorStore(selectedIdsOn(slide.id));
  // Every slide's question box shares the same id, so also check this is the slide being edited.
  // Only yes/no values, so a click elsewhere doesn't redraw this box.
  const isContainerSelected = useEditorStore(
    (s) => s.selectedSlideId === slide.id && s.selectedContainerId === QUESTION_CONTAINER_ID
  );
  const isElementDragOver = useEditorStore(
    (s) => s.selectedSlideId === slide.id && s.dragOverContainerId === QUESTION_CONTAINER_ID
  );
  const selectContainer = useEditorStore((s) => s.selectContainer);

  const { isDragOver, dropHandlers } = useElementDropTarget(slide.id, QUESTION_CONTAINER_ID);

  const isSelected = isContainerSelected || isDragOver || isElementDragOver;
  const boundElements = slide.elements.filter((el) => el.containerId === QUESTION_CONTAINER_ID);
  const bounds = { width: QUESTION_CONTAINER_WIDTH, height: slide.questionHeight };

  return (
    <div
      data-container-id={QUESTION_CONTAINER_ID}
      onClick={() => selectContainer(QUESTION_CONTAINER_ID, slide.id)}
      {...dropHandlers}
      className="group/box relative shrink-0 rounded-button border p-4 transition-colors"
      style={{
        height: slide.questionHeight,
        borderColor: isSelected ? "var(--accent-navy)" : "var(--border-default)",
        background: isDragOver || isElementDragOver ? "rgba(25, 26, 44, 0.05)" : undefined,
      }}
    >
      <EditableText
        text={slide.question}
        html={slide.questionHtml}
        onChange={(text, html) => updateQuestion(slide.id, text, html)}
        placeholder="Type your question…"
        minFontSize={22}
        maxFontSize={40}
        className="font-normal text-text-primary"
      />

      <div data-element-layer className="pointer-events-none absolute inset-0">
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
        <SnapGuides slideId={slide.id} containerId={QUESTION_CONTAINER_ID} />
      </div>

      <ResizeHandle height={slide.questionHeight} onResize={(height) => setQuestionHeight(slide.id, height)} />
    </div>
  );
}
