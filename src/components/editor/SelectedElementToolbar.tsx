"use client";

import { useState } from "react";
import { useEditorStore } from "@/lib/store";
import { getElementAsset, DEFAULT_CLOCK_TIME } from "@/lib/svgLibrary";
import { DEFAULT_ROTATION_3D } from "@/lib/solids";
import { toCssBackground } from "./ElementSvg";
import { RotateIcon } from "./SvgElementItem";
import { ArrangePanel } from "./ArrangePanel";
import { MathToolControls } from "./MathToolPanels";
import { PanelReadout, PanelSlider, ResetButton, ToggleChip, ToolPanelButton } from "./PanelControls";

const MIXED_COLOR_SWATCH = "conic-gradient(#191A2C, #1E8E4F, #F2A93B, #A8A6A1, #1F1F1F, #191A2C)";

/** Centered header container for the selected SVG element(s)' color, duplicate, and delete controls. */
export function SelectedElementToolbar() {
  const selectedSlideId = useEditorStore((s) => s.selectedSlideId);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const slide = useEditorStore((s) => s.quiz.slides.find((sl) => sl.id === s.selectedSlideId));
  const deleteElement = useEditorStore((s) => s.deleteElement);
  const duplicateElements = useEditorStore((s) => s.duplicateElements);
  const groupSelectedElements = useEditorStore((s) => s.groupSelectedElements);
  const ungroupSelectedElements = useEditorStore((s) => s.ungroupSelectedElements);
  const selectElements = useEditorStore((s) => s.selectElements);
  const isColorPanelOpen = useEditorStore((s) => s.isColorPanelOpen);
  const toggleColorPanel = useEditorStore((s) => s.toggleColorPanel);
  const updateElement = useEditorStore((s) => s.updateElement);
  const [isArrangePanelOpen, setIsArrangePanelOpen] = useState(false);

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

  const commonColor = elements.every((el) => el.color === elements[0].color) ? elements[0].color : null;

  // Selection is exactly one whole group → offer Ungroup. 2+ elements in one box otherwise → offer Group.
  const isOneGroup = !!elements[0].groupId && elements.every((el) => el.groupId === elements[0].groupId);
  const canGroup = elements.length > 1 && !isOneGroup && elements.every((el) => el.containerId === elements[0].containerId);
  const canUngroup = elements.length > 1 && elements.some((el) => el.groupId);

  const handleDuplicate = () => {
    const newIds = duplicateElements(selectedSlideId, elements.map((el) => el.id));
    if (newIds.length > 0) selectElements(newIds);
  };

  const handleDelete = () => {
    elements.forEach((el) => deleteElement(selectedSlideId, el.id));
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
          <div className="relative">
            <button
              type="button"
              title="Arrange"
              onClick={() => setIsArrangePanelOpen((open) => !open)}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page ${isArrangePanelOpen ? "bg-bg-page" : ""}`}
            >
              <ArrangeIcon />
            </button>
            {isArrangePanelOpen && slide && (
              <ArrangePanel slideId={selectedSlideId} questionHeight={slide.questionHeight} elements={elements} />
            )}
          </div>
          <div className="h-5 w-px bg-border-default" />
        </>
      )}

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
        <MathToolControls element={elements[0]} slideId={selectedSlideId} questionHeight={slide.questionHeight} />
      )}
      {flat && (
        <ToolPanelButton title="Rotate" icon={<RotateIcon />}>
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

function DuplicateIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.5" y="1.5" width="8" height="8" rx="1.2" />
      <path d="M4.5 12.5h6a2 2 0 0 0 2-2v-6" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M2.5 3.5h9M5 3.5V2h4v1.5M5.5 6.5v4M8.5 6.5v4M3.5 3.5l.5 8h6l.5-8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
