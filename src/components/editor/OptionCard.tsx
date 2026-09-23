"use client";

import { useSortable } from "@dnd-kit/sortable";
import { useEditorStore } from "@/lib/store";
import { OPTION_LABELS, OPTION_CONTAINER_WIDTH, getOptionContainerHeight } from "@/lib/constants";
import { useElementDropTarget } from "@/lib/useElementDropTarget";
import { EditableText } from "./EditableText";
import { GripIcon } from "@/components/icons/GripIcon";
import { SvgElementItem } from "./SvgElementItem";
import { GroupSelectionOverlay } from "./GroupSelectionOverlay";
import { ContainerClearButtons } from "./ContainerClearButtons";
import type { Option, SvgElement } from "@/lib/schema";

interface OptionCardProps {
  slideId: string;
  option: Option;
  index: number;
  isCorrect: boolean;
  elements: SvgElement[];
  questionHeight: number;
}

export function OptionCard({ slideId, option, index, isCorrect, elements, questionHeight }: OptionCardProps) {
  const updateOption = useEditorStore((s) => s.updateOption);
  const setCorrectOption = useEditorStore((s) => s.setCorrectOption);
  const zoom = useEditorStore((s) => s.zoom);
  const selectedContainerId = useEditorStore((s) => s.selectedContainerId);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const selectContainer = useEditorStore((s) => s.selectContainer);
  const dragOverContainerId = useEditorStore((s) => s.dragOverContainerId);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: option.id });
  const { isDragOver, dropHandlers } = useElementDropTarget(slideId, option.id);
  const isElementDragOver = dragOverContainerId === option.id;

  const isSelectedContainer = selectedContainerId === option.id || isDragOver || isElementDragOver;
  const boundElements = elements.filter((el) => el.containerId === option.id);
  const bounds = { width: OPTION_CONTAINER_WIDTH, height: getOptionContainerHeight(questionHeight) };

  // dnd-kit computes the drag offset in raw screen pixels, but this card sits inside
  // the canvas's `scale(zoom)` ancestor — so the offset has to be un-scaled here, or the
  // card drifts away from the cursor whenever the canvas isn't at exactly 100% zoom.
  const dragTransform = transform
    ? `translate3d(${transform.x / zoom}px, ${transform.y / zoom}px, 0) scaleX(${transform.scaleX ?? 1}) scaleY(${transform.scaleY ?? 1})`
    : undefined;

  const borderColor = isSelectedContainer ? "var(--accent-navy)" : isCorrect ? "var(--accent-green)" : "var(--border-default)";
  const background =
    isDragOver || isElementDragOver ? "rgba(25, 26, 44, 0.08)" : isCorrect ? "rgba(30, 142, 79, 0.06)" : "var(--bg-page)";

  return (
    <div
      ref={setNodeRef}
      data-container-id={option.id}
      onClick={() => selectContainer(option.id, slideId)}
      {...dropHandlers}
      className="group group/box relative rounded-button border p-6 pl-16 transition-colors"
      style={{
        borderColor,
        background,
        transform: dragTransform,
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setCorrectOption(slideId, option.id);
        }}
        title="Mark as correct answer"
        className="absolute left-3 top-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors"
        style={{
          borderColor: isCorrect ? "var(--accent-green)" : "var(--border-default)",
          color: isCorrect ? "var(--accent-green)" : "var(--text-secondary)",
          background: isCorrect ? "rgba(30, 142, 79, 0.12)" : "var(--bg-surface)",
        }}
      >
        {isCorrect ? "✓" : OPTION_LABELS[index]}
      </button>

      <div
        {...attributes}
        {...listeners}
        title="Drag to reorder"
        className="absolute right-0 top-0 flex h-11 w-11 cursor-grab items-center justify-center rounded-tr-button rounded-bl-dropdown text-text-primary opacity-0 transition-opacity hover:bg-bg-surface group-hover:opacity-100 active:cursor-grabbing"
      >
        <GripIcon size={20} />
      </div>

      <ContainerClearButtons
        slideId={slideId}
        containerId={option.id}
        hasText={option.text !== ""}
        hasElements={boundElements.length > 0}
        onClearText={() => updateOption(slideId, option.id, "", "")}
        className="right-11 top-1"
      />

      <div className="h-full w-full">
        <EditableText
          text={option.text}
          html={option.html}
          onChange={(text, html) => updateOption(slideId, option.id, text, html)}
          placeholder={`Option ${OPTION_LABELS[index]}`}
          minFontSize={22}
          maxFontSize={44}
          className="text-text-primary"
        />
      </div>

      <div className="pointer-events-none absolute inset-0">
        {boundElements.map((element) => (
          <SvgElementItem
            key={element.id}
            slideId={slideId}
            element={element}
            allElements={boundElements}
            isSelected={selectedElementIds.includes(element.id)}
            bounds={bounds}
          />
        ))}
        <GroupSelectionOverlay slideId={slideId} elements={boundElements} bounds={bounds} />
      </div>
    </div>
  );
}
