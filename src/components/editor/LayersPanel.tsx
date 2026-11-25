"use client";

import { memo, useCallback, useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { useEditorStore, isPanelEscape } from "@/lib/store";
import { CUSTOM_SVG_ID, PHOTO_ID, getElementAsset } from "@/lib/svgLibrary";
import { isEmbedSlide } from "@/lib/embed";
import { shownLayerBoxes, type LayerItem } from "@/lib/layers";
import type { SvgElement } from "@/lib/schema";
import { PanelLabel } from "./PanelControls";
import { ElementSvg } from "./ElementSvg";
import { ChevronRightIcon, GroupIcon, TableIcon, TypeIcon, XIcon } from "lucide-react";

// What a dragged row carries: the elements it moves, and the element a drop on it lands next to.
type RowData = { movingIds: string[]; targetId: string };

// A row only ever lands among its own list (a box, or one open group): rows of other lists aren't drop targets,
// so a drag near the edge of the next box still finds the nearest row of its own.
const sameListOnly: CollisionDetection = (args) => {
  const list = args.active.data.current?.sortable?.containerId;
  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter((c) => c.data.current?.sortable?.containerId === list),
  });
};

// Made once: a new one would change the DndContext's values, redrawing every row (see LayersPanel).
const VERTICAL_ONLY = [restrictToVerticalAxis];
const POINTER_OPTIONS = { activationConstraint: { distance: 4 } };

/**
 * Sidebar panel listing the selected slide's elements, box by box, top layer first (like Canva's Layers). Click a
 * row to select it (even one hidden behind another), hover to outline it on the slide, drag to change the order.
 *
 * Speed: this part reads only yes / no facts about the slide, so an edit (like moving an element on the slide)
 * doesn't redraw it or the DndContext: a redrawn DndContext hands every draggable row new values, redrawing all of
 * them. Only `LayerBoxes`, inside it, follows the slide's elements, and its rows are memoized.
 */
// Memoized: Editor redraws on every selection change, which would otherwise redraw this too.
export const LayersPanel = memo(function LayersPanel() {
  const closeLayersPanel = useEditorStore((s) => s.closeLayersPanel);
  const reorderLayers = useEditorStore((s) => s.reorderLayers);
  const setHoveredLayerIds = useEditorStore((s) => s.setHoveredLayerIds);
  const slideId = useEditorStore((s) => s.selectedSlideId);
  // A hidden slide is locked (nothing on it can change or be picked) until it's shown again.
  const isHidden = useEditorStore((s) => !!s.presentation.slides.find((slide) => slide.id === slideId)?.hidden);
  const isEmbed = useEditorStore((s) => {
    const slide = s.presentation.slides.find((slide) => slide.id === slideId);
    return !!slide && isEmbedSlide(slide);
  });
  // Which groups are open, showing their members.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const sensors = useSensors(useSensor(PointerSensor, POINTER_OPTIONS));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isPanelEscape(e)) closeLayersPanel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeLayersPanel]);

  // The outline goes when the panel closes (also by switching panels).
  useEffect(() => () => setHoveredLayerIds([]), [setHoveredLayerIds]);

  const toggleGroup = useCallback(
    (groupId: string) =>
      setOpenGroups((open) => {
        const next = new Set(open);
        if (!next.delete(groupId)) next.add(groupId);
        return next;
      }),
    []
  );

  // A row dropped on another row of its list goes just past it.
  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      const from = active.data.current?.sortable;
      const to = over?.data.current?.sortable;
      if (!slideId || !over || !from || !to || active.id === over.id || from.containerId !== to.containerId) return;
      const { movingIds } = active.data.current as RowData;
      const { targetId } = over.data.current as RowData;
      // The list is top layer first, so moving down the list = below the target.
      reorderLayers(slideId, movingIds, targetId, from.index < to.index ? "below" : "above");
    },
    [slideId, reorderLayers]
  );

  const note = isHidden
    ? "This slide is hidden. Show it again to see and change its layers."
    : isEmbed
      ? "This slide shows only its video or slides, so it has no layers."
      : null;

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

      {note ? (
        <p className="text-sm text-text-secondary">{note}</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={sameListOnly} modifiers={VERTICAL_ONLY} onDragEnd={handleDragEnd}>
          <LayerBoxes slideId={slideId} openGroups={openGroups} onToggle={toggleGroup} />
        </DndContext>
      )}
    </div>
  );
});

/** The slide's boxes and their rows: the only part that follows the slide's elements. */
function LayerBoxes({ slideId, openGroups, onToggle }: { slideId: string; openGroups: Set<string>; onToggle: (groupId: string) => void }) {
  const slide = useEditorStore((s) => s.presentation.slides.find((slide) => slide.id === slideId));
  const boxes = useMemo(() => (slide ? shownLayerBoxes(slide) : []), [slide]);
  if (boxes.length === 0) {
    return <p className="text-sm text-text-secondary">Nothing on this slide yet. Add elements or photos, and they show here.</p>;
  }
  return boxes.map((box) => (
    <section key={box.containerId ?? "slide"} className="flex flex-col gap-2">
      <PanelLabel>{box.name}</PanelLabel>
      <BoxRows slideId={slideId} items={box.items} openGroups={openGroups} onToggle={onToggle} />
    </section>
  ));
}

function itemKey(item: LayerItem) {
  return item.kind === "element" ? item.element.id : `group:${item.groupId}`;
}

/**
 * The same array back while the ids are the same. A new `items` array makes @dnd-kit's SortableContext hand every
 * row a new context, which redraws all of them (memo or not): with 1,000 elements, each move of an element on the
 * slide redrew the whole list.
 */
