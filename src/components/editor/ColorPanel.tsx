"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { useEditorStore } from "@/lib/store";
import { useFormatTexts } from "@/lib/useFormatTexts";
import { formatChain } from "@/lib/richText";
import { diagramStyleTargets, getDiagramBoxes, getElementAsset, withDiagramBoxStyle } from "@/lib/svgLibrary";
import { cellRange, withCellsFill } from "@/lib/table";
import { toCssBackground } from "./ElementSvg";
import {
  BORDER_WIDTH_DEFAULT,
  BORDER_WIDTH_MAX,
  DEFAULT_TEXT_COLOR,
  DIAGRAM_BORDER_WIDTH,
  DIAGRAM_NONE,
  GRADIENT_PREFIX,
  SIDE_CONTAINER_ID,
} from "@/lib/constants";
import { PanelSlider } from "./PanelControls";
import { CustomColorPicker } from "./CustomColorPicker";
import { parseHex, readRecentColors, withRecent } from "@/lib/colors";
import { PlusIcon, XIcon } from "lucide-react";

// A curated palette: the first 18 are the original ones (kept in place, so colors already used still show as picked),
// then grays and darker / brighter shades. Any other color: the Custom picker.
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
  "#000000",
  "#343A40",
  "#868E96",
  "#CED4DA",
  "#F783AC",
  "#63E6BE",
  "#7A1F1F",
  "#8A3A0A",
  "#6B4E00",
  "#1B5E20",
  "#0B3D91",
  "#4A148C",
  "#FF6B6B",
  "#FFA94D",
  "#FFD43B",
  "#69DB7C",
  "#4DABF7",
  "#DA77F2",
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

// Custom colors used lately, kept in this browser only (newest first).
const RECENT_KEY = "qm-recent-colors";
// The custom picker's start when the picked color isn't one solid color (a gradient, none, or mixed): Quiz Violet.
const PICKER_START = "#6B3DF5";
// The "+" swatch that opens the custom picker.
const RAINBOW = "conic-gradient(#F00, #FF0, #0F0, #0FF, #00F, #F0F, #F00)";

function loadRecentColors(): string[] {
  try {
    return readRecentColors(localStorage.getItem(RECENT_KEY));
  } catch {
    return [];
  }
}

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

// The diagram box field each box target paints, and the panel's title for it.
const BOX_STYLE = {
  boxFill: { key: "fill", title: "Box background" },
  boxBorder: { key: "border", title: "Box border" },
  boxText: { key: "textColor", title: "Box text" },
} as const;

