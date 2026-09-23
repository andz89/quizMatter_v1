"use client";

import { useEffect } from "react";
import { useEditorState } from "@tiptap/react";
import { useEditorStore } from "@/lib/store";
import { DEFAULT_TEXT_COLOR } from "@/lib/richText";
import { GRADIENT_PREFIX, toCssBackground } from "./ElementSvg";

// A simple curated palette: the app's own brand colors first, then a broader range for quiz content.
const COLORS = [
  "#191A2C",
  "#1E8E4F",
  "#F2A93B",
  "#A8A6A1",
  "#1F1F1F",
  "#FFFFFF",
  "#E03131",
  "#E8590C",
  "#F08C00",
  "#2F9E44",
  "#0CA678",
  "#1098AD",
  "#1971C2",
  "#4263EB",
  "#7048E8",
  "#AE3EC9",
  "#D6336C",
  "#495057",
];

// Preset two-color gradients, drawn top-left → bottom-right.
const GRADIENTS: [string, string][] = [
  ["#F2A93B", "#D6336C"],
  ["#F08C00", "#E03131"],
  ["#FCC419", "#F08C00"],
  ["#0CA678", "#1971C2"],
  ["#2F9E44", "#0CA678"],
  ["#1098AD", "#4263EB"],
  ["#4263EB", "#7048E8"],
  ["#7048E8", "#AE3EC9"],
  ["#AE3EC9", "#D6336C"],
  ["#D6336C", "#F08C00"],
  ["#191A2C", "#4263EB"],
  ["#495057", "#1F1F1F"],
];

export function ColorPanel() {
  const selectedSlideId = useEditorStore((s) => s.selectedSlideId);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const slide = useEditorStore((s) => s.quiz.slides.find((sl) => sl.id === s.selectedSlideId));
  const updateElement = useEditorStore((s) => s.updateElement);
  const closeColorPanel = useEditorStore((s) => s.closeColorPanel);
  // While typing in a text box, the panel colors the selected words instead of the selected shapes.
  const textEditor = useEditorStore((s) => s.activeTextEditor);
  const textColor = useEditorState({
    editor: textEditor,
    selector: ({ editor }) => (editor?.getAttributes("textStyle").color as string | undefined) ?? DEFAULT_TEXT_COLOR,
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeColorPanel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeColorPanel]);

  const elements = slide?.elements.filter((el) => selectedElementIds.includes(el.id)) ?? [];
  const commonColor = textEditor
    ? (textColor ?? DEFAULT_TEXT_COLOR).toUpperCase()
    : elements.length > 0 && elements.every((el) => el.color === elements[0].color)
      ? elements[0].color
      : null;

  const handleColor = (color: string) => {
    if (textEditor) textEditor.chain().focus().setColor(color).run();
    else elements.forEach((el) => updateElement(selectedSlideId, el.id, { color }));
  };

  return (
    <div
      data-keep-container-selection="true"
      // In text mode, mousedown's default would move focus out of the text and lose the selected words.
      onMouseDown={(e) => textEditor && e.preventDefault()}
      className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-border-default bg-bg-surface p-5"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-text-primary">Color</h2>
        <button
          type="button"
          onClick={closeColorPanel}
          title="Close (Esc)"
          className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
        >
          <CloseIcon />
        </button>
      </div>

      <h3 className="mb-3 text-[12px] font-bold uppercase tracking-[0.05em] text-text-header">Solid</h3>
      <div className="grid grid-cols-6 justify-items-center gap-3">
        {COLORS.map((color) => (
          <Swatch
            key={color}
            title={color}
            background={color}
            bordered={color === "#FFFFFF"}
            selected={commonColor === color}
            onClick={() => handleColor(color)}
          />
        ))}
      </div>

      {/* Text can only be a solid color. */}
      {!textEditor && (
        <>
          <h3 className="mb-3 mt-6 text-[12px] font-bold uppercase tracking-[0.05em] text-text-header">Gradient</h3>
          <div className="grid grid-cols-6 justify-items-center gap-3">
            {GRADIENTS.map(([from, to]) => {
              const value = `${GRADIENT_PREFIX}${from},${to}`;
              return (
                <Swatch
                  key={value}
                  title={`${from} → ${to}`}
                  background={toCssBackground(value)}
                  selected={commonColor === value}
                  onClick={() => handleColor(value)}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

interface SwatchProps {
  title: string;
  background: string;
  bordered?: boolean;
  selected: boolean;
  onClick: () => void;
}

function Swatch({ title, background, bordered, selected, onClick }: SwatchProps) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="h-8 w-8 shrink-0 rounded-full"
      style={{
        background,
        border: bordered ? "1px solid var(--border-default)" : undefined,
        outline: selected ? "2px solid var(--accent-navy)" : "2px solid transparent",
        outlineOffset: 2,
      }}
    />
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 4L12 12M12 4L4 12" strokeLinecap="round" />
    </svg>
  );
}
