"use client";

import { useEditorStore } from "@/lib/store";
import { canCrop, getElementAsset, DEFAULT_CLOCK_TIME } from "@/lib/svgLibrary";
import { DEFAULT_ROTATION_3D } from "@/lib/solids";
import { getContainerBounds, OPACITY_MIN } from "@/lib/constants";
import { boxForShownPart, getCropFrame } from "@/lib/crop";
import { fitInBox } from "@/lib/geometry";
import { toCssBackground } from "./ElementSvg";
import { RotateIcon } from "./SvgElementItem";
import { ArrangePanel } from "./ArrangePanel";
import { MathToolControls } from "./MathToolPanels";
import { PanelReadout, PanelSlider, ResetButton, ToggleChip, ToolPanelButton } from "./PanelControls";
import { DuplicateIcon } from "@/components/icons/DuplicateIcon";
import { TrashIcon } from "@/components/icons/TrashIcon";

// Quick angles shown above the Rotate slider.
const ANGLE_PRESETS = [-90, -45, 0, 45, 90, 180];

const MIXED_COLOR_SWATCH = "conic-gradient(#191A2C, #1E8E4F, #F2A93B, #A8A6A1, #1F1F1F, #191A2C)";

/** Centered header container for the selected SVG element(s)' color, duplicate, and delete controls. */
export function SelectedElementToolbar() {
  const selectedSlideId = useEditorStore((s) => s.selectedSlideId);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const slide = useEditorStore((s) => s.quiz.slides.find((sl) => sl.id === s.selectedSlideId));
  const deleteElements = useEditorStore((s) => s.deleteElements);
  const duplicateElements = useEditorStore((s) => s.duplicateElements);
  const groupSelectedElements = useEditorStore((s) => s.groupSelectedElements);
  const ungroupSelectedElements = useEditorStore((s) => s.ungroupSelectedElements);
  const selectElements = useEditorStore((s) => s.selectElements);
  const isColorPanelOpen = useEditorStore((s) => s.isColorPanelOpen);
  const toggleColorPanel = useEditorStore((s) => s.toggleColorPanel);
  const updateElement = useEditorStore((s) => s.updateElement);
  const updateElements = useEditorStore((s) => s.updateElements);
  const fitElementsToContainer = useEditorStore((s) => s.fitElementsToContainer);
  const croppingElementId = useEditorStore((s) => s.croppingElementId);
  const setCroppingElementId = useEditorStore((s) => s.setCroppingElementId);

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

  // Opacity applies to every selected element at once; the slider starts at the first one's value.
  const opacity = elements[0].opacity ?? 100;
  const setOpacity = (value: number) => {
    const clamped = Math.min(100, Math.max(OPACITY_MIN, value));
    updateElements(selectedSlideId, Object.fromEntries(elements.map((el) => [el.id, { opacity: clamped }])));
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
      className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-button border border-border-default bg-bg-surface px-3 py-1.5"
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
              <GroupIcon />
            </button>
          )}
          {canUngroup && (
            <button
              type="button"
              title="Ungroup (Ctrl+Shift+G)"
              onClick={ungroupSelectedElements}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
            >
              <UngroupIcon />
            </button>
          )}
        </>
      )}
      {slide && (
        <ToolPanelButton title={elements.length > 1 ? "Arrange" : "Align"} icon={<ArrangeIcon />} panelWidthClassName="w-64">
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
          <FitToBoxIcon />
        </button>
      )}
      {croppable && (
        <button
          type="button"
          title={isCropping ? "Done cropping (Enter)" : "Crop (or double-click the picture)"}
          onClick={() => setCroppingElementId(isCropping ? null : croppable.id)}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page ${isCropping ? "bg-bg-page" : ""}`}
        >
          <CropIcon />
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

      <button
        type="button"
        title="Color"
        onClick={toggleColorPanel}
        className="h-6 w-6 shrink-0 rounded-full"
        style={{
          background: commonColor ? toCssBackground(commonColor) : MIXED_COLOR_SWATCH,
          outline: isColorPanelOpen ? "2px solid var(--accent-navy)" : "2px solid transparent",
          outlineOffset: 2,
        }}
      />
      <div className="mx-1 h-5 w-px bg-border-default" />
      <ToolPanelButton title="Opacity" icon={<OpacityIcon />}>
        <PanelSlider label="Opacity" value={opacity} min={OPACITY_MIN} max={100} unit="%" onChange={setOpacity} />
        <ResetButton onClick={() => setOpacity(100)} />
      </ToolPanelButton>
      {solid && (
        <ToolPanelButton title="Rotate 3D" icon={<Rotate3dIcon />}>
          <PanelSlider label="Tilt" value={rotation.x} min={-90} max={90} onChange={(x) => setRotation({ x })} />
          <PanelSlider label="Turn" value={rotation.y} min={-180} max={180} onChange={(y) => setRotation({ y })} />
          <ResetButton onClick={() => setRotation(DEFAULT_ROTATION_3D)} />
        </ToolPanelButton>
      )}
      {clock && (
        <ToolPanelButton title="Set time" icon={<ClockIcon />}>
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
        <ToolPanelButton title="Flip" icon={<FlipIcon />} panelWidthClassName="w-48">
          {(["flipX", "flipY"] as const).map((axis) => (
            <button
              key={axis}
              type="button"
              onClick={() => flip(axis)}
              className="flex items-center gap-3 rounded-dropdown px-2 py-1.5 text-sm text-text-primary hover:bg-bg-page"
            >
              <span className={axis === "flipY" ? "rotate-90" : ""}>
                <FlipIcon />
              </span>
              {axis === "flipX" ? "Flip horizontal" : "Flip vertical"}
            </button>
          ))}
        </ToolPanelButton>
      )}
      {flat && (
        <ToolPanelButton title="Rotate" icon={<RotateIcon />}>
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
        <DuplicateIcon />
      </button>
      <button
        type="button"
        title="Delete"
        onClick={handleDelete}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page hover:text-accent-orange"
      >
        <TrashIcon />
      </button>
    </div>
  );
}

function Rotate3dIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <path d="M8 2.5 12.5 5v5L8 12.5 3.5 10V5Z" />
      <path d="M3.5 5 8 7.5l4.5-2.5M8 7.5v5" />
      <path d="M1.5 9.5a7 3 0 0 0 11 3.2" strokeLinecap="round" />
      <path d="m11 11.4 1.7 1.3-1.4 1.5" strokeLinecap="round" />
    </svg>
  );
}

function OpacityIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="M2 8h12M8 2v12" strokeOpacity="0.35" />
      <path d="M8 2h4a2 2 0 0 1 2 2v4H8ZM2 8h6v6H4a2 2 0 0 1-2-2Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="8" cy="8" r="6.3" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  );
}

function ArrangeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M2 1.5v13" />
      <rect x="4.5" y="3" width="9" height="3.5" rx="1" />
      <rect x="4.5" y="9.5" width="6" height="3.5" rx="1" />
    </svg>
  );
}

function FlipIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <path d="M8 1.5v13" strokeDasharray="1.5 1.5" strokeLinecap="round" />
      <path d="M6 3.5 1.5 12.5H6Z" />
      <path d="M10 3.5l4.5 9H10Z" fill="currentColor" />
    </svg>
  );
}

function CropIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 1.5V11a1 1 0 0 0 1 1h9.5" />
      <path d="M1.5 4H11a1 1 0 0 1 1 1v9.5" />
    </svg>
  );
}

function FitToBoxIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 5V2.5a1 1 0 0 1 1-1H5M11 1.5h2.5a1 1 0 0 1 1 1V5M14.5 11v2.5a1 1 0 0 1-1 1H11M5 14.5H2.5a1 1 0 0 1-1-1V11" />
      <rect x="5" y="5" width="6" height="6" rx="1" />
    </svg>
  );
}

function GroupIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
      <rect x="4" y="4" width="4.5" height="4.5" rx="0.8" />
      <rect x="7.5" y="7.5" width="4.5" height="4.5" rx="0.8" />
    </svg>
  );
}

function UngroupIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <rect x="1.5" y="1.5" width="13" height="13" rx="2" strokeDasharray="2 2" />
      <rect x="4" y="4" width="4.5" height="4.5" rx="0.8" />
      <rect x="7.5" y="7.5" width="4.5" height="4.5" rx="0.8" />
    </svg>
  );
}
