"use client";

import { useEditorStore, type ColorPanelTarget } from "@/lib/store";
import {
  canCrop,
  getElementAsset,
  DEFAULT_CLOCK_TIME,
  DIAGRAM_TEXT_COLOR,
  diagramStyleTargets,
  getDiagramBoxes,
  withDiagramBoxStyle,
  type DiagramBoxStyle,
} from "@/lib/svgLibrary";
import { DEFAULT_ROTATION_3D } from "@/lib/solids";
import {
  CORNER_RADIUS_MAX,
  DIAGRAM_FONT_SIZE,
  DIAGRAM_FONT_SIZES,
  DIAGRAM_NONE,
  getContainerBounds,
  GRADIENT_PREFIX,
  OPACITY_MIN,
} from "@/lib/constants";
import { boxForShownPart, getCropFrame } from "@/lib/crop";
import { fitInBox } from "@/lib/geometry";
import { toCssBackground } from "./ElementSvg";
import { NONE_SWATCH } from "./ColorPanel";
import { ArrangePanel } from "./ArrangePanel";
import { MathToolControls } from "./MathToolPanels";
import { FontSizePicker } from "./TextFormatToolbar";
import { PanelReadout, PanelSlider, ResetButton, ToggleChip, ToolPanelButton } from "./PanelControls";
import { BlendIcon, CircleIcon, ClockIcon, CopyIcon, CropIcon, FlipHorizontal2Icon, FullscreenIcon, GroupIcon, LayersIcon, Rotate3dIcon, RotateCwIcon, SquareIcon, SquareRoundCornerIcon, Trash2Icon, UngroupIcon } from "lucide-react";

// Quick angles shown above the Rotate slider.
const ANGLE_PRESETS = [-90, -45, 0, 45, 90, 180];

const MIXED_COLOR_SWATCH = "conic-gradient(#6B3DF5, #14C8A0, #FFC233, #FF5A5F, #2F9BFF, #6B3DF5)";

// A diagram box border swatch: "none", a ring in its color, or (unset) the diagram's Color it uses.
// A gradient Color can't be a ring, so it shows as a filled circle.
function borderSwatch(border: string | undefined, diagramColor: string): React.CSSProperties {
  if (border === DIAGRAM_NONE) return { background: NONE_SWATCH, border: "1px solid var(--border-default)" };
  const color = border ?? diagramColor;
  return color.startsWith(GRADIENT_PREFIX) ? { background: toCssBackground(color) } : { border: `4px solid ${color}` };
}

/**
 * Header container for the selected SVG element(s)' color, duplicate, and delete controls.
 * `showColor` is off next to the text toolbar, which has its own color button.
 */
