"use client";

import { useRef, useState } from "react";
import { useEditorStore } from "@/lib/store";
import {
  getElementAsset,
  getNumberLineValue,
  getTenFrameViewBox,
  getBaseTenViewBox,
  getFlowchartViewBox,
  getCycleViewBox,
  getMindMapViewBox,
  getTreeViewBox,
  getFactorTreeViewBox,
  DEFAULT_NUMBER_LINE,
  DEFAULT_FRACTION,
  DEFAULT_FRACTION_NUMBER,
  DEFAULT_TEN_FRAME,
  DEFAULT_BASE_TEN,
  DEFAULT_THERMOMETER,
  DEFAULT_BAR_GRAPH,
  DEFAULT_PROTRACTOR,
  DEFAULT_FLOWCHART,
  DEFAULT_CYCLE,
  DEFAULT_MIND_MAP,
  DEFAULT_TREE,
  DEFAULT_FACTOR_TREE,
  type FactorTreeSettings,
  type DiagramBoxItem,
  diagramBoxLook,
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
import {
  getContainerBounds,
  CYCLE_STEPS,
  FLOWCHART_STEPS,
  MIND_MAP_IDEAS,
  TREE_BRANCHES,
  TREE_LEAVES_MAX,
  type BoxLayout,
} from "@/lib/constants";
import type { FactorNode, SvgElement } from "@/lib/schema";
import { PanelLabel, PanelReadout, PanelSlider, ResetButton, ToggleChip, ToolPanelButton } from "./PanelControls";
import {
  BlocksIcon,
  ChartColumnIcon,
  ChartPieIcon,
  GaugeIcon,
  GitForkIcon,
  Grid3x3Icon,
  MoveHorizontalIcon,
  NetworkIcon,
  PlusIcon,
  RefreshCwIcon,
  ThermometerIcon,
  WaypointsIcon,
  WorkflowIcon,
  XIcon,
} from "lucide-react";

type Update = (patch: Partial<Omit<SvgElement, "id" | "assetId">>) => void;

interface MathToolControlsProps {
  element: SvgElement;
  slideId: string;
  // The slide's box sizes (question height, layout, shape strip).
  box: BoxLayout;
}

/** The settings button + panel for a selected math tool or diagram (number line, fraction, flowchart…), or nothing. */
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
    case "flowchart":
      return <FlowchartControls key={element.id} element={element} box={box} update={update} />;
    case "cycle":
      return <CycleControls key={element.id} element={element} box={box} update={update} />;
    case "mindMap":
      return <MindMapControls key={element.id} element={element} box={box} update={update} />;
    case "tree":
      return <TreeControls key={element.id} element={element} box={box} update={update} />;
    case "factorTree":
      return <FactorTreeControls key={element.id} element={element} box={box} update={update} />;
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
    // Same drawing area (e.g. typing in a diagram box): leave the element where the teacher put it.
    if (oldViewBox === newViewBox) return {};
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
    // A diagram's drawing area can start somewhere other than 0 (a box was dragged up or left). When
    // that start moves (e.g. that box was removed), shift the element by the same amount so the other
    // boxes stay where they were. Always 0 for the other tools.
    const [oldMinX, oldMinY] = oldViewBox.split(" ").map(Number);
    const [newMinX, newMinY] = newViewBox.split(" ").map(Number);
    const scale = pxPerUnit * fit;
    const x = element.x + (newMinX - oldMinX) * scale;
    const y = element.y + (newMinY - oldMinY) * scale;
    return {
      width,
      height,
      x: Math.max(0, Math.min(x, bounds.width - width)),
      y: Math.max(0, Math.min(y, bounds.height - height)),
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

// ---------------------------------------------------------------------------------------------
// Diagrams (flowchart, cycle, mind map, tree, factor tree): how many boxes. Their text is typed on the slide
// (double-click a box), and their place and size are set by dragging there.
// ---------------------------------------------------------------------------------------------

// A tree box's text, read-only, on one line (typed on the slide), so the teacher knows which box a × removes.
function DiagramBoxName({ box }: { box: DiagramBoxItem }) {
  const text = box.text.replace(/\s+/g, " ").trim();
  return (
    <span title={text} className={`min-w-0 flex-1 truncate text-sm ${text ? "text-text-primary" : "text-text-secondary"}`}>
      {text || "Empty box"}
    </span>
  );
}

// A box back in its automatic spot and size, keeping its text and look.
const autoPlaced = (box: DiagramBoxItem): DiagramBoxItem => ({ ...diagramBoxLook(box), text: box.text });

// "Tidy up" (every box back in its own spot and size, text kept) and Reset (everything back to the start).
function DiagramButtons({ onTidy, onReset }: { onTidy: () => void; onReset: () => void }) {
  return (
    <div className="flex justify-end gap-4">
      <button
        type="button"
        onClick={onTidy}
        title="Put every box back in its own spot and size"
        className="text-xs font-semibold text-accent hover:opacity-80"
      >
        Tidy up
      </button>
      <ResetButton onClick={onReset} />
    </div>
  );
}

// `list` with item `index` replaced by `value`.
function replaceAt<T>(list: T[], index: number, value: T) {
  return list.map((old, i) => (i === index ? value : old));
}

// How many boxes. Adding boxes keeps the old ones; new ones are named by `newText` and look like the last box.
function DiagramBoxCount({
  label,
  items,
  min,
  max,
  newText,
  onChange,
}: {
  label: string;
  items: DiagramBoxItem[];
  min: number;
  max: number;
  newText: (index: number) => string;
  onChange: (items: DiagramBoxItem[]) => void;
}) {
  return (
    <PanelSlider
      label={label}
      value={items.length}
      min={min}
      max={max}
      unit=""
      onChange={(count) =>
        onChange(Array.from({ length: count }, (_, i) => items[i] ?? { ...diagramBoxLook(items[items.length - 1]), text: newText(i) }))
      }
    />
  );
}

function FlowchartControls({ element, box, update }: { element: SvgElement; box: BoxLayout; update: Update }) {
  const flowchart = element.flowchart ?? DEFAULT_FLOWCHART;
  const resize = useResizeForViewBox(element, box);
  const set = (patch: Partial<typeof flowchart>) => {
    const next = { ...flowchart, ...patch };
    update({ flowchart: next, ...resize(getFlowchartViewBox(flowchart), getFlowchartViewBox(next)) });
  };

  return (
    <ToolPanelButton title="Edit flowchart" icon={<WorkflowIcon size={16} />} wide>
      <div className="flex gap-2">
        <ToggleChip active={!flowchart.vertical} onClick={() => set({ vertical: false })} className="flex-1">
          Across
        </ToggleChip>
        <ToggleChip active={!!flowchart.vertical} onClick={() => set({ vertical: true })} className="flex-1">
          Down
        </ToggleChip>
      </div>
      <DiagramBoxCount
        label="Steps"
        items={flowchart.steps}
        min={FLOWCHART_STEPS.min}
        max={FLOWCHART_STEPS.max}
        newText={(i) => `Step ${i + 1}`}
        onChange={(steps) => set({ steps })}
      />
      <DiagramButtons onTidy={() => set({ steps: flowchart.steps.map(autoPlaced) })} onReset={() => set(DEFAULT_FLOWCHART)} />
    </ToolPanelButton>
  );
}

function CycleControls({ element, box, update }: { element: SvgElement; box: BoxLayout; update: Update }) {
  const cycle = element.cycle ?? DEFAULT_CYCLE;
  const resize = useResizeForViewBox(element, box);
  const setSteps = (steps: DiagramBoxItem[]) => {
    const next = { steps };
    update({ cycle: next, ...resize(getCycleViewBox(cycle), getCycleViewBox(next)) });
  };

  return (
    <ToolPanelButton title="Edit cycle" icon={<RefreshCwIcon size={16} />} wide>
      <DiagramBoxCount
        label="Steps"
        items={cycle.steps}
        min={CYCLE_STEPS.min}
        max={CYCLE_STEPS.max}
        newText={(i) => `Step ${i + 1}`}
        onChange={setSteps}
      />
      <DiagramButtons onTidy={() => setSteps(cycle.steps.map(autoPlaced))} onReset={() => setSteps(DEFAULT_CYCLE.steps)} />
    </ToolPanelButton>
  );
}

function MindMapControls({ element, box, update }: { element: SvgElement; box: BoxLayout; update: Update }) {
  const mindMap = element.mindMap ?? DEFAULT_MIND_MAP;
  const resize = useResizeForViewBox(element, box);
  const set = (patch: Partial<typeof mindMap>) => {
    const next = { ...mindMap, ...patch };
    update({ mindMap: next, ...resize(getMindMapViewBox(mindMap), getMindMapViewBox(next)) });
  };

  return (
    <ToolPanelButton title="Edit mind map" icon={<WaypointsIcon size={16} />} wide>
      <DiagramBoxCount
        label="Ideas"
        items={mindMap.ideas}
        min={MIND_MAP_IDEAS.min}
        max={MIND_MAP_IDEAS.max}
        newText={(i) => `Idea ${i + 1}`}
        onChange={(ideas) => set({ ideas })}
      />
      <DiagramButtons
        onTidy={() => set({ center: autoPlaced(mindMap.center), ideas: mindMap.ideas.map(autoPlaced) })}
        onReset={() => set(DEFAULT_MIND_MAP)}
      />
    </ToolPanelButton>
  );
}

// A small icon button to remove a box in the tree panel.
function TreeRemoveButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-dropdown text-text-secondary hover:bg-bg-page hover:text-text-primary"
    >
      <XIcon size={14} />
    </button>
  );
}

