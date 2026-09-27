"use client";

import { useState, type ReactNode } from "react";
import type { useSortable } from "@dnd-kit/sortable";
import { useEditorStore } from "@/lib/store";
import { GripIcon } from "@/components/icons/GripIcon";
import { EraserIcon } from "@/components/icons/EraserIcon";
import { MAX_ITEM_COUNT, type Slide, type SlideType } from "@/lib/schema";
import { ANSWER_CONTAINER_ID, canHaveAnswer, getItemCount, hasAnswerContent, hasOptions, hasReveal, isDiscussionSlide } from "@/lib/constants";
import { DuplicateIcon } from "@/components/icons/DuplicateIcon";
import { TrashIcon } from "@/components/icons/TrashIcon";
import { EyeIcon } from "@/components/icons/EyeIcon";
import { ToolPanelButton, PanelLabel } from "./PanelControls";

const LAYOUTS: { value: Slide["layout"]; label: string; icon: ReactNode }[] = [
  { value: "grid", label: "Grid", icon: <GridLayoutIcon /> },
  { value: "list", label: "List", icon: <ListLayoutIcon /> },
  { value: "list-side", label: "List + box", icon: <ListSideLayoutIcon /> },
];

// The Add slide menu, in labeled groups.
const SLIDE_TYPE_GROUPS: { label: string; types: { value: SlideType; label: string; icon: ReactNode }[] }[] = [
  {
    label: "Assessment slide",
    types: [
      { value: "choice", label: "Multiple choice", icon: <ChoiceTypeIcon /> },
      { value: "short-answer", label: "Short answer", icon: <ShortAnswerTypeIcon /> },
      { value: "true-false", label: "True or false", icon: <TrueFalseTypeIcon /> },
      { value: "custom", label: "Custom question", icon: <CustomTypeIcon /> },
    ],
  },
  {
    label: "Discussion",
    types: [
      { value: "title", label: "Title slide", icon: <TitleTypeIcon /> },
      { value: "blank", label: "Blank slide", icon: <BlankTypeIcon /> },
      { value: "video", label: "Embed video", icon: <VideoTypeIcon /> },
      { value: "embed-slides", label: "Embed slides", icon: <EmbedSlidesTypeIcon /> },
      { value: "image", label: "Embed image", icon: <ImageTypeIcon /> },
    ],
  },
];

type DragHandleProps = Pick<ReturnType<typeof useSortable>, "attributes" | "listeners">;

interface SlideToolbarProps {
  slide: Slide;
  // Slide 1, Slide 2… on blank slides, used as their name until they get one.
  slideNumber?: number;
  isFirst: boolean;
  isLast: boolean;
  canDelete: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  dragHandle: DragHandleProps;
}

