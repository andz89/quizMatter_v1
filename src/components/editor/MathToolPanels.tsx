"use client";

import { useRef, useState } from "react";
import { useEditorStore } from "@/lib/store";
import {
  getElementAsset,
  getNumberLineValue,
  getTenFrameViewBox,
  getBaseTenViewBox,
  DEFAULT_NUMBER_LINE,
  DEFAULT_FRACTION,
  DEFAULT_FRACTION_NUMBER,
  DEFAULT_TEN_FRAME,
  DEFAULT_BASE_TEN,
  DEFAULT_THERMOMETER,
  DEFAULT_BAR_GRAPH,
  DEFAULT_PROTRACTOR,
  THERMOMETER_MIN,
  THERMOMETER_MAX,
  NUMBER_LINE_STEPS,
  FRACTION_PARTS,
  FRACTION_NUMBER_MAX,
  TEN_FRAME_SIDE_MAX,
  BASE_TEN_MAX,
  BAR_GRAPH_MAX,
  BAR_COUNTS,
  BAR_LABEL_MAX,
} from "@/lib/svgLibrary";
import { getContainerBounds, type BoxLayout } from "@/lib/constants";
import type { SvgElement } from "@/lib/schema";
import { PanelLabel, PanelReadout, PanelSlider, ResetButton, ToggleChip, ToolPanelButton } from "./PanelControls";
import { BlocksIcon, ChartColumnIcon, ChartPieIcon, GaugeIcon, Grid3x3Icon, MoveHorizontalIcon, ThermometerIcon } from "lucide-react";

type Update = (patch: Partial<Omit<SvgElement, "id" | "assetId">>) => void;

interface MathToolControlsProps {
  element: SvgElement;
  slideId: string;
  // The slide's box sizes (question height, layout, shape strip).
  box: BoxLayout;
}

/** The settings button + panel for a selected math tool (number line, fraction, counting frame…), or nothing. */
export function MathToolControls({ element, slideId, box }: MathToolControlsProps) {
  const updateElement = useEditorStore((s) => s.updateElement);
  const asset = getElementAsset(element.assetId);
  const update: Update = (patch) => updateElement(slideId, element.id, patch);

  if (asset?.numberLine)
    return <NumberLineControls key={element.id} element={element} shape={asset.numberLine} update={update} />;
  switch (asset?.mathTool) {
    case "fraction":
      return <FractionControls element={element} update={update} />;
    case "fractionNumber":
      return <FractionNumberControls element={element} update={update} />;
    case "tenFrame":
      return <TenFrameControls key={element.id} element={element} box={box} update={update} />;
    case "baseTen":
      return <BaseTenControls key={element.id} element={element} box={box} update={update} />;
    case "thermometer":
      return <ThermometerControls element={element} update={update} />;
    case "barGraph":
      return <BarGraphControls element={element} update={update} />;
    case "protractor":
      return <ProtractorControls element={element} update={update} />;
    default:
      return null;
  }
}

interface SizeSnapshot {
  viewBox: string;
  width: number;
  height: number;
}

/**
 * Returns a function giving the new size and position for an element whose drawing area changes
 * shape (e.g. a counting frame gaining a column): each drawing unit keeps its on-screen size, then
 * the whole thing scales down if it no longer fits inside its box (question, option or canvas).
 *
 * The size is always worked out from the element's size before the first change, not from the
 * last (maybe shrunk) one — so 1 → 9 → 1 hundreds ends up back at the starting size.
 */
function useResizeForViewBox(element: SvgElement, box: BoxLayout) {
  const base = useRef<{ from: SizeSnapshot; applied: SizeSnapshot } | null>(null);

  return (oldViewBox: string, newViewBox: string) => {
    const last = base.current?.applied;
    // Keep the saved starting size only if nothing else changed the element since (a manual resize, undo…).
    const unchanged =
      last && last.viewBox === oldViewBox && last.width === element.width && last.height === element.height;
    const from = unchanged ? base.current!.from : { viewBox: oldViewBox, width: element.width, height: element.height };
    const [, , fromW, fromH] = from.viewBox.split(" ").map(Number);
    const [, , newW, newH] = newViewBox.split(" ").map(Number);
    const pxPerUnit = Math.min(from.width / fromW, from.height / fromH);
    const bounds = getContainerBounds(element.containerId, box);
    const fit = Math.min(1, bounds.width / (newW * pxPerUnit), bounds.height / (newH * pxPerUnit));
    const width = newW * pxPerUnit * fit;
    const height = newH * pxPerUnit * fit;
    base.current = { from, applied: { viewBox: newViewBox, width, height } };
    return {
      width,
      height,
      x: Math.max(0, Math.min(element.x, bounds.width - width)),
      y: Math.max(0, Math.min(element.y, bounds.height - height)),
    };
  };
}

