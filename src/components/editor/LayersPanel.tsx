"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { useEditorStore, isPanelEscape, selectedIdsOn } from "@/lib/store";
import { ANSWER_CONTAINER_ID, QUESTION_CONTAINER_ID, SIDE_CONTAINER_ID, getShownOptions } from "@/lib/constants";
import { CUSTOM_SVG_ID, PHOTO_ID, getElementAsset } from "@/lib/svgLibrary";
import { layerBoxes, type LayerItem } from "@/lib/layers";
import type { Slide, SvgElement } from "@/lib/schema";
import { PanelLabel } from "./PanelControls";
import { ElementSvg } from "./ElementSvg";
import { ChevronRightIcon, GroupIcon, TableIcon, TypeIcon, XIcon } from "lucide-react";

// What a dragged row carries: the elements it moves, and the element a drop on it lands next to.
type RowData = { movingIds: string[]; targetId: string };

/**
 * Sidebar panel listing the selected slide's elements, box by box, top layer first (like Canva's Layers). Click a
 * row to select it (even one hidden behind another), hover to outline it on the slide, drag to change the order.
 */
export function LayersPanel() {
  const closeLayersPanel = useEditorStore((s) => s.closeLayersPanel);
  const reorderLayers = useEditorStore((s) => s.reorderLayers);
  const setHoveredLayerIds = useEditorStore((s) => s.setHoveredLayerIds);
  const slide = useEditorStore((s) => s.presentation.slides.find((slide) => slide.id === s.selectedSlideId));
  // Which groups are open, showing their members.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isPanelEscape(e)) closeLayersPanel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeLayersPanel]);

  // The outline goes when the panel closes (also by switching panels).
  useEffect(() => () => setHoveredLayerIds([]), [setHoveredLayerIds]);

  if (!slide) return null;
  const boxes = layerBoxes(slide.elements);

  const toggleGroup = (groupId: string) =>
    setOpenGroups((open) => {
      const next = new Set(open);
      if (!next.delete(groupId)) next.add(groupId);
      return next;
    });

  // A row dropped on another row of the same list (a box, or one open group) goes just past it.
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const from = active.data.current?.sortable;
    const to = over?.data.current?.sortable;
    if (!over || !from || !to || active.id === over.id || from.containerId !== to.containerId) return;
    const { movingIds } = active.data.current as RowData;
    const { targetId } = over.data.current as RowData;
    // The list is top layer first, so moving down the list = below the target.
    reorderLayers(slide.id, movingIds, targetId, from.index < to.index ? "below" : "above");
  };

  return (
    <div
      data-keep-container-selection="true"
      className="flex shrink-0 flex-col gap-5 overflow-y-auto border-r border-border-default bg-bg-surface side-panel"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-extrabold text-text-primary">Layers</h2>
        <button
          type="button"
          onClick={closeLayersPanel}
          title="Close (Esc)"
          className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
        >
          <XIcon size={16} />
        </button>
      </div>

      {boxes.length === 0 ? (
        <p className="text-sm text-text-secondary">Nothing on this slide yet. Add elements or photos, and they show here.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={handleDragEnd}>
          {boxes.map((box) => (
            <section key={box.containerId ?? "slide"} className="flex flex-col gap-2">
              <PanelLabel>{boxName(slide, box.containerId)}</PanelLabel>
              <SortableContext items={box.items.map(itemKey)} strategy={verticalListSortingStrategy}>
                <ul className="flex flex-col gap-1">
                  {box.items.map((item) =>
                    item.kind === "element" ? (
                      <ElementRow key={itemKey(item)} slideId={slide.id} element={item.element} />
                    ) : (
                      <GroupRow
                        key={itemKey(item)}
                        slideId={slide.id}
                        groupId={item.groupId}
                        members={item.members}
                        isOpen={openGroups.has(item.groupId)}
                        onToggle={() => toggleGroup(item.groupId)}
                      />
                    )
                  )}
                </ul>
              </SortableContext>
            </section>
          ))}
        </DndContext>
      )}
    </div>
  );
}

function itemKey(item: LayerItem) {
  return item.kind === "element" ? item.element.id : `group:${item.groupId}`;
}

/** The box's title. Answer boxes are lettered by their place, like on the slide. */
function boxName(slide: Slide, containerId: string | null) {
  if (containerId === null) return "On the slide";
  if (containerId === QUESTION_CONTAINER_ID) return "Question";
  if (containerId === SIDE_CONTAINER_ID) return "Shape box";
  if (containerId === ANSWER_CONTAINER_ID) return "Answer";
  const index = getShownOptions(slide).findIndex((option) => option.id === containerId);
  return index >= 0 ? `Answer ${String.fromCharCode(65 + index)}` : "Answer";
}