function useSameIds(ids: string[]) {
  // Ids never hold a line break, so the joined text changes exactly when the list does.
  const joined = ids.join("\n");
  return useMemo(() => joined.split("\n"), [joined]);
}

interface BoxRowsProps {
  slideId: string;
  items: LayerItem[];
  openGroups: Set<string>;
  onToggle: (groupId: string) => void;
}

/** One box's rows: a sortable list of its elements and groups. */
const BoxRows = memo(function BoxRows({ slideId, items, openGroups, onToggle }: BoxRowsProps) {
  const keys = useSameIds(items.map(itemKey));
  return (
    <SortableContext items={keys} strategy={verticalListSortingStrategy}>
      <ul className="flex flex-col gap-1">
        {items.map((item) =>
          item.kind === "element" ? (
            <ElementRow key={itemKey(item)} slideId={slideId} element={item.element} />
          ) : (
            <GroupRow
              key={itemKey(item)}
              slideId={slideId}
              groupId={item.groupId}
              members={item.members}
              isOpen={openGroups.has(item.groupId)}
              onToggle={onToggle}
            />
          )
        )}
      </ul>
    </SortableContext>
  );
});

/** A row's name: a text box's first words, else what the element is. */
function elementName(element: SvgElement) {
  const asset = getElementAsset(element.assetId);
  if (asset?.isTextBox) {
    const text = new DOMParser().parseFromString(element.text?.html ?? "", "text/html").body.textContent?.trim() ?? "";
    // By whole characters, so an emoji isn't cut in two.
    return text ? Array.from(text).slice(0, 40).join("") : "Text box";
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
  const isWide = element.width >= element.height;
  return (
    <span className="flex h-full w-full items-center justify-center p-1">
      <span
        className="block max-h-full max-w-full"
        style={{ aspectRatio: `${element.width} / ${element.height}`, width: isWide ? "100%" : "auto", height: isWide ? "auto" : "100%" }}
      >
        <ElementSvg assetId={element.assetId} color={element.color} settings={element} />
      </span>
    </span>
  );
}

const ElementRow = memo(function ElementRow({ slideId, element, indent }: { slideId: string; element: SvgElement; indent?: boolean }) {
  const selectElement = useEditorStore((s) => s.selectElement);
  const selectElements = useEditorStore((s) => s.selectElements);
  // The row is memoized, so this (a text box reads its HTML) runs only when this element changed.
  const name = elementName(element);
  const ids = [element.id];
  // A group member is picked on its own, like a double-click on the slide.
  const onSelect = (additive: boolean) => {
    if (additive) selectElement(slideId, element.id, true);
    else if (element.groupId) selectElements([element.id]);
    else selectElement(slideId, element.id);
  };
  return (
    <LayerRow
      slideId={slideId}
      id={element.id}
      data={{ movingIds: ids, targetId: element.id }}
      elementIds={ids}
      name={name}
      picture={<ElementPicture element={element} />}
      indent={indent}
      onSelect={onSelect}
    />
  );
});

interface GroupRowProps {
  slideId: string;
  groupId: string;
  members: SvgElement[];
  isOpen: boolean;
  onToggle: (groupId: string) => void;
}

// The members list is new each time the rows are built: the row redraws only when a member itself changed.
const sameMembers = (a: GroupRowProps, b: GroupRowProps) =>
  a.slideId === b.slideId &&
  a.groupId === b.groupId &&
  a.isOpen === b.isOpen &&
  a.onToggle === b.onToggle &&
  a.members.length === b.members.length &&
  a.members.every((el, i) => el === b.members[i]);

const GroupRow = memo(function GroupRow({ slideId, groupId, members, isOpen, onToggle }: GroupRowProps) {
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
          onSelect={(additive) => selectElement(slideId, ids[0], additive)}
          toggle={
            <button
              type="button"
              title={isOpen ? "Hide the group's items" : "Show the group's items"}
              aria-expanded={isOpen}
              onClick={(e) => {
                e.stopPropagation();
                onToggle(groupId);
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
}, sameMembers);

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
  // additive: Shift / Ctrl / Cmd was held.
  onSelect: (additive: boolean) => void;
}

/** One draggable row: a small picture and a name. Enter or Space picks it, like a click. */
function LayerRow({ slideId, id, data, elementIds, name, picture, indent, toggle, onSelect }: LayerRowProps) {
  const setHoveredLayerIds = useEditorStore((s) => s.setHoveredLayerIds);
  // A yes / no, so a selection change redraws only the rows it turns on or off.
  const isSelected = useEditorStore(
    (s) => s.selectedSlideId === slideId && elementIds.every((elId) => s.selectedElementIds.includes(elId))
  );
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, data });

  const handleKeyDown = (e: ReactKeyboardEvent) => {
    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    onSelect(e.shiftKey || e.ctrlKey || e.metaKey);
  };

  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={(e: MouseEvent) => onSelect(e.shiftKey || e.ctrlKey || e.metaKey)}
      onKeyDown={handleKeyDown}
      onPointerEnter={() => setHoveredLayerIds(elementIds)}
      onPointerLeave={() => setHoveredLayerIds([])}
      title={name}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      // content-visibility: a long list (up to 1,000 elements) skips drawing the rows scrolled out of sight.
      className={`relative flex h-11 shrink-0 cursor-grab items-center gap-2.5 rounded-dropdown border px-2 text-sm [contain-intrinsic-size:auto_44px] [content-visibility:auto] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:cursor-grabbing ${
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