// Adds `item` to the list, or removes it if it's already there.
function toggle(list: number[], item: number) {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function NumberLineControls({
  element,
  shape,
  update,
}: {
  element: SvgElement;
  shape: { ticks: number; centered: boolean };
  update: Update;
}) {
  const settings = element.numberLine ?? DEFAULT_NUMBER_LINE;
  const set = (patch: Partial<typeof settings>) => update({ numberLine: { ...settings, ...patch } });
  // The typed text is kept here so the box can be empty or hold just "-" while typing.
  const [startText, setStartText] = useState(String(settings.start));

  return (
    <ToolPanelButton title="Edit numbers" icon={<MoveHorizontalIcon size={16} />} wide>
      {/* Centered (integer) lines always keep 0 in the middle, so they have no start. */}
      {!shape.centered && (
        <label className="flex items-center justify-between gap-3">
          <PanelLabel>Start</PanelLabel>
          <input
            type="number"
            value={startText}
            onChange={(e) => {
              setStartText(e.target.value);
              const start = Number(e.target.value);
              if (e.target.value !== "" && Number.isFinite(start)) set({ start });
            }}
            onBlur={() => setStartText(String(settings.start))}
            className="w-20 rounded-input border border-border-default px-2 py-1 text-right text-sm text-text-primary"
          />
        </label>
      )}
      <div className="flex flex-col gap-1.5">
        <PanelLabel>Step</PanelLabel>
        <div className="flex gap-2">
          {NUMBER_LINE_STEPS.map((step) => (
            <ToggleChip key={step} active={settings.step === step} onClick={() => set({ step })} className="flex-1">
              {step}
            </ToggleChip>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <PanelLabel>Hide numbers</PanelLabel>
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: shape.ticks }, (_, i) => (
            <ToggleChip
              key={i}
              active={settings.hidden.includes(i)}
              onClick={() => set({ hidden: toggle(settings.hidden, i) })}
              className="min-w-8 px-1"
            >
              {getNumberLineValue(i, shape.ticks, shape.centered, settings)}
            </ToggleChip>
          ))}
        </div>
      </div>
      <ResetButton
        onClick={() => {
          set(DEFAULT_NUMBER_LINE);
          setStartText(String(DEFAULT_NUMBER_LINE.start));
        }}
      />
    </ToolPanelButton>
  );
}

function FractionControls({ element, update }: { element: SvgElement; update: Update }) {
  const fraction = element.fraction ?? DEFAULT_FRACTION;
  const set = (patch: Partial<typeof fraction>) => {
    const next = { ...fraction, ...patch };
    // Can't shade more parts than there are (e.g. 3/4 becomes 2/2 when parts drops to 2).
    update({ fraction: { ...next, shaded: Math.min(next.shaded, next.parts) } });
  };

  return (
    <ToolPanelButton title="Edit fraction" icon={<ChartPieIcon size={16} />}>
      <PanelReadout>
        {fraction.shaded}/{fraction.parts}
      </PanelReadout>
      <PanelSlider label="Parts" value={fraction.parts} min={FRACTION_PARTS.min} max={FRACTION_PARTS.max} unit="" onChange={(parts) => set({ parts })} />
      <PanelSlider label="Shaded" value={fraction.shaded} min={0} max={fraction.parts} unit="" onChange={(shaded) => set({ shaded })} />
      <ResetButton onClick={() => set(DEFAULT_FRACTION)} />
    </ToolPanelButton>
  );
}

// Written fraction: type any numerator and denominator, so improper fractions like 5/4 work too.
function FractionNumberControls({ element, update }: { element: SvgElement; update: Update }) {
  const fraction = element.fraction ?? DEFAULT_FRACTION_NUMBER;
  const set = (patch: Partial<typeof fraction>) => update({ fraction: { ...fraction, ...patch } });

  return (
    <ToolPanelButton title="Edit fraction" icon={<ChartPieIcon size={16} />}>
      <PanelReadout>
        {fraction.shaded}/{fraction.parts}
      </PanelReadout>
      <FractionNumberBox label="Numerator" value={fraction.shaded} min={0} onChange={(shaded) => set({ shaded })} />
      {/* Never 0 — you can't divide by zero. */}
      <FractionNumberBox label="Denominator" value={fraction.parts} min={1} onChange={(parts) => set({ parts })} />
      <ResetButton onClick={() => set(DEFAULT_FRACTION_NUMBER)} />
    </ToolPanelButton>
  );
}

// Only whole numbers in range are saved; a half-typed or empty box just leaves the fraction as it was.
// The typed text is kept here so the box can be emptied while typing a new number.
function FractionNumberBox({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  // Show the saved value whenever it changes from outside (Reset, undo) — but not mid-typing.
  const shown = text !== "" && Number(text) !== value ? String(value) : text;

  return (
    <label className="flex items-center justify-between gap-3">
      <PanelLabel>{label}</PanelLabel>
      <input
        type="number"
        min={min}
        max={FRACTION_NUMBER_MAX}
        value={shown}
        onChange={(e) => {
          setText(e.target.value);
          const next = Number(e.target.value);
          if (e.target.value !== "" && Number.isInteger(next) && next >= min && next <= FRACTION_NUMBER_MAX) onChange(next);
        }}
        onBlur={() => setText(String(value))}
        className="w-20 rounded-input border border-border-default px-2 py-1 text-right text-sm text-text-primary"
      />
    </label>
  );
}

const FRAME_PRESETS = [
  { total: 5, rows: 1, columns: 5 },
  { total: 10, rows: 2, columns: 5 },
  { total: 20, rows: 2, columns: 10 },
];

function TenFrameControls({ element, box, update }: { element: SvgElement; box: BoxLayout; update: Update }) {
  const tenFrame = { ...DEFAULT_TEN_FRAME, ...element.tenFrame };
  const rows = tenFrame.rows ?? 2;
  const columns = tenFrame.columns ?? 5;
  const resize = useResizeForViewBox(element, box);
  const set = (patch: Partial<typeof tenFrame>) => {
    const next = { ...tenFrame, ...patch };
    // Can't have more dots than boxes (e.g. 8 dots on a 1×5 frame becomes 5).
    next.count = Math.min(next.count, (next.rows ?? 2) * (next.columns ?? 5));
    update({ tenFrame: next, ...resize(getTenFrameViewBox(tenFrame), getTenFrameViewBox(next)) });
  };

  return (
    <ToolPanelButton title="Edit count" icon={<Grid3x3Icon size={16} />}>
      <div className="flex gap-2">
        {FRAME_PRESETS.map((preset) => (
          <ToggleChip
            key={preset.total}
            active={rows === preset.rows && columns === preset.columns}
            onClick={() => set({ rows: preset.rows, columns: preset.columns })}
            className="flex-1"
          >
            {preset.total}
          </ToggleChip>
        ))}
      </div>
      <PanelSlider label="Rows" value={rows} min={1} max={TEN_FRAME_SIDE_MAX} unit="" onChange={(rows) => set({ rows })} />
      <PanelSlider label="Columns" value={columns} min={1} max={TEN_FRAME_SIDE_MAX} unit="" onChange={(columns) => set({ columns })} />
      <PanelSlider label="Count" value={tenFrame.count} min={0} max={rows * columns} unit="" onChange={(count) => set({ count })} />
      <ResetButton onClick={() => set(DEFAULT_TEN_FRAME)} />
    </ToolPanelButton>
  );
}

function BaseTenControls({ element, box, update }: { element: SvgElement; box: BoxLayout; update: Update }) {
  const blocks = element.baseTen ?? DEFAULT_BASE_TEN;
  const resize = useResizeForViewBox(element, box);
  const set = (patch: Partial<typeof blocks>) => {
    const next = { ...blocks, ...patch };
    update({ baseTen: next, ...resize(getBaseTenViewBox(blocks), getBaseTenViewBox(next)) });
  };

  return (
    <ToolPanelButton title="Edit blocks" icon={<BlocksIcon size={16} />}>
      <PanelReadout>{blocks.hundreds * 100 + blocks.tens * 10 + blocks.ones}</PanelReadout>
      <PanelSlider label="Hundreds" value={blocks.hundreds} min={0} max={BASE_TEN_MAX} unit="" onChange={(hundreds) => set({ hundreds })} />
      <PanelSlider label="Tens" value={blocks.tens} min={0} max={BASE_TEN_MAX} unit="" onChange={(tens) => set({ tens })} />
      <PanelSlider label="Ones" value={blocks.ones} min={0} max={BASE_TEN_MAX} unit="" onChange={(ones) => set({ ones })} />
      <ResetButton onClick={() => set(DEFAULT_BASE_TEN)} />
    </ToolPanelButton>
  );
}

function ThermometerControls({ element, update }: { element: SvgElement; update: Update }) {
  const { value } = element.thermometer ?? DEFAULT_THERMOMETER;
  const set = (value: number) => update({ thermometer: { value } });

  return (
    <ToolPanelButton title="Set temperature" icon={<ThermometerIcon size={16} />}>
      <PanelSlider label="Temperature" value={value} min={THERMOMETER_MIN} max={THERMOMETER_MAX} unit=" °C" onChange={set} />
      <ResetButton onClick={() => set(DEFAULT_THERMOMETER.value)} />
    </ToolPanelButton>
  );
}

function BarGraphControls({ element, update }: { element: SvgElement; update: Update }) {
  const { bars } = element.barGraph ?? DEFAULT_BAR_GRAPH;
  const setBars = (next: typeof bars) => update({ barGraph: { bars: next } });
  const setBar = (index: number, patch: Partial<(typeof bars)[number]>) =>
    setBars(bars.map((bar, i) => (i === index ? { ...bar, ...patch } : bar)));
  // Adding bars keeps the existing ones and names new ones by letter (D, E, F…).
  const setCount = (count: number) =>
    setBars(
      Array.from({ length: count }, (_, i) => bars[i] ?? { label: String.fromCharCode(65 + i), value: 5 }),
    );

  return (
    <ToolPanelButton title="Edit graph" icon={<ChartColumnIcon size={16} />} wide>
      <div className="flex flex-col gap-1.5">
        <PanelLabel>Bars</PanelLabel>
        <div className="flex gap-1.5">
          {BAR_COUNTS.map((count) => (
            <ToggleChip key={count} active={bars.length === count} onClick={() => setCount(count)} className="flex-1">
              {count}
            </ToggleChip>
          ))}
        </div>
      </div>
      {bars.map((bar, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="text"
            value={bar.label}
            maxLength={BAR_LABEL_MAX}
            onChange={(e) => setBar(i, { label: e.target.value })}
            className="w-20 rounded-input border border-border-default px-2 py-1 text-sm text-text-primary"
          />
          <input
            type="range"
            min={0}
            max={BAR_GRAPH_MAX}
            value={bar.value}
            onChange={(e) => setBar(i, { value: Number(e.target.value) })}
            className="min-w-0 flex-1 accent-[var(--accent)]"
          />
          <span className="w-5 text-right text-xs text-text-secondary tabular-nums">{bar.value}</span>
        </div>
      ))}
      <ResetButton onClick={() => setBars(DEFAULT_BAR_GRAPH.bars)} />
    </ToolPanelButton>
  );
}

function ProtractorControls({ element, update }: { element: SvgElement; update: Update }) {
  const { angle } = element.protractor ?? DEFAULT_PROTRACTOR;
  const set = (angle: number) => update({ protractor: { angle } });

  return (
    <ToolPanelButton title="Set angle" icon={<GaugeIcon size={16} />}>
      <PanelSlider label="Angle" value={angle} min={0} max={180} onChange={set} />
      <ResetButton onClick={() => set(DEFAULT_PROTRACTOR.angle)} />
    </ToolPanelButton>
  );
}
