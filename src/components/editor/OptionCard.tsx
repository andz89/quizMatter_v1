"use client";

import { useSortable } from "@dnd-kit/sortable";
import { useEditorStore, selectedIdsOn } from "@/lib/store";
import { OPTION_FONT_SIZE, OPTION_LABELS, getContainerBounds, type BoxLayout } from "@/lib/constants";
import { useElementDropTarget } from "@/lib/useElementDropTarget";
import { EditableText } from "./EditableText";
import { GripIcon } from "@/components/icons/GripIcon";
import { SvgElementItem } from "./SvgElementItem";
import { GroupSelectionOverlay } from "./GroupSelectionOverlay";
import { SnapGuides } from "./SnapGuides";
import type { Option, SvgElement } from "@/lib/schema";

interface OptionCardProps {
  slideId: string;
  option: Option;
  index: number;
  isCorrect: boolean;
  elements: SvgElement[];
  // The slide's box sizes (question height, layout, shape strip).
  box: BoxLayout;
}

export function OptionCard({ slideId, option, index, isCorrect, elements, box }: OptionCardProps) {
  const updateOption = useEditorStore((s) => s.updateOption);
  const setCorrectOption = useEditorStore((s) => s.setCorrectOption);
  const zoom = useEditorStore((s) => s.zoom);
  // Only this box's own yes/no, so a click on another box doesn't redraw this one.
  const isContainerSelected = useEditorStore((s) => s.selectedContainerIds.includes(option.id));
  const selectedElementIds = useEditorStore(selectedIdsOn(slideId));
  const selectContainer = useEditorStore((s) => s.selectContainer);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: option.id });
  const { isDragOver, dropHandlers } = useElementDropTarget(slideId, option.id);
  const isElementDragOver = useEditorStore((s) => s.dragOverContainerId === option.id);

  const isSelectedContainer = isContainerSelected || isDragOver || isElementDragOver;
  const boundElements = elements.filter((el) => el.containerId === option.id);
  const bounds = getContainerBounds(option.id, box);

  // dnd-kit computes the drag offset in raw screen pixels, but this card sits inside
  // the canvas's CSS `zoom` ancestor — so the offset has to be un-scaled here, or the
  // card drifts away from the cursor whenever the canvas isn't at exactly 100% zoom.
  const dragTransform = transform
    ? `translate3d(${transform.x / zoom}px, ${transform.y / zoom}px, 0) scaleX(${transform.scaleX ?? 1}) scaleY(${transform.scaleY ?? 1})`
    : undefined;

  // No border or fill by default — only while selected or while something is dragged onto it.
  const borderColor = isSelectedContainer ? "var(--accent-navy)" : "transparent";
  const background = isDragOver || isElementDragOver ? "rgba(25, 26, 44, 0.08)" : undefined;

  return (
    <div
      ref={setNodeRef}
      data-container-id={option.id}
      // Shift+click selects more boxes, to change their text together.
      onClick={(e) => selectContainer(option.id, slideId, e.shiftKey)}
      {...dropHandlers}
      className="group group/box relative rounded-button border p-[5px] transition-colors"
      style={{
        borderColor,
        background,
        transform: dragTransform,
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      {/* Outside the card on its left, near the top (top-2.5 = 10px down): the drag handle, lined up with the label (h-10).
          Reaches the card's edge (the right padding is padding, not a gap), so moving the mouse onto it
          keeps the card hovered. It sits behind the ✓/A label (pr-12 = the label's width + gap), in the
          slide's margin or the grid's wide column gap. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute right-full top-4 z-10 flex h-10 items-center pr-12"
      >
        <div
          {...attributes}
          {...listeners}
          title="Drag to reorder"
          className="flex h-7 w-9 cursor-grab items-center justify-center rounded-dropdown text-text-primary opacity-0 transition-opacity hover:bg-bg-surface group-hover/box:opacity-100 active:cursor-grabbing"
        >
          <GripIcon size={14} />
        </div>
      </div>

      {/* The ✓/A button, just outside the card on its left, 10px below its top. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setCorrectOption(slideId, option.id);
        }}
        title="Mark as correct answer"
        className="absolute right-full top-4 z-20 mr-2 flex h-10 w-10 items-center justify-center rounded-full border-2 bg-white text-lg font-bold transition-colors"
        style={{
          borderColor: isCorrect ? "var(--accent-green)" : "var(--border-default)",
          color: isCorrect ? "var(--accent-green)" : "#000000",
        }}
      >
        {isCorrect ? "✓" : OPTION_LABELS[index]}
      </button>

      <div className="h-full w-full">
        <EditableText
          text={option.text}
          html={option.html}
          onChange={(text, html) => updateOption(slideId, option.id, text, html)}
          // An option that's just a picture needs no hint, which would only sit behind the picture.
          placeholder={boundElements.length ? "" : `Option ${OPTION_LABELS[index]}`}
          target={{ kind: "option", slideId, optionId: option.id }}
          fontSize={option.fontSize ?? OPTION_FONT_SIZE}
          isSelected={isContainerSelected}
          className="text-text-primary"
        />
      </div>

      <div data-element-layer className="pointer-events-none absolute inset-0">
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
        <SnapGuides slideId={slideId} containerId={option.id} />
      </div>
    </div>
  );
}
