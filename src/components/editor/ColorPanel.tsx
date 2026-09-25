"use client";

import { useEffect } from "react";
import { useEditorState } from "@tiptap/react";
import { useEditorStore } from "@/lib/store";
import { DEFAULT_TEXT_COLOR } from "@/lib/richText";
import { getElementAsset } from "@/lib/svgLibrary";
import { GRADIENT_PREFIX, toCssBackground } from "./ElementSvg";
import { SIDE_CONTAINER_ID } from "@/lib/constants";
import { CloseIcon } from "@/components/icons/CloseIcon";

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

// Soft tints — good for backgrounds such as the shape box fill.
const LIGHT_COLORS = [
  "#FAF9F6",
  "#F1F3F5",
  "#EBFBEE",
  "#E6FCF5",
  "#E3FAFC",
  "#E7F5FF",
  "#EDF2FF",
  "#F3F0FF",
  "#F8F0FC",
  "#FFF0F6",
  "#FFF5F5",
  "#FFF9DB",
];

// A white circle with a red slash, for "no color".
export const NONE_SWATCH = "linear-gradient(135deg, #FFFFFF 45%, #E03131 45%, #E03131 55%, #FFFFFF 55%)";

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
  const updateElements = useEditorStore((s) => s.updateElements);
  const selectedContainerId = useEditorStore((s) => s.selectedContainerId);
  const shapeBoxColorTarget = useEditorStore((s) => s.shapeBoxColorTarget);
  const setShapeBoxColors = useEditorStore((s) => s.setShapeBoxColors);
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
  // With no text or shapes to color, the panel paints the selected shape box's fill or border.
  const boxTarget =
    !textEditor && elements.length === 0 && selectedContainerId === SIDE_CONTAINER_ID ? shapeBoxColorTarget : null;
  const boxColor = boxTarget === "fill" ? slide?.shapeBoxFill : slide?.shapeBoxBorder;

  const commonColor = textEditor
    ? (textColor ?? DEFAULT_TEXT_COLOR).toUpperCase()
    : boxTarget
      ? (boxColor ?? null)
      : elements.length > 0 && elements.every((el) => el.color === elements[0].color)
        ? elements[0].color
        : null;

  // undefined = none (shape box only).
  const handleColor = (color: string | undefined) => {
    if (textEditor) textEditor.chain().focus().setColor(color ?? DEFAULT_TEXT_COLOR).run();
    else if (boxTarget === "fill") setShapeBoxColors(selectedSlideId, { shapeBoxFill: color });
    else if (boxTarget === "border") setShapeBoxColors(selectedSlideId, { shapeBoxBorder: color });
    else if (color) updateElements(selectedSlideId, Object.fromEntries(elements.map((el) => [el.id, { color }])));
  };

  // Text, text boxes and box borders can only be a solid color.
  const allowGradients =
    boxTarget === "fill" || (!boxTarget && !textEditor && !elements.some((el) => getElementAsset(el.assetId)?.isTextBox));

  return (
    <div
      data-keep-container-selection="true"
      // In text mode, mousedown's default would move focus out of the text and lose the selected words.
      onMouseDown={(e) => textEditor && e.preventDefault()}
      className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-border-default bg-bg-surface p-5"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-text-primary">
          {boxTarget === "fill" ? "Box fill" : boxTarget === "border" ? "Box border" : "Color"}
        </h2>
        <button
          type="button"
          onClick={closeColorPanel}
          title="Close (Esc)"
          className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
        >
          <CloseIcon />
        </button>
      </div>

      {boxTarget && (
        <>
          <h3 className="mb-3 text-[12px] font-bold uppercase tracking-[0.05em] text-text-header">None</h3>
          <div className="mb-6 grid grid-cols-6 justify-items-center gap-3">
            <Swatch title="None" background={NONE_SWATCH} bordered selected={boxColor === undefined} onClick={() => handleColor(undefined)} />
          </div>
        </>
      )}

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

      <h3 className="mb-3 mt-6 text-[12px] font-bold uppercase tracking-[0.05em] text-text-header">Light</h3>
      <div className="grid grid-cols-6 justify-items-center gap-3">
        {LIGHT_COLORS.map((color) => (
          <Swatch
            key={color}
            title={color}
            background={color}
            // Pale colors need an outline to show up on the white panel.
            bordered
            selected={commonColor === color}
            onClick={() => handleColor(color)}
          />
        ))}
      </div>

      {allowGradients && (
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
