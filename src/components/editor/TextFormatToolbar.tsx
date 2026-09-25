"use client";

import { useState } from "react";
import { useEditorState, type ChainedCommands } from "@tiptap/react";
import { useEditorStore, type TextEditorEntry, type TextTarget } from "@/lib/store";
import { DEFAULT_TEXT_COLOR, formatChain } from "@/lib/richText";
import { OPTION_FONT_SIZE, QUESTION_CONTAINER_ID, QUESTION_FONT_SIZE, TEXT_BOX_FONT_SIZE } from "@/lib/constants";
import type { Quiz } from "@/lib/schema";
import { EraserIcon } from "@/components/icons/EraserIcon";

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

  // The question and option boxes (not text box elements) can be cleared of text and pictures.
  const boxes = texts.filter(({ target }) => target.kind !== "textBox");

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
      className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 rounded-button border border-border-default bg-bg-surface p-1"
    >
      <FontSizePicker targets={texts.map((text) => text.target)} />

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
            outline: isColorPanelOpen ? "2px solid var(--accent-navy)" : "2px solid transparent",
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
        active ? "bg-accent-navy text-white" : "text-text-primary hover:bg-bg-page"
      }`}
    >
      {children}
    </button>
  );
}

// Sizes offered in the list; − and + step between them. All within FONT_SIZE_RANGE (see schema.ts).
const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64, 72, 80, 96];

/**
 * − / size / + for the texts being changed (the question, options, or a text box) — they all get the
 * same size, stepping from the first one's. The text always shows at this size; if it's too long for
 * its box, the box turns red.
 */
function FontSizePicker({ targets }: { targets: TextTarget[] }) {
  const size = useEditorStore((s) => chosenFontSize(s.quiz, targets[0]));
  const setTextFontSizes = useEditorStore((s) => s.setTextFontSizes);
  const [isListOpen, setIsListOpen] = useState(false);
  if (size === null) return null;

  const smaller = FONT_SIZES.findLast((option) => option < size);
  const bigger = FONT_SIZES.find((option) => option > size);
  const choose = (next: number | undefined) => {
    if (next !== undefined) setTextFontSizes(targets, next);
    setIsListOpen(false);
  };

  return (
    <div className="relative flex items-center">
      <ToolButton title="Smaller text" active={false} onClick={() => choose(smaller)}>
        <span className="text-base leading-none">−</span>
      </ToolButton>
      <button
        type="button"
        onClick={() => setIsListOpen(!isListOpen)}
        title="Text size"
        className="h-8 min-w-10 rounded-dropdown px-1.5 text-sm font-semibold tabular-nums text-text-primary hover:bg-bg-page"
      >
        {size}
      </button>
      <ToolButton title="Bigger text" active={false} onClick={() => choose(bigger)}>
        <span className="text-base leading-none">+</span>
      </ToolButton>

      {isListOpen && (
        <div className="absolute top-full left-1/2 z-30 mt-2 flex max-h-72 w-20 -translate-x-1/2 flex-col overflow-y-auto rounded-dropdown border border-border-default bg-bg-surface p-1">
          {FONT_SIZES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => choose(option)}
              className={`rounded-dropdown py-1.5 text-sm tabular-nums ${
                option === size ? "bg-accent-navy font-semibold text-white" : "text-text-primary hover:bg-bg-page"
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
function chosenFontSize(quiz: Quiz, target: TextTarget): number | null {
  const slide = quiz.slides.find((s) => s.id === target.slideId);
  if (!slide) return null;
  if (target.kind === "question") return slide.questionFontSize ?? QUESTION_FONT_SIZE;
  if (target.kind === "option") {
    const option = slide.options.find((o) => o.id === target.optionId);
    return option ? (option.fontSize ?? OPTION_FONT_SIZE) : null;
  }
  const element = slide.elements.find((el) => el.id === target.elementId);
  return element ? (element.text?.fontSize ?? TEXT_BOX_FONT_SIZE) : null;
}

function Divider() {
  return <div className="mx-1 h-5 w-px bg-border-default" />;
}

function AlignIcon({ align }: { align: Align }) {
  // Three lines: full, short, full — the short one shows which side the text hugs.
  const short = align === "left" ? "M2 7h6" : align === "center" ? "M4 7h6" : "M6 7h6";
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d={`M2 3h10 ${short} M2 11h10`} strokeLinecap="round" />
    </svg>
  );
}