export function SelectedElementToolbar({ showColor = true }: { showColor?: boolean }) {
  const selectedSlideId = useEditorStore((s) => s.selectedSlideId);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const slide = useEditorStore((s) => s.presentation.slides.find((sl) => sl.id === s.selectedSlideId));
  const deleteElements = useEditorStore((s) => s.deleteElements);
  const duplicateElements = useEditorStore((s) => s.duplicateElements);
  const groupSelectedElements = useEditorStore((s) => s.groupSelectedElements);
  const ungroupSelectedElements = useEditorStore((s) => s.ungroupSelectedElements);
  const selectElements = useEditorStore((s) => s.selectElements);
  const isColorPanelOpen = useEditorStore((s) => s.isColorPanelOpen);
  const colorPanelTarget = useEditorStore((s) => s.colorPanelTarget);
  const openColorPanelOn = useEditorStore((s) => s.openColorPanelOn);
  const updateElement = useEditorStore((s) => s.updateElement);
  const updateElements = useEditorStore((s) => s.updateElements);
  const fitElementsToContainer = useEditorStore((s) => s.fitElementsToContainer);
  const croppingElementId = useEditorStore((s) => s.croppingElementId);
  const setCroppingElementId = useEditorStore((s) => s.setCroppingElementId);
  const pickedDiagramBox = useEditorStore((s) => s.pickedDiagramBox);

  const elements = slide?.elements.filter((el) => selectedElementIds.includes(el.id)) ?? [];
  if (elements.length === 0) return null;

  // 3D rotation is only offered when exactly one solid shape is selected.
  const solid = elements.length === 1 && getElementAsset(elements[0].assetId)?.is3d ? elements[0] : null;
  const rotation = solid?.rotation3d ?? DEFAULT_ROTATION_3D;
  const setRotation = (patch: Partial<typeof rotation>) =>
    solid && updateElement(selectedSlideId, solid.id, { rotation3d: { ...rotation, ...patch } });

  // Flat rotation is offered when exactly one non-solid element is selected.
  const flat = elements.length === 1 && !solid ? elements[0] : null;
  const setAngle = (rotation: number) => flat && updateElement(selectedSlideId, flat.id, { rotation });

  // Time controls are offered when exactly one clock is selected.
  const clock = elements.length === 1 && getElementAsset(elements[0].assetId)?.isClock ? elements[0] : null;
  const time = clock?.clockTime ?? DEFAULT_CLOCK_TIME;
  const setTime = (patch: Partial<typeof time>) =>
    clock && updateElement(selectedSlideId, clock.id, { clockTime: { ...time, ...patch } });

  // Box style is offered when exactly one diagram is selected: for its picked box, or every box.
  const diagramElement = elements.length === 1 ? elements[0] : null;
  const diagram = diagramElement ? getDiagramBoxes(diagramElement.assetId, diagramElement) : null;
  const styleTargets =
    diagram && diagramElement
      ? diagramStyleTargets(diagram, pickedDiagramBox?.elementId === diagramElement.id ? pickedDiagramBox.path : undefined)
      : [];
  const firstBox = styleTargets[0]?.item;
  const boxShape = styleTargets[0]?.shape;
  const setBoxStyle = (style: DiagramBoxStyle) =>
    diagram && diagramElement && updateElement(selectedSlideId, diagramElement.id, withDiagramBoxStyle(diagram, styleTargets, style));

  // Opacity applies to every selected element at once; the slider starts at the first one's value.
  const opacity = elements[0].opacity ?? 100;
  const setOpacity = (value: number) => {
    const clamped = Math.min(100, Math.max(OPACITY_MIN, value));
    updateElements(selectedSlideId, Object.fromEntries(elements.map((el) => [el.id, { opacity: clamped }])));
  };

  // Corner radius is offered when every selected element is a square or rectangle, and applies to all of them.
  const canRoundCorners = elements.every((el) => getElementAsset(el.assetId)?.roundCorners);
  const cornerRadius = elements[0].cornerRadius ?? 0;
  const setCornerRadius = (value: number) => {
    const clamped = Math.min(CORNER_RADIUS_MAX, Math.max(0, value));
    updateElements(selectedSlideId, Object.fromEntries(elements.map((el) => [el.id, { cornerRadius: clamped || undefined }])));
  };

  // Crop is offered when exactly one picture is selected.
  const croppable = elements.length === 1 && canCrop(elements[0]) ? elements[0] : null;
  const isCropping = !!croppable && croppingElementId === croppable.id;

  // Shows the whole picture again: the box grows to the picture, which stays where it is (shrunk if
  // it no longer fits its box).
  const resetCrop = () => {
    if (!croppable || !slide) return;
    const frame = getCropFrame(croppable);
    const box = boxForShownPart(croppable, frame, { x: 0, y: 0, width: frame.width, height: frame.height });
    const bounds = getContainerBounds(croppable.containerId, slide);
    updateElement(selectedSlideId, croppable.id, { ...fitInBox(box, bounds, true), crop: undefined });
  };

  // Flip mirrors what you see, so a turned element's angle is mirrored too (30° becomes -30°).
  // Each element flips in its own place. Text boxes are never flipped: mirrored text can't be read.
  const flippable = elements.filter((el) => !getElementAsset(el.assetId)?.isTextBox);
  const flip = (axis: "flipX" | "flipY") =>
    updateElements(
      selectedSlideId,
      Object.fromEntries(
        flippable.map((el) => [el.id, { [axis]: !el[axis] || undefined, ...(el.rotation && { rotation: -el.rotation }) }])
      )
    );

  const commonColor = elements.every((el) => el.color === elements[0].color) ? elements[0].color : null;
  // Squares and rectangles also get a border swatch: a ring in the border color, or "none".
  const commonBorder = elements.every((el) => el.borderColor === elements[0].borderColor) ? elements[0].borderColor : null;
  // Violet ring on the swatch whose color the panel is editing.
  const outline = (target: ColorPanelTarget) => ({
    outline: isColorPanelOpen && colorPanelTarget === target ? "2px solid var(--accent)" : "2px solid transparent",
    outlineOffset: 2,
  });

  // Selection is exactly one whole group → offer Ungroup. 2+ elements in one box otherwise → offer Group.
  const isOneGroup = !!elements[0].groupId && elements.every((el) => el.groupId === elements[0].groupId);
  const canGroup = elements.length > 1 && !isOneGroup && elements.every((el) => el.containerId === elements[0].containerId);
  const canUngroup = elements.length > 1 && elements.some((el) => el.groupId);

  // "Fit to box" only works on elements that sit in a box and aren't text boxes (same rule as the right-click menu).
  const canFit = elements.some((el) => el.containerId !== null && !getElementAsset(el.assetId)?.isTextBox);

  const handleDuplicate = () => {
    const newIds = duplicateElements(selectedSlideId, elements.map((el) => el.id));
    if (newIds.length > 0) selectElements(newIds);
  };

  const handleDelete = () => {
    deleteElements(selectedSlideId, elements.map((el) => el.id));
  };

  return (
    <div
      data-element-toolbar="true"
      className="flex items-center gap-2 rounded-button border border-border-default bg-bg-surface px-3 py-1.5"
    >
      {elements.length > 1 && (
        <>
          <span className="pl-1 text-xs font-medium text-text-secondary">
            {isOneGroup ? `Group of ${elements.length}` : `${elements.length} selected`}
          </span>
          {canGroup && (
            <button
              type="button"
              title="Group (Ctrl+G)"
              onClick={groupSelectedElements}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
            >
              <GroupIcon size={18} />
            </button>
          )}
          {canUngroup && (
            <button
              type="button"
              title="Ungroup (Ctrl+Shift+G)"
              onClick={ungroupSelectedElements}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
            >
              <UngroupIcon size={18} />
            </button>
          )}
        </>
      )}
      {slide && (
        <ToolPanelButton title="Arrange" icon={<LayersIcon size={18} />} panelWidthClassName="w-64">
          <ArrangePanel slideId={selectedSlideId} box={slide} elements={elements} />
        </ToolPanelButton>
      )}
      {canFit && (
        <button
          type="button"
          title="Fit to box"
          onClick={() => fitElementsToContainer(selectedSlideId, elements.map((el) => el.id))}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
        >
          <FullscreenIcon size={18} />
        </button>
      )}
      {croppable && (
        <button
          type="button"
          title={isCropping ? "Done cropping (Enter)" : "Crop (or double-click the picture)"}
          onClick={() => setCroppingElementId(isCropping ? null : croppable.id)}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page ${isCropping ? "bg-bg-page" : ""}`}
        >
          <CropIcon size={18} />
        </button>
      )}
      {croppable?.crop && (
        <button
          type="button"
          title="Show the whole picture again"
          onClick={resetCrop}
          className="shrink-0 rounded-dropdown px-2 py-1 text-xs font-medium text-text-primary hover:bg-bg-page"
        >
          Reset crop
        </button>
      )}
      <div className="h-5 w-px bg-border-default" />

      {/* Photos have no color of their own to change. */}
      {showColor && !elements.every((el) => el.image) && (
        <>
          <button
            type="button"
            title="Color"
            onClick={() => openColorPanelOn("fill")}
            className="h-6 w-6 shrink-0 rounded-full"
            style={{ background: commonColor ? toCssBackground(commonColor) : MIXED_COLOR_SWATCH, ...outline("fill") }}
          />
          {canRoundCorners && (
            <button
              type="button"
              title="Border"
              onClick={() => openColorPanelOn("border")}
              className="h-6 w-6 shrink-0 rounded-full"
              style={{
                ...(commonBorder
                  ? { border: `4px solid ${commonBorder}` }
                  : { background: commonBorder === undefined ? NONE_SWATCH : MIXED_COLOR_SWATCH, border: "1px solid var(--border-default)" }),
                ...outline("border"),
              }}
            />
          )}
          <div className="mx-1 h-5 w-px bg-border-default" />
        </>
      )}
      {/* A diagram's box look: the picked box, or all boxes when none is picked. */}
      {diagramElement && firstBox && (
        <>
          <span className="text-xs font-medium text-text-secondary">{styleTargets.length === 1 ? "This box" : "All boxes"}</span>
          <button
            type="button"
            title="Box background"
            onClick={() => openColorPanelOn("boxFill")}
            className="h-6 w-6 shrink-0 rounded-full border border-border-default"
            style={{
              background: firstBox.fill === DIAGRAM_NONE ? NONE_SWATCH : (firstBox.fill ?? toCssBackground(diagramElement.color)),
              ...outline("boxFill"),
            }}
          />
          <button
            type="button"
            title="Box border"
            onClick={() => openColorPanelOn("boxBorder")}
            className="h-6 w-6 shrink-0 rounded-full"
            style={{ ...borderSwatch(firstBox.border, diagramElement.color), ...outline("boxBorder") }}
          />
          <button
            type="button"
            title="Box text color"
            onClick={() => openColorPanelOn("boxText")}
            className="h-6 w-6 shrink-0 rounded-full border border-border-default"
            style={{ background: firstBox.textColor ?? DIAGRAM_TEXT_COLOR, ...outline("boxText") }}
          />
          <FontSizePicker
            size={firstBox.fontSize ?? DIAGRAM_FONT_SIZE.default}
            sizes={DIAGRAM_FONT_SIZES}
            onChoose={(fontSize) => setBoxStyle({ fontSize })}
          />
          <button
            type="button"
            title={boxShape === "circle" ? "Box shape: circle (click for rounded)" : "Box shape: rounded (click for circle)"}
            onClick={() => setBoxStyle({ shape: boxShape === "circle" ? "rounded" : "circle" })}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
          >
            {boxShape === "circle" ? <CircleIcon size={16} /> : <SquareIcon size={16} />}
          </button>
          <div className="mx-1 h-5 w-px bg-border-default" />
        </>
      )}
      <ToolPanelButton title="Opacity" icon={<BlendIcon size={16} />}>
        <PanelSlider label="Opacity" value={opacity} min={OPACITY_MIN} max={100} unit="%" onChange={setOpacity} />
        <ResetButton onClick={() => setOpacity(100)} />
      </ToolPanelButton>
      {canRoundCorners && (
        <ToolPanelButton title="Corner radius" icon={<SquareRoundCornerIcon size={16} />}>
          <PanelSlider label="Corner radius" value={cornerRadius} min={0} max={CORNER_RADIUS_MAX} unit="%" onChange={setCornerRadius} />
          <ResetButton onClick={() => setCornerRadius(0)} />
        </ToolPanelButton>
      )}
      {solid && (
        <ToolPanelButton title="Rotate 3D" icon={<Rotate3dIcon size={16} />}>
          <PanelSlider label="Tilt" value={rotation.x} min={-90} max={90} onChange={(x) => setRotation({ x })} />
          <PanelSlider label="Turn" value={rotation.y} min={-180} max={180} onChange={(y) => setRotation({ y })} />
          <ResetButton onClick={() => setRotation(DEFAULT_ROTATION_3D)} />
        </ToolPanelButton>
      )}
      {clock && (
        <ToolPanelButton title="Set time" icon={<ClockIcon size={16} />}>
          <PanelReadout>
            {time.hours}:{String(time.minutes).padStart(2, "0")}
            {clock.assetId === "digital-clock" && ` ${time.pm ? "PM" : "AM"}`}
          </PanelReadout>
          <PanelSlider label="Hour" value={time.hours} min={1} max={12} unit="" onChange={(hours) => setTime({ hours })} />
          <PanelSlider label="Minute" value={time.minutes} min={0} max={59} unit="" onChange={(minutes) => setTime({ minutes })} />
          {/* Only the digital clock shows AM/PM — an analog face looks the same either way. */}
          {clock.assetId === "digital-clock" && (
            <div className="flex gap-2">
              {[false, true].map((pm) => (
                <ToggleChip key={String(pm)} active={!!time.pm === pm} onClick={() => setTime({ pm })} className="flex-1">
                  {pm ? "PM" : "AM"}
                </ToggleChip>
              ))}
            </div>
          )}
          <ResetButton onClick={() => setTime(DEFAULT_CLOCK_TIME)} />
        </ToolPanelButton>
      )}
      {elements.length === 1 && slide && (
        <MathToolControls element={elements[0]} slideId={selectedSlideId} box={slide} />
      )}
      {flippable.length > 0 && (
        <ToolPanelButton title="Flip" icon={<FlipHorizontal2Icon size={16} />} panelWidthClassName="w-48">
          {(["flipX", "flipY"] as const).map((axis) => (
            <button
              key={axis}
              type="button"
              onClick={() => flip(axis)}
              className="flex items-center gap-3 rounded-dropdown px-2 py-1.5 text-sm text-text-primary hover:bg-bg-page"
            >
              <span className={axis === "flipY" ? "rotate-90" : ""}>
                <FlipHorizontal2Icon size={16} />
              </span>
              {axis === "flipX" ? "Flip horizontal" : "Flip vertical"}
            </button>
          ))}
        </ToolPanelButton>
      )}
      {flat && (
        <ToolPanelButton title="Rotate" icon={<RotateCwIcon size={18} />}>
          <div className="flex gap-1">
            {ANGLE_PRESETS.map((preset) => (
              <ToggleChip
                key={preset}
                active={(flat.rotation ?? 0) === preset}
                onClick={() => setAngle(preset)}
                className="flex-1"
              >
                {preset}°
              </ToggleChip>
            ))}
          </div>
          <PanelSlider label="Angle" value={flat.rotation ?? 0} min={-180} max={180} onChange={setAngle} />
          <ResetButton onClick={() => setAngle(0)} />
        </ToolPanelButton>
      )}
      <button
        type="button"
        title="Duplicate"
        onClick={handleDuplicate}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
      >
        <CopyIcon size={16} />
      </button>
      <button
        type="button"
        title="Delete"
        onClick={handleDelete}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page hover:text-danger"
      >
        <Trash2Icon size={18} />
      </button>
    </div>
  );
}
