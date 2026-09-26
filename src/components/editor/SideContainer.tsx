"use client";

import { useEditorStore, selectedIdsOn } from "@/lib/store";
import { SIDE_CONTAINER_ID, getContainerBounds, getShapeStripHeight, hasShapeStrip } from "@/lib/constants";
import { useElementDropTarget } from "@/lib/useElementDropTarget";
import { SvgElementItem } from "./SvgElementItem";
import { toCssBackground } from "./ElementSvg";
import { GroupSelectionOverlay } from "./GroupSelectionOverlay";
import { SnapGuides } from "./SnapGuides";
import { ContainerClearButton } from "./ContainerClearButton";
import { ResizeHandle } from "./ResizeHandle";
import { CloseIcon } from "@/components/icons/CloseIcon";
import type { Slide } from "@/lib/schema";

/**
 * The elements-only shape box: to the right of the option rows in the "list-side" layout, a
 * full-width strip between the question and the options in grid/list, or the big middle area of
 * a short-answer slide.
 */
export function SideContainer({ slide }: { slide: Slide }) {
  const removeShapeBox = useEditorStore((s) => s.removeShapeBox);
  const setShapeStripHeight = useEditorStore((s) => s.setShapeStripHeight);
  const selectedElementIds = useEditorStore(selectedIdsOn(slide.id));
  // Every slide's side box shares the same id, so also check this is the slide being edited.
  // Only yes/no values, so a click elsewhere doesn't redraw this box.
  const isContainerSelected = useEditorStore(
    (s) => s.selectedSlideId === slide.id && s.selectedContainerId === SIDE_CONTAINER_ID
  );
  const isElementDragOver = useEditorStore(
    (s) => s.selectedSlideId === slide.id && s.dragOverContainerId === SIDE_CONTAINER_ID
  );
  const selectContainer = useEditorStore((s) => s.selectContainer);

  const { isDragOver, dropHandlers } = useElementDropTarget(slide.id, SIDE_CONTAINER_ID);

  const isSelected = isContainerSelected || isDragOver || isElementDragOver;
  const boundElements = slide.elements.filter((el) => el.containerId === SIDE_CONTAINER_ID);
  const bounds = getContainerBounds(SIDE_CONTAINER_ID, slide);
  const isStrip = hasShapeStrip(slide);

  return (
    <div
      data-container-id={SIDE_CONTAINER_ID}
      onClick={() => selectContainer(SIDE_CONTAINER_ID, slide.id)}
      {...dropHandlers}
      // Without a border in fullscreen, the editor shows a dashed one so the box can still be found.
      className={`group/box relative rounded-button border transition-colors ${slide.shapeBoxBorder || isSelected ? "" : "border-dashed"} ${isStrip ? "-my-[14px] shrink-0" : "min-h-0 flex-1"}`}
      style={{
        height: isStrip ? getShapeStripHeight(slide) : undefined,
        borderColor: isSelected ? "var(--accent-navy)" : (slide.shapeBoxBorder ?? "var(--border-default)"),
        background: isDragOver || isElementDragOver ? "rgba(25, 26, 44, 0.08)" : slide.shapeBoxFill ? toCssBackground(slide.shapeBoxFill) : "transparent",
      }}
    >
      {boundElements.length === 0 && (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-2xl text-text-secondary">
          Drag elements here
        </p>
      )}

      {/* Matches SIDE_PADDING: inset-4 beside the list rows and on short-answer slides, none in the strip. */}
      <div data-element-layer className={`pointer-events-none absolute ${isStrip ? "inset-0" : "inset-4"}`}>
        {boundElements.map((element) => (
          <SvgElementItem
            key={element.id}
            slideId={slide.id}
            element={element}
            isSelected={selectedElementIds.includes(element.id)}
            bounds={bounds}
          />
        ))}
        <GroupSelectionOverlay slideId={slide.id} elements={boundElements} bounds={bounds} />
        <SnapGuides slideId={slide.id} containerId={SIDE_CONTAINER_ID} />
      </div>

      <ContainerClearButton
        slideId={slide.id}
        containerId={SIDE_CONTAINER_ID}
        hasElements={boundElements.length > 0}
        className={`absolute ${isStrip ? "right-14 top-1" : "right-1 top-1"}`}
        large
      />

      {isStrip && (
        <button
          type="button"
          title="Remove box"
          onClick={(e) => {
            // Keep the click from also selecting the box that's about to go away.
            e.stopPropagation();
            removeShapeBox(slide.id);
          }}
          className="absolute right-1 top-1 z-10 flex h-12 w-12 items-center justify-center rounded-dropdown text-text-primary opacity-0 transition-opacity hover:bg-bg-surface group-hover/box:opacity-100"
        >
          <CloseIcon size={28} />
        </button>
      )}

      {/* Only the strip can be resized; the other shape boxes fill whatever room is left. */}
      {isStrip && (
        <ResizeHandle height={getShapeStripHeight(slide)} onResize={(height) => setShapeStripHeight(slide.id, height)} />
      )}
    </div>
  );
}