/** Canva-style per-slide toolbar shown above each slide in the workspace (outside its zoom). */
export function SlideToolbar({ slide, slideNumber, isFirst, isLast, canDelete, onMoveUp, onMoveDown, dragHandle }: SlideToolbarProps) {
  const duplicateSlide = useEditorStore((s) => s.duplicateSlide);
  const shuffleOptions = useEditorStore((s) => s.shuffleOptions);
  const addSlide = useEditorStore((s) => s.addSlide);
  const deleteSlide = useEditorStore((s) => s.deleteSlide);
  const clearSlide = useEditorStore((s) => s.clearSlide);
  const setLayout = useEditorStore((s) => s.setLayout);
  const renameSlide = useEditorStore((s) => s.renameSlide);
  const setItemCount = useEditorStore((s) => s.setItemCount);
  const openAnswer = useEditorStore((s) => s.openAnswer);
  const [isRenaming, setIsRenaming] = useState(false);

  // Blank and title slides hold a reveal; question slides (custom ones too) hold an answer.
  const isReveal = hasReveal(slide);
  const itemCount = getItemCount(slide);
  // Only the slide's name is shown; an unnamed question slide invites one instead.
  const defaultName = isDiscussionSlide(slide) ? `Slide ${slideNumber}` : "Add a name";
  const label = slide.name || defaultName;

  const isChoice = (slide.type ?? "choice") === "choice";
  // Multiple choice and true-or-false slides both get the Layout menu; only multiple choice gets Shuffle.
  const hasCards = hasOptions(slide);
  // Short-answer and blank slides have no options to fill in, so their (always empty) options pass this check.
  // The answer canvas isn't cleared with the slide, so its elements don't count.
  const isEmpty =
    slide.question === "" &&
    slide.options.every((o) => o.text === "") &&
    slide.elements.every((el) => el.containerId === ANSWER_CONTAINER_ID);

  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1 rounded-dropdown bg-bg-surface px-1.5 py-1.5 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        {isRenaming ? (
          <div className="flex items-center gap-1.5 px-1.5 text-sm font-semibold uppercase tracking-[0.05em] text-text-header">
            <input
              autoFocus
              defaultValue={slide.name ?? ""}
              placeholder={defaultName}
              onBlur={(e) => {
                if (e.target.value.trim() !== (slide.name ?? "")) renameSlide(slide.id, e.target.value);
                setIsRenaming(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  // Put the old name back first, so the blur below saves nothing new.
                  e.currentTarget.value = slide.name ?? "";
                  e.currentTarget.blur();
                }
              }}
              className="w-48 rounded-input border border-border-default bg-bg-page px-2 py-0.5 uppercase outline-none placeholder:text-text-secondary"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsRenaming(true)}
            title="Rename slide"
            className="max-w-[240px] truncate rounded-input px-1.5 py-1 text-sm font-semibold uppercase tracking-[0.05em] text-text-header hover:bg-bg-page"
          >
            {label}
          </button>
        )}
        {slide.type === "custom" && (
          // How many items the slide holds, so it takes that many question numbers (e.g. 11–15).
          <label className="flex items-center gap-1.5 px-1.5 text-xs font-semibold uppercase tracking-[0.05em] text-text-header">
            Items
            <input
              // Saved on blur or Enter; the key resets the box when the count changes elsewhere (undo).
              key={itemCount}
              type="number"
              min={1}
              max={MAX_ITEM_COUNT}
              defaultValue={itemCount}
              title={`How many items this slide holds (1–${MAX_ITEM_COUNT})`}
              onBlur={(e) => {
                const count = Number(e.target.value);
                // An empty or broken number puts the old count back.
                if (e.target.value === "" || !Number.isFinite(count)) e.target.value = String(itemCount);
                else if (count !== itemCount) setItemCount(slide.id, count);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className="h-7 w-14 rounded-input border border-border-default bg-bg-page px-2 text-sm font-normal text-text-primary outline-none focus:border-accent-navy"
            />
          </label>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={() => deleteSlide(slide.id)}
            title="Delete slide"
            className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page hover:text-accent-orange"
          >
            <TrashIcon size={18} />
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {canHaveAnswer(slide) && (
          // Its own pale green button, so the answer stands apart from the slide tools.
          // Same height as the tools box next to it (h-8 button + py-1.5).
          <button
            type="button"
            onClick={() => openAnswer(slide.id)}
            title={
              isReveal
                ? hasAnswerContent(slide) ? "Reveal" : "Add reveal"
                : hasAnswerContent(slide) ? "Answer" : "Add answer"
            }
            className="flex h-11 w-11 items-center justify-center rounded-dropdown bg-[rgba(30,142,79,0.1)] text-accent-green shadow-[0_1px_3px_rgba(0,0,0,0.08)] hover:bg-[rgba(30,142,79,0.18)]"
          >
            {/* Blank and title slides hold a "Reveal" (hint, activity, example), not a correct answer — same eye as present mode. */}
            {isReveal ? <EyeIcon /> : <AnswerIcon />}
          </button>
        )}

        <div className="flex items-center gap-1 rounded-dropdown bg-bg-surface px-1.5 py-1.5 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            title="Move up"
            className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronIcon direction="up" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            title="Move down"
            className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronIcon direction="down" />
          </button>
          {hasCards && (
            <>
              {isChoice && (
                <button
                  type="button"
                  onClick={() => shuffleOptions(slide.id)}
                  title="Shuffle options"
                  className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
                >
                  <ShuffleIcon />
                </button>
              )}
              <ToolPanelButton
                title="Layout"
                panelWidthClassName="w-auto"
                closeOnAnyClick
                icon={LAYOUTS.find((l) => l.value === slide.layout)?.icon}
              >
                <PanelLabel>Layout</PanelLabel>
                {/* Same vertical menu as Add slide; the current layout keeps a filled row. */}
                <div className="-mx-4 flex w-56 flex-col py-1">
                  {LAYOUTS.map((layout) => (
                    <button
                      key={layout.value}
                      type="button"
                      onClick={() => setLayout(slide.id, layout.value)}
                      className={`flex items-center gap-3 whitespace-nowrap px-4 py-2.5 text-sm text-text-primary [&>svg]:h-5 [&>svg]:w-5 ${
                        slide.layout === layout.value ? "bg-bg-page font-semibold" : "hover:bg-bg-page"
                      }`}
                    >
                      {layout.icon}
                      {layout.label}
                    </button>
                  ))}
                </div>
              </ToolPanelButton>
            </>
          )}
          <button
            type="button"
            onClick={() => clearSlide(slide.id)}
            disabled={isEmpty}
            title="Clear slide content"
            className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <EraserIcon size={20} />
          </button>
          <button
            type="button"
            onClick={() => duplicateSlide(slide.id)}
            title="Duplicate slide"
            className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
          >
            <DuplicateIcon size={18} />
          </button>
          <ToolPanelButton
            title="Add slide after"
            panelWidthClassName="w-auto"
            closeOnAnyClick
            icon={<PlusIcon />}
          >
            {/* Vertical menu (icon left, label right); -mx-4 lets the row hover reach the panel edges. */}
            <div className="-mx-4 flex w-56 flex-col">
              {SLIDE_TYPE_GROUPS.map((group, groupIndex) => (
                // A thin line splits each group from the one above.
                <div
                  key={group.label}
                  className={`flex flex-col py-1 ${groupIndex > 0 ? "mt-1 border-t border-border-default pt-3" : ""}`}
                >
                  <div className="px-4 pb-1">
                    <PanelLabel>{group.label}</PanelLabel>
                  </div>
                  {group.types.map((slideType) => (
                    <button
                      key={slideType.value}
                      type="button"
                      onClick={() => addSlide(slide.id, slideType.value)}
                      className="flex items-center gap-3 whitespace-nowrap px-4 py-2.5 text-sm text-text-primary hover:bg-bg-page"
                    >
                      {slideType.icon}
                      {slideType.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </ToolPanelButton>
          <button
            type="button"
            {...dragHandle.attributes}
            {...dragHandle.listeners}
            title="Drag to reorder"
            className="flex h-8 w-8 cursor-grab items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page active:cursor-grabbing"
          >
            <GripIcon size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function ChevronIcon({ direction }: { direction: "up" | "down" }) {
  const d = direction === "up" ? "M4 10L9 5L14 10" : "M4 8L9 13L14 8";
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShuffleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.15">
      <path
        d="M1.5 3.5h2c1.5 0 2.5.8 3.2 2l.6 1c.7 1.2 1.7 2 3.2 2h2M1.5 10.5h2c1.5 0 2.5-.8 3.2-2M8 5.5c.6-1.2 1.6-2 3-2h1.5M11 1.5l2 2-2 2M11 8.5l2 2-2 2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// The three layout icons share one rounded frame; only the thin inner lines differ.
function LayoutFrameIcon({ lines }: { lines: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d={lines} strokeLinecap="round" />
    </svg>
  );
}

function GridLayoutIcon() {
  return <LayoutFrameIcon lines="M12 3v18M3 12h18" />;
}

function ListLayoutIcon() {
  return <LayoutFrameIcon lines="M3 9h18M3 15h18" />;
}

function ListSideLayoutIcon() {
  return <LayoutFrameIcon lines="M14 3v18M3 9h11M3 15h11" />;
}

// Sized for the Add slide menu rows (1.05 in a 14-unit box ≈ 1.5px line at 20px).
function ChoiceTypeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.05">
      <circle cx="3" cy="3.5" r="1.3" />
      <circle cx="3" cy="10.5" r="1.3" />
      <path d="M6 3.5H12.5M6 10.5H12.5" strokeLinecap="round" />
    </svg>
  );
}

function ShortAnswerTypeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.05">
      <rect x="1.5" y="4" width="11" height="6" rx="1.2" />
      <path d="M4 5.8V8.2" strokeLinecap="round" />
    </svg>
  );
}

function TrueFalseTypeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.05">
      <path d="M1.5 7.2L3.4 9L6.3 5.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.3 5L12.3 9M12.3 5L8.3 9" strokeLinecap="round" />
    </svg>
  );
}

function BlankTypeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.05">
      <rect x="1.5" y="2.5" width="11" height="7.5" rx="1.2" />
      <path d="M7 10V12.5M4.5 12.5H9.5M4 5H8M4 7H6.5" strokeLinecap="round" />
    </svg>
  );
}

function CustomTypeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.05">
      <path d="M12.5 6V3.7C12.5 3 12 2.5 11.3 2.5H2.7C2 2.5 1.5 3 1.5 3.7V9.3C1.5 10 2 10.5 2.7 10.5H6" strokeLinecap="round" />
      <path d="M8.2 12L8.6 10.4L11.9 7.1C12.3 6.7 12.9 6.7 13.2 7.1C13.6 7.4 13.6 8 13.2 8.4L9.9 11.7L8.2 12Z" strokeLinejoin="round" />
    </svg>
  );
}

function EmbedSlidesTypeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.05">
      <rect x="3.5" y="1.5" width="9" height="7" rx="1" />
      <path d="M1.5 4.5V10.5C1.5 11.05 1.95 11.5 2.5 11.5H9.5" strokeLinecap="round" />
    </svg>
  );
}

function ImageTypeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.05" strokeLinejoin="round">
      <rect x="1.5" y="2.5" width="11" height="9" rx="1.2" />
      <circle cx="4.9" cy="5.4" r="1" />
      <path d="M1.8 10.2L5 7L7.4 9.4L9.2 7.6L12.2 10.6" />
    </svg>
  );
}

function VideoTypeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.05">
      <rect x="1.5" y="2.5" width="11" height="9" rx="1.2" />
      <path d="M5.8 5.2V8.8L8.8 7L5.8 5.2Z" strokeLinejoin="round" />
    </svg>
  );
}

function TitleTypeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.05">
      <rect x="1.5" y="2.5" width="11" height="9" rx="1.2" />
      <path d="M4.5 6H9.5M5.5 8.5H8.5" strokeLinecap="round" />
    </svg>
  );
}

function AnswerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M2.5 7.4L5.6 10.4L11.5 3.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M7 2.5V11.5M2.5 7H11.5" strokeLinecap="round" />
    </svg>
  );
}
