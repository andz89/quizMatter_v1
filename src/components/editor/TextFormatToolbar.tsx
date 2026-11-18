"use client";

import { useRef, useState } from "react";
import { useEditorState, type ChainedCommands } from "@tiptap/react";
import { useEditorStore, type TextEditorEntry, type TextTarget } from "@/lib/store";
import { formatChain } from "@/lib/richText";
import { DEFAULT_TEXT_COLOR, OPTION_FONT_SIZE, QUESTION_CONTAINER_ID, QUESTION_FONT_SIZE, TABLE_FONT_SIZE, TEXT_BOX_FONT_SIZE } from "@/lib/constants";
import { FONT_SIZE_RANGE, type Presentation } from "@/lib/schema";
import { EraserIcon, TextAlignCenterIcon, TextAlignEndIcon, TextAlignStartIcon } from "lucide-react";

type Align = "left" | "center" | "right";

/**
 * Size / bold / italic / underline / align / color bar, shown in the header while typing in a text,
 * or when question/option boxes are selected (then each button changes all their text). The buttons
 * show the style of the first text.
 */
export function TextFormatToolbar({ texts }: { texts: TextEditorEntry[] }) {
  const isColorPanelOpen = useEditorStore((s) => s.isColorPanelOpen);
  const toggleColorPanel = useEditorStore((s) => s.toggleColorPanel);
  const clearContainerElements = useEditorStore((s) => s.clearContainerElements);
  const targets = texts.map((text) => text.target);
  // The texts all get the same size, stepping from the first one's.
  const fontSize = useEditorStore((s) => chosenFontSize(s.presentation, targets[0]));
  const setTextFontSizes = useEditorStore((s) => s.setTextFontSizes);
  const state = useEditorState({
    editor: texts[0].editor,
    selector: ({ editor }) => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      align: (["left", "center", "right"] as Align[]).find((a) => editor.isActive({ textAlign: a })) ?? "left",
      color: (editor.getAttributes("textStyle").color as string | undefined) ?? DEFAULT_TEXT_COLOR,
    }),
  });

  const applyToAll = (command: (chain: ChainedCommands) => ChainedCommands) =>
    texts.forEach(({ editor }) => command(formatChain(editor)).run());

  // The question and option boxes (not text boxes or tables) can be cleared of text and pictures.
  const boxes = texts.filter(({ target }) => target.kind !== "textBox" && target.kind !== "table");

  const handleClearAll = () => {
    boxes.forEach(({ editor, target }) => {
      // Emits an update, so the box's own onChange saves the empty text.
      formatChain(editor).clearContent().run();
      clearContainerElements(target.slideId, target.kind === "option" ? target.optionId : QUESTION_CONTAINER_ID);
    });
  };

  return (
    <div
      // mousedown's default would move focus out of the text, closing this bar and losing the selection.
      onMouseDown={(e) => e.preventDefault()}
      // Clicking here shouldn't un-highlight the box being edited.
      data-keep-container-selection="true"
      className="flex items-center gap-0.5 rounded-button border border-border-default bg-bg-surface p-1"
    >
      {fontSize !== null && <FontSizePicker size={fontSize} sizes={FONT_SIZES} range={FONT_SIZE_RANGE} onChoose={(size) => setTextFontSizes(targets, size)} />}

      <Divider />

      {/* Set or unset (not toggle), so boxes that started different all end up the same. */}
      <ToolButton
        title="Bold (Ctrl+B)"
        active={state.bold}
        onClick={() => applyToAll((c) => (state.bold ? c.unsetBold() : c.setBold()))}
      >
        <span className="font-bold">B</span>
      </ToolButton>
      <ToolButton
        title="Italic (Ctrl+I)"
        active={state.italic}
        onClick={() => applyToAll((c) => (state.italic ? c.unsetItalic() : c.setItalic()))}
      >
        <span className="font-serif italic">I</span>
      </ToolButton>
      <ToolButton
        title="Underline (Ctrl+U)"
        active={state.underline}
        onClick={() => applyToAll((c) => (state.underline ? c.unsetUnderline() : c.setUnderline()))}
      >
        <span className="underline">U</span>
      </ToolButton>

      <Divider />

      {(["left", "center", "right"] as Align[]).map((align) => (
        <ToolButton
          key={align}
          title={`Align ${align}`}
          active={state.align === align}
          onClick={() => applyToAll((c) => c.setTextAlign(align))}
        >
          <AlignIcon align={align} />
        </ToolButton>
      ))}

      <Divider />

      <button
        type="button"
        title="Text color"
        onClick={toggleColorPanel}
        className="flex h-8 w-8 items-center justify-center"
      >
        <span
          className="h-6 w-6 rounded-full"
          style={{
            background: state.color,
            outline: isColorPanelOpen ? "2px solid var(--accent)" : "2px solid transparent",
            outlineOffset: 2,
          }}
        />
      </button>

      {boxes.length > 0 && (
        <>
          <Divider />
          <ToolButton title="Clear all" active={false} onClick={handleClearAll}>
            <EraserIcon size={20} />
          </ToolButton>
        </>
      )}
    </div>
  );
}