/** A row's name: a text box's first words, else what the element is. */
function elementName(element: SvgElement) {
  const asset = getElementAsset(element.assetId);
  if (asset?.isTextBox) {
    const text = new DOMParser().parseFromString(element.text?.html ?? "", "text/html").body.textContent?.trim() ?? "";
    return text ? text.slice(0, 40) : "Text box";
  }
  if (asset?.isTable) return "Table";
  if (element.assetId === PHOTO_ID) return "Photo";
  if (element.assetId === CUSTOM_SVG_ID) return "Drawing";
  return asset?.label ?? "Element";
}

function ElementPicture({ element }: { element: SvgElement }) {
  const asset = getElementAsset(element.assetId);
  if (asset?.isTextBox) return <TypeIcon size={16} />;
  if (asset?.isTable) return <TableIcon size={16} />;
  return (
    <span className="flex h-full w-full items-center justify-center p-1">
      <span className="block" style={{ aspectRatio: `${element.width} / ${element.height}`, maxWidth: "100%", maxHeight: "100%", width: element.width >= element.height ? "100%" : "auto", height: element.width >= element.height ? "auto" : "100%" }}>
        <ElementSvg assetId={element.assetId} color={element.color} settings={element} />
      </span>
    </span>
  );
}

function ElementRow({ slideId, element, indent }: { slideId: string; element: SvgElement; indent?: boolean }) {
  const selectElement = useEditorStore((s) => s.selectElement);
  const selectElements = useEditorStore((s) => s.selectElements);
  // A group member is picked on its own, like a double-click on the slide.
  const onSelect = (e: MouseEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) selectElement(slideId, element.id, true);
    else if (element.groupId) selectElements([element.id]);
    else selectElement(slideId, element.id);
  };
  return (
    <LayerRow
      slideId={slideId}
      id={element.id}
      data={{ movingIds: [element.id], targetId: element.id }}
      elementIds={[element.id]}
      name={elementName(element)}
      picture={<ElementPicture element={element} />}
      indent={indent}
      onSelect={onSelect}
    />
  );
}

interface GroupRowProps {
  slideId: string;
  groupId: string;
  members: SvgElement[];
  isOpen: boolean;
  onToggle: () => void;
}

function GroupRow({ slideId, groupId, members, isOpen, onToggle }: GroupRowProps) {
  const selectElement = useEditorStore((s) => s.selectElement);
  const ids = members.map((el) => el.id);
  return (
    <li className="flex flex-col gap-1">
      <ul>
        <LayerRow
          slideId={slideId}
          id={`group:${groupId}`}
          data={{ movingIds: ids, targetId: ids[0] }}
          elementIds={ids}
          name={`Group · ${members.length} items`}
          picture={<GroupIcon size={16} />}
          // Selecting one member selects the whole group.
          onSelect={(e) => selectElement(slideId, ids[0], e.shiftKey || e.ctrlKey || e.metaKey)}
          toggle={
            <button
              type="button"
              title={isOpen ? "Hide the group's items" : "Show the group's items"}
              aria-expanded={isOpen}
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-dropdown text-text-secondary hover:bg-bg-page hover:text-text-primary"
            >
              <ChevronRightIcon size={14} className={`transition-transform ${isOpen ? "rotate-90" : ""}`} />
            </button>
          }
        />
      </ul>
      {isOpen && (
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-1">
            {members.map((member) => (
              <ElementRow key={member.id} slideId={slideId} element={member} indent />
            ))}
          </ul>
        </SortableContext>
      )}
    </li>
  );
}

interface LayerRowProps {
  slideId: string;
  // The sortable id (an element id, or "group:<id>").
  id: string;
  data: RowData;
  // The elements this row stands for: selected = violet; hovered = outlined on the slide.
  elementIds: string[];
  name: string;
  picture: ReactNode;
  indent?: boolean;
  toggle?: ReactNode;
  onSelect: (e: MouseEvent) => void;
}

/** One draggable row: a small picture and a name. */
function LayerRow({ slideId, id, data, elementIds, name, picture, indent, toggle, onSelect }: LayerRowProps) {
  const setHoveredLayerIds = useEditorStore((s) => s.setHoveredLayerIds);
  const selectedIds = useEditorStore(selectedIdsOn(slideId));
  const isSelected = elementIds.every((elId) => selectedIds.includes(elId));
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, data });

  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onSelect}
      onPointerEnter={() => setHoveredLayerIds(elementIds)}
      onPointerLeave={() => setHoveredLayerIds([])}
      title={name}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`relative flex h-11 cursor-grab items-center gap-2.5 rounded-dropdown border px-2 text-sm active:cursor-grabbing ${
        indent ? "ml-6" : ""
      } ${isSelected ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border-default bg-bg-surface text-text-primary hover:bg-bg-page"} ${
        isDragging ? "z-10 opacity-80" : ""
      }`}
    >
      {toggle}
      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-dropdown border border-border-default bg-bg-surface text-text-primary">
        {picture}
      </span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
    </li>
  );
}