// A text button like "+ Add branch".
function TreeAddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 self-start text-xs font-semibold text-accent hover:opacity-80"
    >
      <PlusIcon size={14} />
      {label}
    </button>
  );
}

function TreeControls({ element, box, update }: { element: SvgElement; box: BoxLayout; update: Update }) {
  const tree = element.tree ?? DEFAULT_TREE;
  const resize = useResizeForViewBox(element, box);
  const set = (patch: Partial<typeof tree>) => {
    const next = { ...tree, ...patch };
    update({ tree: next, ...resize(getTreeViewBox(tree), getTreeViewBox(next)) });
  };
  const setBranch = (index: number, patch: Partial<(typeof tree.branches)[number]>) =>
    set({ branches: replaceAt(tree.branches, index, { ...tree.branches[index], ...patch }) });

  return (
    <ToolPanelButton title="Edit tree" icon={<NetworkIcon size={16} />} wide>
      <div className="flex max-h-80 flex-col gap-3 overflow-y-auto">
        <PanelLabel>Branches</PanelLabel>
        {tree.branches.map((branch, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1">
              <DiagramBoxName box={branch.label} />
              {tree.branches.length > TREE_BRANCHES.min && (
                <TreeRemoveButton title="Remove branch" onClick={() => set({ branches: tree.branches.filter((_, j) => j !== i) })} />
              )}
            </div>
            {/* The smaller boxes under this branch, indented. */}
            <div className="flex flex-col gap-1.5 pl-4">
              {branch.leaves.map((leaf, j) => (
                <div key={j} className="flex items-center gap-1">
                  <DiagramBoxName box={leaf} />
                  <TreeRemoveButton
                    title="Remove box"
                    onClick={() => setBranch(i, { leaves: branch.leaves.filter((_, k) => k !== j) })}
                  />
                </div>
              ))}
              {branch.leaves.length < TREE_LEAVES_MAX && (
                <TreeAddButton
                  label="Add box"
                  onClick={() => setBranch(i, { leaves: [...branch.leaves, { ...diagramBoxLook(branch.leaves.at(-1) ?? branch.label), text: "Item" }] })}
                />
              )}
            </div>
          </div>
        ))}
        {tree.branches.length < TREE_BRANCHES.max && (
          <TreeAddButton
            label="Add branch"
            onClick={() =>
              set({ branches: [...tree.branches, { label: { ...diagramBoxLook(tree.branches.at(-1)?.label), text: "Group" }, leaves: [] }] })
            }
          />
        )}
      </div>
      <DiagramButtons
        onTidy={() =>
          set({
            root: autoPlaced(tree.root),
            branches: tree.branches.map((branch) => ({ label: autoPlaced(branch.label), leaves: branch.leaves.map(autoPlaced) })),
          })
        }
        onReset={() => set(DEFAULT_TREE)}
      />
    </ToolPanelButton>
  );
}

function FactorTreeControls({ element, box, update }: { element: SvgElement; box: BoxLayout; update: Update }) {
  const factorTree = element.factorTree ?? DEFAULT_FACTOR_TREE;
  const resize = useResizeForViewBox(element, box);
  const set = (next: FactorTreeSettings) =>
    update({ factorTree: next, ...resize(getFactorTreeViewBox(factorTree), getFactorTreeViewBox(next)) });
  // Every number back in its automatic spot and size, keeping its text, look and split.
  const tidy = (node: FactorNode): FactorNode => ({
    ...autoPlaced(node),
    ...(node.children && { children: [tidy(node.children[0]), tidy(node.children[1])] }),
  });

  return (
    <ToolPanelButton title="Edit factor tree" icon={<GitForkIcon size={16} />} wide>
      <p className="text-xs text-text-secondary">Use + under a number to split it, or × to remove a pair.</p>
      <DiagramButtons onTidy={() => set({ root: tidy(factorTree.root) })} onReset={() => set(DEFAULT_FACTOR_TREE)} />
    </ToolPanelButton>
  );
}