export function ColorPanel() {
  const selectedSlideId = useEditorStore((s) => s.selectedSlideId);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const slide = useEditorStore((s) => s.presentation.slides.find((sl) => sl.id === s.selectedSlideId));
  const updateElements = useEditorStore((s) => s.updateElements);
  const updateElement = useEditorStore((s) => s.updateElement);
  const pickedDiagramBox = useEditorStore((s) => s.pickedDiagramBox);
  const pickedTableCell = useEditorStore((s) => s.pickedTableCell);
  const selectedContainerId = useEditorStore((s) => s.selectedContainerId);
  const colorPanelTarget = useEditorStore((s) => s.colorPanelTarget);
  const setShapeBoxColors = useEditorStore((s) => s.setShapeBoxColors);
  const closeColorPanel = useEditorStore((s) => s.closeColorPanel);
  // While typing, the panel colors the selected words instead of the selected shapes — or all the
  // text of the selected question/option boxes.
  const texts = useFormatTexts();
  const textEditor = texts[0]?.editor ?? null;
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [recentColors, setRecentColors] = useState(loadRecentColors);
  // The words picked in each text being typed in, read on the press on the hex box (its focus ends the typing).
  const hexTargets = useRef<{ editor: Editor; from: number; to: number }[] | null>(null);
  const textColor = useEditorState({
    editor: textEditor,
    selector: ({ editor }) => (editor?.getAttributes("textStyle").color as string | undefined) ?? DEFAULT_TEXT_COLOR,
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      closeColorPanel();
      // One Escape does one thing: with a diagram box or table cell picked (not typing), it only closes the panel.
      // Otherwise the editor's Escape would also let go of it, and the next change would go to every box or cell.
      const { pickedDiagramBox, editingDiagramBox, pickedTableCell } = useEditorStore.getState();
      if ((pickedDiagramBox && !editingDiagramBox) || (pickedTableCell && !pickedTableCell.typingAt)) e.stopPropagation();
    };
    // Capture, so this runs before the editor's own Escape shortcut.
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [closeColorPanel]);

  const elements = slide?.elements.filter((el) => selectedElementIds.includes(el.id)) ?? [];
  // With no text or shapes to color, the panel paints the selected shape box's fill or border.
  const boxTarget =
    !textEditor &&
    elements.length === 0 &&
    selectedContainerId === SIDE_CONTAINER_ID &&
    (colorPanelTarget === "fill" || colorPanelTarget === "border")
      ? colorPanelTarget
      : null;
  const boxColor = boxTarget === "fill" ? slide?.shapeBoxFill : slide?.shapeBoxBorder;
  // One diagram selected and the panel opened on a box swatch: it paints the picked box, or every box.
  const diagramElement = !textEditor && elements.length === 1 ? elements[0] : null;
  const diagram = diagramElement ? getDiagramBoxes(diagramElement.assetId, diagramElement) : null;
  const boxStyle = diagram && colorPanelTarget in BOX_STYLE ? BOX_STYLE[colorPanelTarget as keyof typeof BOX_STYLE] : null;
  const styleTargets =
    diagram && diagramElement
      ? diagramStyleTargets(diagram, pickedDiagramBox?.elementId === diagramElement.id ? pickedDiagramBox.path : undefined)
      : [];
  const boxStyleColor = boxStyle ? styleTargets[0]?.item[boxStyle.key] : undefined;
  // One table selected and the panel opened on its cell swatch: it paints the picked cells, or every cell.
  const tableElement = !textEditor && elements.length === 1 && elements[0].table ? elements[0] : null;
  const isCellFill = !!tableElement && colorPanelTarget === "cellFill";
  const tablePick = tableElement && pickedTableCell?.elementId === tableElement.id ? pickedTableCell : null;
  const cellSpan =
    isCellFill && tableElement.table
      ? tablePick
        ? cellRange(tablePick, tablePick.end ?? tablePick)
        : cellRange({ row: 0, column: 0 }, { row: tableElement.table.rows.length - 1, column: tableElement.table.rows[0].length - 1 })
      : null;
  const targetCells =
    cellSpan && tableElement?.table
      ? tableElement.table.rows.slice(cellSpan.from.row, cellSpan.to.row + 1).flatMap((cells) => cells.slice(cellSpan.from.column, cellSpan.to.column + 1))
      : [];
  const cellFill = targetCells.every((cell) => cell.fill === targetCells[0]?.fill) ? targetCells[0]?.fill : null;
  // Opened on "border" with only squares/rectangles selected, the panel paints their border.
  const isShapeBorder =
    !textEditor &&
    colorPanelTarget === "border" &&
    elements.length > 0 &&
    elements.every((el) => getElementAsset(el.assetId)?.roundCorners);
  const shapeBorderColor = elements.every((el) => el.borderColor === elements[0]?.borderColor) ? elements[0]?.borderColor : null;
  // Box text has no "none": text always needs a color.
  const hasNone = !!boxTarget || isShapeBorder || isCellFill || (!!boxStyle && boxStyle.key !== "textColor");
  const noneSelected = boxStyle
    ? boxStyleColor === DIAGRAM_NONE
    : isCellFill
      ? targetCells.every((cell) => cell.fill === undefined)
      : isShapeBorder
        ? shapeBorderColor === undefined
        : boxColor === undefined;

  const commonColor = textEditor
    ? (textColor ?? DEFAULT_TEXT_COLOR).toUpperCase()
    : boxStyle
      ? boxStyleColor && boxStyleColor !== DIAGRAM_NONE
        ? boxStyleColor
        : null
      : isCellFill
        ? (cellFill ?? null)
        : boxTarget
      ? (boxColor ?? null)
      : isShapeBorder
        ? (shapeBorderColor ?? null)
        : elements.length > 0 && elements.every((el) => el.color === elements[0].color)
          ? elements[0].color
          : null;

  // undefined = none (shape box, shape borders and cell backgrounds only).
  const handleColor = (color: string | undefined) => {
    if (textEditor) texts.forEach(({ editor }) => formatChain(editor).setColor(color ?? DEFAULT_TEXT_COLOR).run());
    else if (boxStyle && diagram && diagramElement)
      updateElement(selectedSlideId, diagramElement.id, withDiagramBoxStyle(diagram, styleTargets, { [boxStyle.key]: color ?? DIAGRAM_NONE }));
    else if (isCellFill && tableElement?.table && cellSpan)
      updateElement(selectedSlideId, tableElement.id, { table: withCellsFill(tableElement.table, cellSpan.from, cellSpan.to, color) });
    else if (boxTarget === "fill") setShapeBoxColors(selectedSlideId, { shapeBoxFill: color });
    else if (boxTarget === "border") setShapeBoxColors(selectedSlideId, { shapeBoxBorder: color });
    else if (isShapeBorder) updateElements(selectedSlideId, Object.fromEntries(elements.map((el) => [el.id, { borderColor: color }])));
    else if (color) updateElements(selectedSlideId, Object.fromEntries(elements.map((el) => [el.id, { color }])));
  };

  // A custom color used: first in Recent (preset colors already have their swatch).
  const rememberColor = (color: string) => {
    if (COLORS.includes(color) || LIGHT_COLORS.includes(color)) return;
    const next = withRecent(recentColors, color);
    setRecentColors(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // Storage blocked or full: Recent lasts only while the panel is open.
    }
  };
  const handleHexStart = () => {
    hexTargets.current = texts
      .filter(({ editor }) => editor.isEditable)
      .map(({ editor }) => ({ editor, from: editor.state.selection.from, to: editor.state.selection.to }));
  };
  const handleHexColor = (color: string) => {
    const typedIn = hexTargets.current ?? [];
    hexTargets.current = null;
    // Typing ended when the box took the focus: color the words that were picked then, not the whole text.
    if (typedIn.length > 0)
      typedIn.forEach(({ editor, from, to }) => {
        if (!editor.isDestroyed) editor.chain().setTextSelection({ from, to }).setColor(color).run();
      });
    else handleColor(color);
    rememberColor(color);
  };
  const pickerColor = (commonColor && parseHex(commonColor)) ?? PICKER_START;

  // The thickness applies to every selected shape at once; the slider starts at the first one's value.
  const borderWidth = elements[0]?.borderWidth ?? BORDER_WIDTH_DEFAULT;
  const setBorderWidth = (value: number) => {
    const clamped = Math.min(BORDER_WIDTH_MAX, Math.max(1, value));
    updateElements(selectedSlideId, Object.fromEntries(elements.map((el) => [el.id, { borderWidth: clamped }])));
  };

  // Text, text boxes and borders can only be a solid color.
  const allowGradients =
    boxTarget === "fill" ||
    (!boxTarget && !boxStyle && !isShapeBorder && !textEditor && !elements.some((el) => getElementAsset(el.assetId)?.isTextBox));

  return (
    <div
      data-keep-container-selection="true"
      // The text being typed in leaves the panel open when the focus moves in here (the custom color's hex box).
      data-color-panel="true"
      // In text mode, mousedown's default would move focus out of the text and lose the selected words.
      onMouseDown={(e) => textEditor && e.preventDefault()}
      className="flex shrink-0 flex-col overflow-y-auto border-r border-border-default bg-bg-surface side-panel"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[15px] font-extrabold text-text-primary">
          {boxStyle
            ? boxStyle.title
            : isCellFill
              ? "Cell background"
              : boxTarget === "fill"
                ? "Box fill"
                : boxTarget === "border"
                  ? "Box border"
                  : isShapeBorder
                    ? "Border"
                    : "Color"}
        </h2>
        <button
          type="button"
          onClick={closeColorPanel}
          title="Close (Esc)"
          className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
        >
          <XIcon size={16} />
        </button>
      </div>

      {hasNone && (
        <>
          <h3 className="mb-3 text-[12px] font-bold uppercase tracking-[0.05em] text-text-header">None</h3>
          <div className="mb-6 grid grid-cols-6 justify-items-center gap-3">
            <Swatch title="None" background={NONE_SWATCH} bordered selected={noneSelected} onClick={() => handleColor(undefined)} />
          </div>
        </>
      )}

      {/* Greyed out until there's a border to make thicker or thinner. */}
      {isShapeBorder && (
        <div className={`mb-6 ${shapeBorderColor ? "" : "pointer-events-none opacity-40"}`}>
          <PanelSlider label="Thickness" unit="px" value={borderWidth} min={1} max={BORDER_WIDTH_MAX} onChange={setBorderWidth} />
        </div>
      )}

      {/* Diagram box border: greyed out while the border is "none". */}
      {boxStyle?.key === "border" && diagram && diagramElement && (
        <div className={`mb-6 ${boxStyleColor === DIAGRAM_NONE ? "pointer-events-none opacity-40" : ""}`}>
          <PanelSlider
            label="Thickness"
            unit=""
            value={styleTargets[0]?.item.borderWidth ?? DIAGRAM_BORDER_WIDTH.default}
            min={DIAGRAM_BORDER_WIDTH.min}
            max={DIAGRAM_BORDER_WIDTH.max}
            onChange={(width) =>
              updateElement(
                selectedSlideId,
                diagramElement.id,
                withDiagramBoxStyle(diagram, styleTargets, {
                  borderWidth: Math.min(DIAGRAM_BORDER_WIDTH.max, Math.max(DIAGRAM_BORDER_WIDTH.min, width)),
                }),
              )
            }
          />
        </div>
      )}

      <h3 className="mb-3 text-[12px] font-bold uppercase tracking-[0.05em] text-text-header">Custom</h3>
      <div className="grid grid-cols-6 justify-items-center gap-3">
        <button
          type="button"
          title="Custom color"
          aria-expanded={isPickerOpen}
          onClick={() => setIsPickerOpen((open) => !open)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          style={{
            background: RAINBOW,
            outline: isPickerOpen ? "2px solid var(--accent)" : "2px solid transparent",
            outlineOffset: 2,
          }}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-bg-surface text-text-primary">
            <PlusIcon size={14} />
          </span>
        </button>
        {recentColors.map((color) => (
          <Swatch
            key={color}
            title={color}
            background={color}
            bordered
            selected={commonColor === color}
            onClick={() => {
              handleColor(color);
              rememberColor(color);
            }}
          />
        ))}
      </div>
      {isPickerOpen && (
        <div className="mt-4">
          <CustomColorPicker
            color={pickerColor}
            onChange={handleColor}
            onDone={rememberColor}
            onHexStart={handleHexStart}
            onHexColor={handleHexColor}
          />
        </div>
      )}

      <h3 className="mb-3 mt-6 text-[12px] font-bold uppercase tracking-[0.05em] text-text-header">Solid</h3>
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
        outline: selected ? "2px solid var(--accent)" : "2px solid transparent",
        outlineOffset: 2,
      }}
    />
  );
}
