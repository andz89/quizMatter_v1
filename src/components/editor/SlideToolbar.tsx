"use client";

import { useState, type ReactNode } from "react";
import type { useSortable } from "@dnd-kit/sortable";
import { useEditorStore } from "@/lib/store";
import { GripIcon } from "@/components/icons/GripIcon";
import { EraserIcon } from "@/components/icons/EraserIcon";
import type { Slide, SlideType } from "@/lib/schema";
import { DuplicateIcon } from "@/components/icons/DuplicateIcon";
import { TrashIcon } from "@/components/icons/TrashIcon";
import { ToolPanelButton, PanelLabel } from "./PanelControls";
import { AnswerModal } from "./AnswerModal";

const LAYOUTS: { value: Slide["layout"]; label: string; icon: ReactNode }[] = [
  { value: "grid", label: "Grid", icon: <GridLayoutIcon /> },
  { value: "list", label: "List", icon: <ListLayoutIcon /> },
  { value: "list-side", label: "List + box", icon: <ListSideLayoutIcon /> },
];

const SLIDE_TYPES: { value: SlideType; label: string; icon: ReactNode }[] = [
  { value: "choice", label: "Multiple choice", icon: <ChoiceTypeIcon /> },
  { value: "short-answer", label: "Short answer", icon: <ShortAnswerTypeIcon /> },
  { value: "lesson", label: "Blank slide", icon: <LessonTypeIcon /> },
];

type DragHandleProps = Pick<ReturnType<typeof useSortable>, "attributes" | "listeners">;

interface SlideToolbarProps {
  slide: Slide;
  // Q1, Q2… on question slides; Slide 1, Slide 2… on blank slides (each type counted separately).
  slideNumber: number;
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
  const updateCorrectAnswer = useEditorStore((s) => s.updateCorrectAnswer);
  const renameSlide = useEditorStore((s) => s.renameSlide);
  const [isAnswerOpen, setIsAnswerOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);

  const isBlank = slide.type === "lesson";
  // Question slides keep their number in front of the name; blank slides show the name alone.
  const prefix = isBlank ? "" : `Q${slideNumber}`;
  const defaultName = isBlank ? `Slide ${slideNumber}` : "";
  const label = isBlank ? slide.name || defaultName : slide.name ? `${prefix} · ${slide.name}` : prefix;

  const isShortAnswer = slide.type === "short-answer";
  const isChoice = (slide.type ?? "choice") === "choice";
  // Short-answer and lesson slides have no options to fill in, so their (always empty) options pass this check.
  const isEmpty = slide.question === "" && slide.options.every((o) => o.text === "") && slide.elements.length === 0;

  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1 rounded-dropdown bg-bg-surface px-1.5 py-1.5 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        {isRenaming ? (
          <div className="flex items-center gap-1.5 px-1.5 text-sm font-semibold uppercase tracking-[0.05em] text-text-header">
            {prefix && <span>{prefix} ·</span>}
            <input
              autoFocus
              defaultValue={slide.name ?? ""}
              placeholder={defaultName || "Add a name"}
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
        {isShortAnswer && (
          // Its own pale-green pill, so the answer stands apart from the slide tools.
          <div
            className="flex items-center rounded-dropdown px-1.5 py-1.5 shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
            style={{ background: "rgba(30, 142, 79, 0.1)" }}
          >
            <button
              type="button"
              onClick={() => setIsAnswerOpen(true)}
              title="Correct answer"
              className="flex h-8 items-center gap-2 rounded-dropdown px-2.5 text-sm font-semibold text-accent-green hover:bg-[rgba(30,142,79,0.1)]"
            >
              <AnswerIcon />
              {/* "Add answer" until one is typed, so slides still missing one stand out. */}
              {slide.correctAnswer ? "Answer" : "Add answer"}
            </button>
          </div>
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
          {isChoice && (
            <>
              <button
                type="button"
                onClick={() => shuffleOptions(slide.id)}
                title="Shuffle options"
                className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
              >
                <ShuffleIcon />
              </button>
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
          {isAnswerOpen && (
            <AnswerModal
              answer={slide.correctAnswer ?? ""}
              onChange={(answer) => updateCorrectAnswer(slide.id, answer)}
              onClose={() => setIsAnswerOpen(false)}
            />
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
            <PanelLabel>Add slide</PanelLabel>
            {/* Vertical menu (icon left, label right); -mx-4 lets the row hover reach the panel edges. */}
            <div className="-mx-4 flex w-56 flex-col py-1">
              {SLIDE_TYPES.map((slideType) => (
                <button
                  key={slideType.value}
                  type="button"
                  onClick={() => addSlide(slide.id, slideType.value)}
                  // A thin line above "Blank slide" splits it from the question types.
                  className={`flex items-center gap-3 whitespace-nowrap px-4 py-2.5 text-sm text-text-primary hover:bg-bg-page ${
                    slideType.value === "lesson" ? "mt-1 border-t border-border-default pt-3.5" : ""
                  }`}
                >
                  {slideType.icon}
                  {slideType.label}
                </button>
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

function LessonTypeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.05">
      <rect x="1.5" y="2.5" width="11" height="7.5" rx="1.2" />
      <path d="M7 10V12.5M4.5 12.5H9.5M4 5H8M4 7H6.5" strokeLinecap="round" />
    </svg>
  );
}

function AnswerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.15">
      <rect x="1.5" y="1.5" width="11" height="11" rx="2.5" />
      <path d="M4.5 7.2L6.3 9L9.7 5.2" strokeLinecap="round" strokeLinejoin="round" />
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