function ToolButton({
  title,
  active,
  onClick,
  children,
}: {
  title: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-dropdown text-sm ${
        active ? "bg-accent text-white" : "text-text-primary hover:bg-bg-page"
      }`}
    >
      {children}
    </button>
  );
}

// Sizes offered in the list (− and + step by 1). All within FONT_SIZE_RANGE (see schema.ts).
export const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64, 72, 80, 96];

/**
 * − / size / + with a list of `sizes`. The size box takes any whole number in `range` (typed, then Enter or
 * leaving the box; Escape puts the old one back), − and + step by 1, and clicking the box opens the list.
 * Used by the text toolbar, tables and diagram boxes.
 */
export function FontSizePicker({
  size,
  sizes,
  range,
  onChoose,
}: {
  size: number;
  sizes: number[];
  range: { min: number; max: number };
  onChoose: (size: number) => void;
}) {
  const [isListOpen, setIsListOpen] = useState(false);
  // What's typed in the box and not used yet; null = the box shows `size`.
  const [typed, setTyped] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The size and `onChoose` from when the box got the focus. A typed size goes to the text it was typed for, even
  // when the click that leaves the box picks another text first.
  const atFocus = useRef<{ size: number; onChoose: (size: number) => void } | null>(null);
  // The typed size to use when the box is left; null = nothing to use (Escape, a list pick, − / + or ↑ / ↓).
  // A ref, not the state: blur() runs onBlur at once, before React has redrawn with the new state.
  const pending = useRef<string | null>(null);

  const clamp = (next: number) => Math.min(range.max, Math.max(range.min, Math.round(next)));
  const choose = (next: number) => {
    const clamped = clamp(next);
    if (clamped !== size) onChoose(clamped);
    return clamped;
  };
  const forgetTyped = () => {
    pending.current = null;
    setTyped(null);
  };
  const stepBy = (delta: 1 | -1) => choose(delta > 0 ? Math.floor(size) + 1 : Math.ceil(size) - 1);
  // − and +: a size typed but not used yet is dropped, so it can't undo the step when the box is left.
  const stepFromButton = (delta: 1 | -1) => {
    forgetTyped();
    inputRef.current?.blur();
    stepBy(delta);
  };

  return (
    <div className="relative flex items-center">
      <ToolButton title="Smaller text" active={false} onClick={() => stepFromButton(-1)}>
        <span className="text-base leading-none">−</span>
      </ToolButton>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        aria-label="Text size"
        title="Text size"
        value={typed ?? String(size)}
        // The text toolbar stops mousedown (so typing in a text keeps its focus); this box needs the focus.
        onMouseDown={(e) => e.stopPropagation()}
        onFocus={(e) => {
          e.target.select();
          atFocus.current = { size, onChoose };
          setIsListOpen(true);
        }}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 3);
          pending.current = digits === "" ? null : digits;
          setTyped(digits);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            forgetTyped();
            e.currentTarget.blur();
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            forgetTyped();
            // A size typed next compares with what the arrow just set.
            atFocus.current = { size: stepBy(e.key === "ArrowUp" ? 1 : -1), onChoose };
          }
        }}
        onBlur={() => {
          const typedSize = pending.current;
          const target = atFocus.current ?? { size, onChoose };
          forgetTyped();
          atFocus.current = null;
          setIsListOpen(false);
          if (typedSize === null) return;
          const clamped = clamp(Number(typedSize));
          if (clamped !== target.size) target.onChoose(clamped);
        }}
        className="h-8 w-10 rounded-dropdown bg-transparent px-1 text-center text-sm font-semibold tabular-nums text-text-primary outline-none hover:bg-bg-page focus:bg-bg-page focus:ring-2 focus:ring-accent"
      />
      <ToolButton title="Bigger text" active={false} onClick={() => stepFromButton(1)}>
        <span className="text-base leading-none">+</span>
      </ToolButton>

      {isListOpen && (
        <div className="absolute top-full left-1/2 z-30 mt-2 flex max-h-72 w-20 -translate-x-1/2 flex-col overflow-y-auto rounded-dropdown border border-border-default bg-bg-surface p-1">
          {sizes.map((option) => (
            <button
              key={option}
              type="button"
              // Keeps the focus in the size box until the click is done.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                forgetTyped();
                inputRef.current?.blur();
                choose(option);
              }}
              className={`rounded-dropdown py-1.5 text-sm tabular-nums ${
                option === size ? "bg-accent font-semibold text-white" : "text-text-primary hover:bg-bg-page"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The size chosen for a text, or its default when none was chosen. null if the text is gone. */
function chosenFontSize(presentation: Presentation, target: TextTarget): number | null {
  const slide = presentation.slides.find((s) => s.id === target.slideId);
  if (!slide) return null;
  if (target.kind === "question") return slide.questionFontSize ?? QUESTION_FONT_SIZE;
  if (target.kind === "option") {
    const option = slide.options.find((o) => o.id === target.optionId);
    return option ? (option.fontSize ?? OPTION_FONT_SIZE) : null;
  }
  const element = slide.elements.find((el) => el.id === target.elementId);
  if (!element) return null;
  return target.kind === "table" ? (element.table?.fontSize ?? TABLE_FONT_SIZE) : (element.text?.fontSize ?? TEXT_BOX_FONT_SIZE);
}

function Divider() {
  return <div className="mx-1 h-5 w-px bg-border-default" />;
}

const ALIGN_ICONS = { left: TextAlignStartIcon, center: TextAlignCenterIcon, right: TextAlignEndIcon };

function AlignIcon({ align }: { align: Align }) {
  const Icon = ALIGN_ICONS[align];
  return <Icon size={16} />;
}
