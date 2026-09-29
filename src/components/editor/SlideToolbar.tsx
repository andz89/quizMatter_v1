"use client";

import { useState, type ReactNode } from "react";
import type { useSortable } from "@dnd-kit/sortable";
import { useEditorStore } from "@/lib/store";
import { MAX_ITEM_COUNT, type Slide } from "@/lib/schema";
import { ANSWER_CONTAINER_ID, canHaveAnswer, getItemCount, hasAnswerContent, hasOptions, hasReveal, isDiscussionSlide } from "@/lib/constants";
import { ToolPanelButton, PanelLabel } from "./PanelControls";
import { AddSlideMenu } from "./AddSlideMenu";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, CopyIcon, EraserIcon, EyeIcon, Grid2x2Icon, GripVerticalIcon, PanelRightIcon, PlusIcon, Rows3Icon, ShuffleIcon, Trash2Icon } from "lucide-react";

const LAYOUTS: { value: Slide["layout"]; label: string; icon: ReactNode }[] = [
  { value: "grid", label: "Grid", icon: <Grid2x2Icon size={18} /> },
  { value: "list", label: "List", icon: <Rows3Icon size={18} /> },
  { value: "list-side", label: "List + box", icon: <PanelRightIcon size={18} /> },
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
              className="h-7 w-14 rounded-input border border-border-default bg-bg-page px-2 text-sm font-normal text-text-primary outline-none focus:border-accent"
            />
          </label>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={() => deleteSlide(slide.id)}
            title="Delete slide"
            className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page hover:text-danger"
          >
            <Trash2Icon size={18} />
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
            className="flex h-11 w-11 items-center justify-center rounded-dropdown bg-success-soft text-success-strong hover:bg-success/25"
          >
            {/* Blank and title slides hold a "Reveal" (hint, activity, example), not a correct answer — same eye as present mode. */}
            {isReveal ? <EyeIcon size={18} /> : <CheckIcon size={18} />}
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
            <ChevronUpIcon size={18} />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            title="Move down"
            className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronDownIcon size={18} />
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
                  <ShuffleIcon size={18} />
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
            <CopyIcon size={18} />
          </button>
          <ToolPanelButton
            title="Add slide after"
            panelWidthClassName="w-auto"
            closeOnAnyClick
            icon={<PlusIcon size={18} />}
          >
            <AddSlideMenu onPick={(type) => addSlide(slide.id, type)} />
          </ToolPanelButton>
          <button
            type="button"
            {...dragHandle.attributes}
            {...dragHandle.listeners}
            title="Drag to reorder"
            className="flex h-8 w-8 cursor-grab items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page active:cursor-grabbing"
          >
            <GripVerticalIcon size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
