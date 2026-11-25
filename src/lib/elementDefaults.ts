import type { SvgElement } from "./schema";

/**
 * What a clock, bar graph or diagram shows before the teacher changes it: a new element saves no setting, so the
 * drawing (`svgLibrary.tsx`, which re-exports these) and the downloads (`presentationOutline.ts`) both fall back to
 * these. Kept here, with no drawing code, so tests can load them. The calendar's is `DEFAULT_CALENDAR_DATE`
 * (`calendarDate.ts`).
 */
export type ClockTime = NonNullable<SvgElement["clockTime"]>;
export const DEFAULT_CLOCK_TIME: ClockTime = { hours: 10, minutes: 10, pm: false };

export type BarGraphSettings = NonNullable<SvgElement["barGraph"]>;
export const DEFAULT_BAR_GRAPH: BarGraphSettings = {
  bars: [
    { label: "A", value: 4 },
    { label: "B", value: 7 },
    { label: "C", value: 2 },
  ],
};

export type FlowchartSettings = NonNullable<SvgElement["flowchart"]>;
export const DEFAULT_FLOWCHART: FlowchartSettings = { steps: [{ text: "First" }, { text: "Next" }, { text: "Last" }] };

export type CycleSettings = NonNullable<SvgElement["cycle"]>;
export const DEFAULT_CYCLE: CycleSettings = {
  steps: [{ text: "Egg" }, { text: "Caterpillar" }, { text: "Pupa" }, { text: "Butterfly" }],
};

export type MindMapSettings = NonNullable<SvgElement["mindMap"]>;
export const DEFAULT_MIND_MAP: MindMapSettings = {
  center: { text: "Topic" },
  ideas: [{ text: "Idea 1" }, { text: "Idea 2" }, { text: "Idea 3" }, { text: "Idea 4" }],
};

export type TreeSettings = NonNullable<SvgElement["tree"]>;
export const DEFAULT_TREE: TreeSettings = {
  root: { text: "Animals" },
  branches: [
    { label: { text: "Mammals" }, leaves: [{ text: "Dog" }, { text: "Cat" }] },
    { label: { text: "Birds" }, leaves: [{ text: "Eagle" }] },
  ],
};

export type FactorTreeSettings = NonNullable<SvgElement["factorTree"]>;
export const DEFAULT_FACTOR_TREE: FactorTreeSettings = {
  root: {
    text: "48",
    children: [
      { text: "6", children: [{ text: "2" }, { text: "3" }] },
      { text: "8", children: [{ text: "2" }, { text: "4", children: [{ text: "2" }, { text: "2" }] }] },
    ],
  },
};

// The elements that show one of these, by their asset id (`svgLibrary.tsx`'s ids). The analog clock shows no AM / PM;
// the digital one always does.
export const ANALOG_CLOCK_ID = "clock";
export const DIGITAL_CLOCK_ID = "digital-clock";
export const CALENDAR_IDS = ["calendar-page", "month-calendar"];
export const BAR_GRAPH_ID = "bar-graph";
export const DIAGRAM_IDS = { flowchart: "flowchart", cycle: "cycle", mindMap: "mind-map", tree: "tree-diagram", factorTree: "factor-tree" } as const;
