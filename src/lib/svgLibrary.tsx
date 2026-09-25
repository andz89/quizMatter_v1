import type { ReactNode } from "react";
import { renderSolid, SOLIDS } from "./solids";
import type { SvgElement } from "./schema";
import { DEFAULT_TEXT_COLOR } from "./richText";

export type ElementCategory = "shape" | "line" | "arrow" | "solid" | "icon" | "time" | "math" | "decorative" | "cloud" | "number" | "letter" | "symbol" | "emoji" | "music" | "fruit" | "kitchen" | "vehicle" | "animal" | "space" | "sport" | "tree" | "leaf" | "background" | "text";

// The per-element settings some assets draw from (3D angle, clock time, number line numbers).
// A whole SvgElement fits here, so callers can just pass the element.
export type RenderSettings = Partial<Pick<
  SvgElement,
  | "rotation3d"
  | "clockTime"
  | "numberLine"
  | "fraction"
  | "tenFrame"
  | "baseTen"
  | "thermometer"
  | "barGraph"
  | "protractor"
  | "text"
  | "svg"
  | "width"
  | "height"
>>;

interface ElementAsset {
  id: string;
  category: ElementCategory;
  label: string;
  // Color a new element starts with (and shows in the Elements panel); falls back to DEFAULT_ELEMENT_COLOR.
  defaultColor?: string;
  // True for solid shapes that can be rotated in 3D; only those use `rotation3d`.
  is3d?: boolean;
  // True for the clocks; only they use `clockTime`.
  isClock?: boolean;
  // True for the text box; only it uses `text`. On the slide it shows its text instead of `render`,
  // which just draws the "T" icon for the Elements panel.
  isTextBox?: boolean;
  // Set for lines; they get left/right handles that make them longer without making them thicker.
  isLine?: boolean;
  // Set for the square and rectangle; they get left/right handles that make them wider.
  stretchX?: boolean;
  // Set for number lines; only they use `numberLine`. `centered` = 0 always sits in the middle.
  numberLine?: { ticks: number; centered: boolean };
  // Which math tool this is, for the ones with their own settings panel (each uses its matching
  // setting, e.g. "fraction" uses `fraction`). Fraction bars and circles share "fraction".
  // The written fraction ("fractionNumber") also uses `fraction`: shaded = numerator, parts = denominator.
  mathTool?: "fraction" | "fractionNumber" | "tenFrame" | "baseTen" | "thermometer" | "barGraph" | "protractor";
  // Drawing area; missing = the shared square "0 0 100 100". Wide assets use a wide one so they
  // aren't squeezed into a square, and start at `defaultSize` (px) instead of a square box.
  // A function when the area depends on the element's settings (e.g. the counting frame's grid).
  viewBox?: string | ((settings: RenderSettings) => string);
  defaultSize?: { width: number; height: number };
  render: (color: string, settings: RenderSettings) => ReactNode;
}

export type ClockTime = NonNullable<SvgElement["clockTime"]>;
export const DEFAULT_CLOCK_TIME: ClockTime = { hours: 10, minutes: 10, pm: false };

export type NumberLineSettings = NonNullable<SvgElement["numberLine"]>;
export const DEFAULT_NUMBER_LINE: NumberLineSettings = { start: 0, step: 1, hidden: [] };
// The steps the Edit numbers panel offers.
export const NUMBER_LINE_STEPS = [1, 2, 5, 10];

// Label shown at tick `index` of a number line.
export function getNumberLineValue(index: number, ticks: number, centered: boolean, { start, step }: NumberLineSettings) {
  return centered ? (index - (ticks - 1) / 2) * step : start + index * step;
}

const NUMBER_LINE_NEGATIVE = "#E0961F";
const NUMBER_LINE_POSITIVE = "#1E86D8";

// Draws a number line in a 200×40 area. Integer (centered) lines color negatives orange and
// positives blue, with 0 in black — the colors carry meaning, so they don't follow the element color.
function renderNumberLine(
  color: string,
  ticks: number,
  centered: boolean,
  settings: NumberLineSettings = DEFAULT_NUMBER_LINE,
) {
  const LEFT = 16;
  const RIGHT = 184;
  const spacing = (RIGHT - LEFT) / (ticks - 1);
  const values = Array.from({ length: ticks }, (_, i) => getNumberLineValue(i, ticks, centered, settings));
  // Shrink labels so the longest one (e.g. "-16") still fits between two ticks with a clear gap.
  // A bold digit is about 0.7× the font size wide, so this keeps each label to ~70% of the tick spacing.
  const longest = Math.max(...values.map((v) => String(v).length));
  const fontSize = Math.min(10, spacing / longest);
  const signColor = (value: number) =>
    !centered ? color : value < 0 ? NUMBER_LINE_NEGATIVE : value > 0 ? NUMBER_LINE_POSITIVE : "#1F1F1F";
  const zeroX = LEFT + spacing * ((ticks - 1) / 2);

  return (
    <>
      {centered ? (
        <>
          <line x1="8" y1="16" x2={zeroX} y2="16" stroke={NUMBER_LINE_NEGATIVE} strokeWidth="2" />
          <line x1={zeroX} y1="16" x2="192" y2="16" stroke={NUMBER_LINE_POSITIVE} strokeWidth="2" />
        </>
      ) : (
        <line x1="8" y1="16" x2="192" y2="16" stroke={color} strokeWidth="2" />
      )}
      <path d="M2 16 13 10 10 16 13 22ZM198 16 187 10 190 16 187 22Z" fill={color} />
      {values.map((value, i) => {
        const x = LEFT + i * spacing;
        const tickColor = signColor(value);
        const isHidden = settings.hidden.includes(i);
        return (
          <g key={i}>
            <line x1={x} y1="11" x2={x} y2="21" stroke={tickColor} strokeWidth="1.5" />
            {isHidden ? (
              // A hidden number becomes an empty box, for "fill in the missing number" questions.
              <rect
                x={x - fontSize * 0.6}
                y={31 - fontSize * 0.6}
                width={fontSize * 1.2}
                height={fontSize * 1.2}
                rx="2"
                fill="none"
                stroke={centered ? tickColor : "#1F1F1F"}
                strokeWidth="1"
              />
            ) : (
              <text
                x={x}
                y="31"
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={fontSize}
                fontWeight="600"
                fill={centered ? tickColor : "#1F1F1F"}
              >
                {value}
              </text>
            )}
          </g>
        );
      })}
    </>
  );
}

// Draws a clock face whose hands point at the given time.
function renderClock(color: string, { hours, minutes }: ClockTime = DEFAULT_CLOCK_TIME) {
  // A full turn is 360°: the minute hand moves 6° per minute, the hour hand 30° per hour plus
  // 0.5° per minute (so at 3:30 it sits halfway between the 3 and the 4, like a real clock).
  const minuteAngle = minutes * 6;
  const hourAngle = (hours % 12) * 30 + minutes * 0.5;
  // Point on the face at a given angle (0° = 12 o'clock) and distance from the center.
  const at = (angle: number, radius: number) => {
    const rad = (angle * Math.PI) / 180;
    return { x: 50 + radius * Math.sin(rad), y: 50 - radius * Math.cos(rad) };
  };

  return (
    <>
      <circle cx="50" cy="50" r="44" fill="#FFFFFF" stroke={color} strokeWidth="6" />
      {Array.from({ length: 60 }, (_, i) => {
        const isHour = i % 5 === 0;
        const outer = at(i * 6, 38);
        const inner = at(i * 6, isHour ? 34 : 36.5);
        return (
          <line key={i} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="#1F1F1F" strokeWidth={isHour ? 1.4 : 0.6} />
        );
      })}
      {Array.from({ length: 12 }, (_, i) => {
        const { x, y } = at((i + 1) * 30, 27);
        return (
          <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize="8" fontWeight="600" fill="#1F1F1F">
            {i + 1}
          </text>
        );
      })}
      <line x1="50" y1="50" x2={at(hourAngle, 18).x} y2={at(hourAngle, 18).y} stroke={color} strokeWidth="4" strokeLinecap="round" />
      <line x1="50" y1="50" x2={at(minuteAngle, 29).x} y2={at(minuteAngle, 29).y} stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="50" cy="50" r="3" fill={color} />
    </>
  );
}

// Draws a digital clock showing the given time, e.g. "3:45 PM".
function renderDigitalClock(color: string, { hours, minutes, pm }: ClockTime = DEFAULT_CLOCK_TIME) {
  return (
    <>
      <rect x="5" y="27" width="90" height="46" rx="10" fill="#FFFFFF" stroke={color} strokeWidth="5" />
      <text
        x="50"
        y="51"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="21"
        fontWeight="700"
        fill={color}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {hours}:{String(minutes).padStart(2, "0")}
        <tspan dx="2" fontSize="10">
          {pm ? "PM" : "AM"}
        </tspan>
      </text>
    </>
  );
}

export type FractionSettings = NonNullable<SvgElement["fraction"]>;
export const DEFAULT_FRACTION: FractionSettings = { parts: 4, shaded: 1 };
// Fraction bars and circles: how many parts they can be cut into.
export const FRACTION_PARTS = { min: 2, max: 12 };

// Written fraction: `shaded` is the numerator (top), `parts` the denominator (bottom).
export const DEFAULT_FRACTION_NUMBER: FractionSettings = { parts: 2, shaded: 1 };
// Up to 3 digits, so the numbers still fit inside the element's square.
export const FRACTION_NUMBER_MAX = 999;

// Draws a written fraction — numerator, a bar, denominator — all in the element color.
function renderFractionNumber(color: string, { parts, shaded }: FractionSettings = DEFAULT_FRACTION_NUMBER) {
  // Widen the bar to cover the longer number (a digit is about 0.7× the 34 font size wide).
  const digits = Math.max(String(shaded).length, String(parts).length);
  const halfBar = Math.min(46, digits * 12 + 8);
  return (
    <>
      <text x="50" y="27" textAnchor="middle" dominantBaseline="central" fontSize="34" fontWeight="700" fill={color}>
        {shaded}
      </text>
      <line x1={50 - halfBar} y1="50" x2={50 + halfBar} y2="50" stroke={color} strokeWidth="5" strokeLinecap="round" />
      <text x="50" y="74" textAnchor="middle" dominantBaseline="central" fontSize="34" fontWeight="700" fill={color}>
        {parts}
      </text>
    </>
  );
}

export type TenFrameSettings =NonNullable<SvgElement["tenFrame"]>;
export const DEFAULT_TEN_FRAME: TenFrameSettings = { count: 5, rows: 2, columns: 5 };
// Most rows (and most columns) a counting frame can have.
export const TEN_FRAME_SIDE_MAX = 10;

const OUTLINE = "#1F1F1F";

// Draws a 200×40 bar cut into equal parts; the first `shaded` parts are filled with the color.
function renderFractionBar(color: string, { parts, shaded }: FractionSettings = DEFAULT_FRACTION) {
  const width = 192 / parts;
  return (
    <>
      {Array.from({ length: parts }, (_, i) => (
        <rect
          key={i}
          x={4 + i * width}
          y="4"
          width={width}
          height="32"
          fill={i < shaded ? color : "#FFFFFF"}
          stroke={OUTLINE}
          strokeWidth="1.5"
        />
      ))}
    </>
  );
}

// Draws a pie cut into equal slices, starting at the top and going clockwise; the first
// `shaded` slices are filled with the color.
function renderFractionCircle(color: string, { parts, shaded }: FractionSettings = DEFAULT_FRACTION) {
  const R = 44;
  // Point on the edge at a given slice boundary (0 = top).
  const edge = (i: number) => {
    const rad = (i / parts) * 2 * Math.PI;
    return `${50 + R * Math.sin(rad)} ${50 - R * Math.cos(rad)}`;
  };
  return (
    <>
      <circle cx="50" cy="50" r={R} fill="#FFFFFF" stroke={OUTLINE} strokeWidth="1.5" />
      {Array.from({ length: parts }, (_, i) => (
        // Wedge: center → edge point i → arc to edge point i+1 → back to center.
        <path
          key={i}
          d={`M50 50 L${edge(i)} A${R} ${R} 0 0 1 ${edge(i + 1)} Z`}
          fill={i < shaded ? color : "#FFFFFF"}
          stroke={OUTLINE}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      ))}
    </>
  );
}

const FRAME_CELL = 38;

// Drawing area for a counting frame: one square cell per box plus a small margin, so the
// boxes stay square whatever the grid (2×5 = "0 0 200 84").
export function getTenFrameViewBox({ rows = 2, columns = 5 }: TenFrameSettings = DEFAULT_TEN_FRAME) {
  return `0 0 ${columns * FRAME_CELL + 10} ${rows * FRAME_CELL + 8}`;
}

// Draws a grid of rows × columns boxes; dots fill in reading order (top row first).
function renderTenFrame(color: string, { count, rows = 2, columns = 5 }: TenFrameSettings = DEFAULT_TEN_FRAME) {
  const SIZE = FRAME_CELL;
  return (
    <>
      {Array.from({ length: rows * columns }, (_, i) => {
        const x = 5 + (i % columns) * SIZE;
        const y = 4 + Math.floor(i / columns) * SIZE;
        return (
          <g key={i}>
            <rect x={x} y={y} width={SIZE} height={SIZE} fill="#FFFFFF" stroke={OUTLINE} strokeWidth="1.5" />
            {i < count && <circle cx={x + SIZE / 2} cy={y + SIZE / 2} r="13" fill={color} />}
          </g>
        );
      })}
    </>
  );
}

export type BaseTenSettings = NonNullable<SvgElement["baseTen"]>;
export const DEFAULT_BASE_TEN: BaseTenSettings = { hundreds: 1, tens: 2, ones: 3 };
// Most flats, rods or cubes of one kind.
export const BASE_TEN_MAX = 9;

// Base-ten block sizes, in drawing units: a cube is 4×4, a rod 1×10 cubes, a flat 10×10 cubes.
const CUBE = 4;
const BLOCK_HEIGHT = CUBE * 10;

// Where each block goes, left to right: flats, then rods, then cubes in stacks of 5 (bottom up).
function layoutBaseTen({ hundreds, tens, ones }: BaseTenSettings) {
  const flats: number[] = [];
  const rods: number[] = [];
  const cubes: { x: number; y: number }[] = [];
  let x = 4;
  for (let i = 0; i < hundreds; i++, x += BLOCK_HEIGHT + 4) flats.push(x);
  for (let i = 0; i < tens; i++, x += CUBE + 2) rods.push(x);
  for (let i = 0; i < ones; i++) {
    const stack = Math.floor(i / 5);
    cubes.push({ x: x + stack * (CUBE + 2), y: 4 + BLOCK_HEIGHT - ((i % 5) + 1) * (CUBE + 1) + 1 });
  }
  const width = Math.max(20, x + Math.ceil(ones / 5) * (CUBE + 2) + 2);
  return { flats, rods, cubes, width };
}

// Drawing area for base-ten blocks: grows wider as blocks are added, so they keep their size.
export function getBaseTenViewBox(settings: BaseTenSettings = DEFAULT_BASE_TEN) {
  return `0 0 ${layoutBaseTen(settings).width} ${BLOCK_HEIGHT + 8}`;
}

// Draws the blocks in the element color, with thin lines marking each cube inside flats and rods.
function renderBaseTen(color: string, settings: BaseTenSettings = DEFAULT_BASE_TEN) {
  const { flats, rods, cubes } = layoutBaseTen(settings);
  const LINE = "rgba(0,0,0,0.35)";
  const inner = Array.from({ length: 9 }, (_, i) => (i + 1) * CUBE);
  return (
    <>
      {flats.map((x) => (
        <g key={`flat-${x}`}>
          <rect x={x} y="4" width={BLOCK_HEIGHT} height={BLOCK_HEIGHT} fill={color} stroke={OUTLINE} strokeWidth="0.8" />
          <path d={inner.map((d) => `M${x + d} 4v${BLOCK_HEIGHT}M${x} ${4 + d}h${BLOCK_HEIGHT}`).join("")} stroke={LINE} strokeWidth="0.3" />
        </g>
      ))}
      {rods.map((x) => (
        <g key={`rod-${x}`}>
          <rect x={x} y="4" width={CUBE} height={BLOCK_HEIGHT} fill={color} stroke={OUTLINE} strokeWidth="0.8" />
          <path d={inner.map((d) => `M${x} ${4 + d}h${CUBE}`).join("")} stroke={LINE} strokeWidth="0.3" />
        </g>
      ))}
      {cubes.map(({ x, y }) => (
        <rect key={`cube-${x}-${y}`} x={x} y={y} width={CUBE} height={CUBE} fill={color} stroke={OUTLINE} strokeWidth="0.8" />
      ))}
    </>
  );
}

export type ThermometerSettings = NonNullable<SvgElement["thermometer"]>;
export const DEFAULT_THERMOMETER: ThermometerSettings = { value: 25 };
export const THERMOMETER_MIN = -20;
export const THERMOMETER_MAX = 50;

// Draws a tall thermometer in a 60×200 area; the liquid (element color) rises to the temperature.
function renderThermometer(color: string, { value }: ThermometerSettings = DEFAULT_THERMOMETER) {
  // Scale runs from y=150 (-20 °C) up to y=20 (50 °C).
  const toY = (temp: number) => 150 - ((temp - THERMOMETER_MIN) / (THERMOMETER_MAX - THERMOMETER_MIN)) * 130;
  return (
    <>
      <rect x="22" y="8" width="16" height="160" rx="8" fill="#FFFFFF" stroke={OUTLINE} strokeWidth="1.5" />
      <rect x="26" y={toY(value)} width="8" height={172 - toY(value)} fill={color} />
      <circle cx="30" cy="176" r="15" fill={color} stroke={OUTLINE} strokeWidth="1.5" />
      {Array.from({ length: 8 }, (_, i) => {
        const temp = THERMOMETER_MIN + i * 10;
        const y = toY(temp);
        return (
          <g key={temp}>
            <line x1="38" y1={y} x2="44" y2={y} stroke={OUTLINE} strokeWidth="1" />
            <text x="46" y={y} dominantBaseline="central" fontSize="7" fontWeight="600" fill="#1F1F1F">
              {temp}
            </text>
          </g>
        );
      })}
      <text x="4" y="12" dominantBaseline="central" fontSize="7" fontWeight="600" fill="#1F1F1F">
        °C
      </text>
    </>
  );
}

export type BarGraphSettings = NonNullable<SvgElement["barGraph"]>;
export const DEFAULT_BAR_GRAPH: BarGraphSettings = {
  bars: [
    { label: "A", value: 4 },
    { label: "B", value: 7 },
    { label: "C", value: 2 },
  ],
};
// The graph's scale runs 0 to BAR_GRAPH_MAX. It has 2–6 bars, each label up to 12 letters.
export const BAR_GRAPH_MAX = 10;
export const BAR_COUNTS = [2, 3, 4, 5, 6];
export const BAR_LABEL_MAX = 12;

// Draws a bar graph on a 0–10 scale in a 200×150 area, with light grid lines every 2.
function renderBarGraph(color: string, { bars }: BarGraphSettings = DEFAULT_BAR_GRAPH) {
  const LEFT = 22;
  const RIGHT = 194;
  const BOTTOM = 125;
  const UNIT = 11.5; // height of 1 on the scale, so 10 reaches y=10
  const slot = (RIGHT - LEFT) / bars.length;
  return (
    <>
      {[0, 2, 4, 6, 8, 10].map((v) => (
        <g key={v}>
          <line x1={LEFT} y1={BOTTOM - v * UNIT} x2={RIGHT} y2={BOTTOM - v * UNIT} stroke="#E8E6E1" strokeWidth="0.8" />
          <text x={LEFT - 4} y={BOTTOM - v * UNIT} textAnchor="end" dominantBaseline="central" fontSize="7" fill="#1F1F1F">
            {v}
          </text>
        </g>
      ))}
      {bars.map((bar, i) => {
        const x = LEFT + i * slot + slot * 0.2;
        // Shrink long labels so they fit under their own bar.
        const fontSize = Math.min(8, (slot * 0.95) / (Math.max(1, bar.label.length) * 0.6));
        return (
          <g key={i}>
            <rect x={x} y={BOTTOM - bar.value * UNIT} width={slot * 0.6} height={bar.value * UNIT} fill={color} />
            <text x={x + slot * 0.3} y={BOTTOM + 11} textAnchor="middle" dominantBaseline="central" fontSize={fontSize} fontWeight="600" fill="#1F1F1F">
              {bar.label}
            </text>
          </g>
        );
      })}
      <path d={`M${LEFT} 6V${BOTTOM}H${RIGHT}`} fill="none" stroke={OUTLINE} strokeWidth="1.2" />
    </>
  );
}

export type ProtractorSettings = NonNullable<SvgElement["protractor"]>;
export const DEFAULT_PROTRACTOR: ProtractorSettings = { angle: 45 };

// Draws a protractor (0° on the right, 180° on the left) in a 200×110 area. One line lies on 0°,
// the other turns to the angle; both lines and the small angle arc use the element color.
function renderProtractor(color: string, { angle }: ProtractorSettings = DEFAULT_PROTRACTOR) {
  const CX = 100;
  const CY = 100;
  // Point at a given angle (0° = right, counterclockwise) and distance from the center.
  const at = (deg: number, r: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: CX + r * Math.cos(rad), y: CY - r * Math.sin(rad) };
  };
  const tip = at(angle, 92);
  const arcEnd = at(angle, 20);
  return (
    <>
      <path d="M8 100A92 92 0 0 1 192 100Z" fill="#F4F3EF" stroke={OUTLINE} strokeWidth="1.2" />
      {Array.from({ length: 37 }, (_, i) => {
        const deg = i * 5;
        const isTen = deg % 10 === 0;
        const outer = at(deg, 92);
        const inner = at(deg, isTen ? 83 : 87);
        return <line key={deg} x1={outer.x} y1={outer.y} x2={inner.x} y2={inner.y} stroke={OUTLINE} strokeWidth={isTen ? 0.9 : 0.5} />;
      })}
      {Array.from({ length: 19 }, (_, i) => {
        const deg = i * 10;
        const { x, y } = at(deg, 75);
        return (
          <text key={deg} x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize="6" fill="#1F1F1F">
            {deg}
          </text>
        );
      })}
      <line x1={CX} y1={CY} x2="192" y2={CY} stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1={CX} y1={CY} x2={tip.x} y2={tip.y} stroke={color} strokeWidth="2" strokeLinecap="round" />
      {angle > 0 && <path d={`M${CX + 20} ${CY}A20 20 0 0 0 ${arcEnd.x} ${arcEnd.y}`} fill="none" stroke={color} strokeWidth="1.5" />}
      <circle cx={CX} cy={CY} r="2.5" fill={color} />
    </>
  );
}

// Draws ruler ticks and numbers along a flat edge, starting at (x, y) and going right.
// `unit` = drawing units per cm/inch, `count` = how many cm/inches, `parts` = ticks per cm/inch,
// `tickLength(i)` = how long tick i is. `dir` 1 = ticks hang down from the edge, -1 = stand up from it.
function renderRulerScale(
  x: number,
  y: number,
  unit: number,
  count: number,
  parts: number,
  tickLength: (i: number) => number,
  dir: 1 | -1,
) {
  const longest = tickLength(0);
  return (
    <>
      {Array.from({ length: count * parts + 1 }, (_, i) => {
        const tx = x + (i * unit) / parts;
        const isWhole = i % parts === 0;
        return <line key={i} x1={tx} y1={y} x2={tx} y2={y + dir * tickLength(i)} stroke={OUTLINE} strokeWidth={isWhole ? 0.9 : 0.5} />;
      })}
      {Array.from({ length: count + 1 }, (_, n) => (
        <text key={n} x={x + n * unit} y={y + dir * (longest + 6)} textAnchor="middle" dominantBaseline="central" fontSize="7" fill={OUTLINE}>
          {n}
        </text>
      ))}
    </>
  );
}

// Tick lengths: cm rulers have mm ticks, a longer half-cm tick and a long cm tick.
const cmTick = (i: number) => (i % 10 === 0 ? 12 : i % 5 === 0 ? 8 : 5);
// Inch rulers have 1/8 ticks, each halving step a bit longer: 1/8 < 1/4 < 1/2 < 1 inch.
const inchTick = (i: number) => (i % 8 === 0 ? 12 : i % 4 === 0 ? 9 : i % 2 === 0 ? 6.5 : 4);

// Drawing units per cm on every ruler, so a cm is the same size on all of them.
const RULER_CM = 20;

// A 15 cm ruler in a 320×44 area, ticks along the top edge.
function renderCmRuler(color: string) {
  return (
    <>
      <rect x="1" y="1" width="318" height="42" rx="3" fill={color} stroke={OUTLINE} strokeWidth="1" />
      {renderRulerScale(10, 1, RULER_CM, 15, 10, cmTick, 1)}
      <text x="310" y="36" textAnchor="end" fontSize="6" fill={OUTLINE}>cm</text>
    </>
  );
}

// A 6 inch ruler in a 308×44 area, ticks along the top edge.
function renderInchRuler(color: string) {
  return (
    <>
      <rect x="1" y="1" width="306" height="42" rx="3" fill={color} stroke={OUTLINE} strokeWidth="1" />
      {renderRulerScale(10, 1, 48, 6, 8, inchTick, 1)}
      <text x="298" y="36" textAnchor="end" fontSize="6" fill={OUTLINE}>in</text>
    </>
  );
}

// A ruler with 15 cm along the top edge and 5 inches along the bottom, in a 320×64 area.
// Both scales use real proportions (1 inch = 2.54 cm).
function renderDualRuler(color: string) {
  return (
    <>
      <rect x="1" y="1" width="318" height="62" rx="3" fill={color} stroke={OUTLINE} strokeWidth="1" />
      {renderRulerScale(10, 1, RULER_CM, 15, 10, cmTick, 1)}
      {renderRulerScale(10, 63, RULER_CM * 2.54, 5, 8, inchTick, -1)}
      <text x="310" y="32" textAnchor="end" dominantBaseline="central" fontSize="6" fill={OUTLINE}>cm / in</text>
    </>
  );
}

// A 45°-45°-90° set square in a 220×220 area: right angle at the bottom left, cm scale along the
// bottom edge, and a triangle hole in the middle (evenodd cuts it out). See-through like plastic.
function renderSetSquare45(color: string) {
  return (
    <>
      <path d="M8 212H212L8 8Z M40 176H130L40 86Z" fillRule="evenodd" fill={color} fillOpacity="0.45" stroke={OUTLINE} strokeWidth="1" strokeLinejoin="round" />
      {renderRulerScale(18, 212, RULER_CM, 8, 10, cmTick, -1)}
    </>
  );
}

// A 30°-60°-90° set square in a 216×130 area: right angle at the bottom left, the long side along
// the bottom with a cm scale, and a matching triangle hole.
function renderSetSquare3060(color: string) {
  return (
    <>
      <path d="M8 122H208L8 6.5Z M36 92H122L36 42.3Z" fillRule="evenodd" fill={color} fillOpacity="0.45" stroke={OUTLINE} strokeWidth="1" strokeLinejoin="round" />
      {renderRulerScale(18, 122, RULER_CM, 7, 10, cmTick, -1)}
    </>
  );
}

// Draws a simple coin: a metal disc with an inner ring, the value, and the unit below it.
// Not a replica of the real coin design — just clear enough to count money with.
function renderCoin(color: string, value: string, unit: string) {
  return (
    <>
      <circle cx="50" cy="50" r="44" fill={color} stroke="rgba(0,0,0,0.25)" strokeWidth="2" />
      <circle cx="50" cy="50" r="36" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="1.5" />
      <text x="50" y="46" textAnchor="middle" dominantBaseline="central" fontSize="26" fontWeight="700" fill="#1F1F1F">
        {value}
      </text>
      <text x="50" y="68" textAnchor="middle" dominantBaseline="central" fontSize="9" fontWeight="600" letterSpacing="1" fill="#1F1F1F">
        {unit}
      </text>
    </>
  );
}

const COIN_SILVER = "#C5C9CE";
const COIN_GOLD = "#D9B44A";

// Dot positions on a dice face, as [x, y] on a 3×3 grid (28 / 50 / 72) — the standard layouts.
const DICE_DOTS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 28], [72, 28], [28, 50], [72, 50], [28, 72], [72, 72]],
};

// Draws a white dice face with a colored outline and dots.
function renderDice(value: number, color: string) {
  return (
    <>
      <rect x="8" y="8" width="84" height="84" rx="16" fill="#FFFFFF" stroke={color} strokeWidth="5" />
      {DICE_DOTS[value].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="8" fill={color} />
      ))}
    </>
  );
}

// Renders a single character centered in the shared 0–100 viewBox — used for numbers, letters, and
// symbols, since hand-drawing 40+ individual vector glyphs wouldn't be practical or consistent.
function renderGlyph(char: string, color: string) {
  return (
    <text x="50" y="54" textAnchor="middle" dominantBaseline="central" fontSize="80" fontWeight="700" fill={color}>
      {char}
    </text>
  );
}

// A cloud silhouette (adapted from the common "cloud" icon shape, redrawn at 0–24 scale so it can be
// reused at different sizes/positions via a wrapping transform for each cloud variant below).
const CLOUD_PATH =
  "M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z";

// Lines are always LINE_HEIGHT tall in drawing units; their length follows the box's shape, so a
// wider box gives a longer line with the same thickness and same-size arrowheads.
const LINE_HEIGHT = 20;

// Drawing length for this box; the Elements panel tile (no box yet) uses a 5:1 line.
function lineLength({ width, height }: RenderSettings) {
  return width && height ? Math.max(LINE_HEIGHT, (LINE_HEIGHT * width) / height) : 100;
}

function renderLine(
  color: string,
  style: "plain" | "arrow" | "double-arrow" | "dashed" | "dotted" | "dashed-arrow" | "thick" | "wavy",
  length: number,
) {
  const y = LINE_HEIGHT / 2;
  const end = length - 4;
  const arrowAtEnd = style === "arrow" || style === "double-arrow" || style === "dashed-arrow";
  const arrowAtStart = style === "double-arrow";

  if (style === "wavy") {
    // Whole waves only (13 units each), centered, so the line never ends halfway up a wave.
    const waves = Math.max(1, Math.floor((length - 8) / 13));
    const startX = (length - waves * 13) / 2;
    const d = `M${startX} ${y}Q${startX + 6.5} 2 ${startX + 13} ${y}` + `t13 0`.repeat(waves - 1);
    return <path d={d} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />;
  }

  return (
    <>
      <line
        x1={arrowAtStart ? 14 : 4}
        y1={y}
        x2={arrowAtEnd ? end - 10 : end}
        y2={y}
        stroke={color}
        strokeWidth={style === "thick" ? 7 : 3}
        strokeLinecap={arrowAtStart ? "butt" : "round"}
        strokeDasharray={style === "dashed" || style === "dashed-arrow" ? "6 6" : style === "dotted" ? "0 6" : undefined}
      />
      {arrowAtStart && <polygon points={`4,${y} 16,${y - 7} 16,${y + 7}`} fill={color} />}
      {arrowAtEnd && <polygon points={`${end},${y} ${end - 12},${y - 7} ${end - 12},${y + 7}`} fill={color} />}
    </>
  );
}

// Square and rectangle draw in px at their box's own size, so making the box wider makes the
// shape wider (instead of leaving empty space). The Elements panel tile (no box yet) uses the fallback size.
const BOX_GAP = 2; // Same 2px gap as trimmed drawings (TRIM_PADDING).

function boxViewBox({ width, height }: RenderSettings, fallbackWidth: number, fallbackHeight: number) {
  return width && height ? `0 0 ${width} ${height}` : `0 0 ${fallbackWidth} ${fallbackHeight}`;
}

function renderBoxRect(color: string, { width, height }: RenderSettings, fallbackWidth: number, fallbackHeight: number) {
  const w = width && height ? width : fallbackWidth;
  const h = width && height ? height : fallbackHeight;
  return <rect x={BOX_GAP} y={BOX_GAP} width={Math.max(0, w - BOX_GAP * 2)} height={Math.max(0, h - BOX_GAP * 2)} fill={color} />;
}

// Block arrow pointing right; the other directions are this one turned around the center.
const BLOCK_ARROW_POINTS = "6,36 58,36 58,14 94,50 58,86 58,64 6,64";

function renderBlockArrow(color: string, turn: number) {
  return <polygon points={BLOCK_ARROW_POINTS} fill={color} transform={`rotate(${turn} 50 50)`} />;
}

// Thin line arrow pointing right, turned the same way as the block arrows.
function renderThinArrow(color: string, turn: number) {
  return (
    <g transform={`rotate(${turn} 50 50)`}>
      <line x1="10" y1="50" x2="76" y2="50" stroke={color} strokeWidth="8" strokeLinecap="round" />
      <polygon points="94,50 72,34 72,66" fill={color} />
    </g>
  );
}

// Fixed colors for vehicle parts that don't change with the element color.
const TIRE_DARK = "#1F1F1F";
const HUB_GRAY = "#D1D5DB";
const WINDOW_BLUE = "#DBEAFE";
const SAIL_WHITE = "#F8FAFC";
const SAIL_EDGE = "#CBD5E1";

function renderWheel(cx: number, cy: number, r: number) {
  return (
    <>
      <circle cx={cx} cy={cy} r={r} fill={TIRE_DARK} />
      <circle cx={cx} cy={cy} r={r * 0.4} fill={HUB_GRAY} />
    </>
  );
}

// Side view of a car; the taxi and police car are the same car with something on the roof.
function renderCar(color: string, roof?: ReactNode) {
  return (
    <>
      {roof}
      <polygon points="24,50 34,29 66,29 80,50" fill={color} />
      <rect x="6" y="48" width="88" height="26" rx="8" fill={color} />
      <polygon points="30,48 38,34 48,34 48,48" fill={WINDOW_BLUE} />
      <polygon points="53,34 63,34 72,48 53,48" fill={WINDOW_BLUE} />
      {renderWheel(28, 74, 10)}
      {renderWheel(72, 74, 10)}
    </>
  );
}

// Fixed colors for animal faces: eyes/noses, pink noses and inner ears, beaks and feet.
const ANIMAL_INK = "#1F1F1F";
const ANIMAL_PINK = "#F9A8D4";
const BEAK_ORANGE = "#F59E0B";

// Two dark eyes with a small shine, `dx` to each side of the middle.
function renderEyes(y: number, dx: number) {
  return (
    <>
      {[50 - dx, 50 + dx].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy={y} r="4" fill={ANIMAL_INK} />
          <circle cx={cx + 1.3} cy={y - 1.3} r="1.3" fill="#FFFFFF" />
        </g>
      ))}
    </>
  );
}

// A see-through white patch (muzzle, belly) that reads as a lighter shade of any body color.
function lightPatch(shape: ReactNode) {
  return <g fill="#FFFFFF" fillOpacity="0.55">{shape}</g>;
}

// A see-through dark patch (craters, planet bands) that reads as a darker shade of any color.
function darkPatch(shape: ReactNode) {
  return <g fill="#000000" fillOpacity="0.15">{shape}</g>;
}

// Horizontal cloud bands on a round planet (center 50,50, radius r), each cut short so it
// stays inside the circle.
function renderBands(r: number, bands: number[], height: number) {
  return bands.map((y) => {
    const far = Math.abs(y - 50) + height / 2;
    const half = Math.sqrt(Math.max(0, r * r - far * far));
    return <rect key={y} x={50 - half} y={y - height / 2} width={half * 2} height={height} rx={height / 2} />;
  });
}

// Corner points of a regular polygon around (cx, cy); `turn` = direction of the first corner in degrees.
function polygonPoints(cx: number, cy: number, r: number, sides: number, turn = -90) {
  return Array.from({ length: sides }, (_, i) => {
    const angle = ((turn + (i * 360) / sides) * Math.PI) / 180;
    return `${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`;
  }).join(" ");
}

// Five-pointed star around (cx, cy), point up.
function starPoints(cx: number, cy: number, outer: number, inner: number) {
  return Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? inner : outer;
    const angle = ((-90 + i * 36) * Math.PI) / 180;
    return `${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`;
  }).join(" ");
}

// A trunk with a round, leafy crown; the apple, autumn, and cherry blossom trees add their
// own extras (fruit, falling leaves, flowers) on top.
function renderRoundTree(color: string, extras?: ReactNode) {
  return (
    <>
      <path d="M44 94V60L34 48M56 94V62L66 50" fill="none" stroke={STEM_BROWN} strokeWidth="6" strokeLinejoin="round" />
      <rect x="44" y="60" width="12" height="34" fill={STEM_BROWN} />
      <g fill={color}>
        <circle cx="50" cy="32" r="24" />
        <circle cx="28" cy="46" r="18" />
        <circle cx="72" cy="46" r="18" />
        <circle cx="50" cy="52" r="20" />
      </g>
      {lightPatch(<circle cx="40" cy="26" r="8" />)}
      {extras}
    </>
  );
}

// Leaf veins: thin see-through dark lines, so they show on any leaf color.
function renderVeins(d: string) {
  return <path d={d} fill="none" stroke="#000" strokeOpacity="0.2" strokeWidth="2" strokeLinecap="round" />;
}

// Small leaflets in pairs along a curved stem (a quadratic curve from p0 to p2, bent toward p1),
// angled forward toward the tip, plus one leaflet at the tip. `size(t)` = leaflet size at each spot.
const LEAFLET_PATH = "M0 0Q8 -5 16 0Q8 5 0 0Z";
type Point = [number, number];

function renderLeafletsAlong(color: string, [p0, p1, p2]: [Point, Point, Point], spots: number[], size: (t: number) => number) {
  const leaflet = (t: number, spread: number) => {
    const u = 1 - t;
    const x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0];
    const y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1];
    const angle = (Math.atan2(2 * u * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]), 2 * u * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0])) * 180) / Math.PI;
    return <path key={`${t}-${spread}`} d={LEAFLET_PATH} transform={`translate(${x} ${y}) rotate(${angle + spread}) scale(${size(t)})`} />;
  };
  return (
    <>
      <path d={`M${p0}Q${p1} ${p2}`} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <g fill={color}>
        {spots.flatMap((t) => [leaflet(t, -60), leaflet(t, 60)])}
        {leaflet(1, 0)}
      </g>
    </>
  );
}

// One heart-shaped clover leaflet pointing up from (50, 44), turned around that point.
function renderCloverLeaflets(color: string, turns: number[]) {
  return (
    <>
      <path d="M50 44Q54 70 46 94" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" />
      {turns.map((turn) => (
        <g key={turn} transform={`rotate(${turn} 50 44)`}>
          <path d="M50 44Q28 36 32 20Q38 8 50 18Q62 8 68 20Q72 36 50 44Z" fill={color} />
          {renderVeins("M50 42V26")}
        </g>
      ))}
    </>
  );
}

// Natural colors for the parts of a fruit that don't change with the element color.
const LEAF_GREEN = "#22C55E";
const STEM_BROWN = "#6D4C41";
// Water in the kitchen glass and pitcher; stays blue after a recolor.
const WATER_BLUE = "#38BDF8";

// Bright colors handed out to assets that don't set their own defaultColor.
const FUN_COLORS = ["#EF4444", "#F97316", "#F59E0B", "#22C55E", "#14B8A6", "#3B82F6", "#6366F1", "#A855F7", "#EC4899"];

// Picks a color from FUN_COLORS based on the asset id — looks random, but stays the same on every
// load (a true Math.random() would differ between server and browser render and cause a mismatch).
function pickFunColor(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  // Scramble the bits so ids that differ by one letter (letter-A, letter-B...) don't get colors in order.
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return FUN_COLORS[hash % FUN_COLORS.length];
}

// Decorative helpers.
// Spiral: a line that circles out from the middle, 3 turns wide.
const SPIRAL_PATH = Array.from({ length: 121 }, (_, i) => {
  const angle = (i / 120) * Math.PI * 6;
  const radius = 3 + angle * 2.2;
  const x = (50 + radius * Math.cos(angle)).toFixed(1);
  const y = (50 + radius * Math.sin(angle)).toFixed(1);
  return `${i === 0 ? "M" : "L"}${x} ${y}`;
}).join(" ");

// Starburst: a 16-point star, like a "sale" badge.
const STARBURST_POINTS = Array.from({ length: 32 }, (_, i) => {
  const angle = (i / 32) * Math.PI * 2 - Math.PI / 2;
  const radius = i % 2 === 0 ? 46 : 34;
  return `${(50 + radius * Math.cos(angle)).toFixed(1)},${(50 + radius * Math.sin(angle)).toFixed(1)}`;
}).join(" ");

// Small heart drawn in a 20×20 box, placed and scaled by the "Hearts" asset.
const SMALL_HEART_PATH = "M10 18C2 12 0 7 3 4C6 1 9 2 10 5C11 2 14 1 17 4C20 7 18 12 10 18Z";

// Four-point twinkle star centered on (cx, cy) with arm length `size`.
function renderTwinkle(cx: number, cy: number, size: number, color: string) {
  return (
    <path
      key={`${cx}-${cy}`}
      d={`M${cx} ${cy - size}Q${cx} ${cy} ${cx + size} ${cy}Q${cx} ${cy} ${cx} ${cy + size}Q${cx} ${cy} ${cx - size} ${cy}Q${cx} ${cy} ${cx} ${cy - size}Z`}
      fill={color}
    />
  );
}

// Patterned backgrounds: a wide rounded card filled with `color`, with a fixed rainbow pattern on top.
// The pattern stays inside the card's rounded corners, so no clipping is needed.
const PATTERN_COLORS = ["#EF4444", "#F97316", "#FACC15", "#22C55E", "#06B6D4", "#3B82F6", "#8B5CF6", "#EC4899"];
const patternColor = (index: number) => PATTERN_COLORS[index % PATTERN_COLORS.length];

// Rows of shapes 20 apart, every other row shifted half a step (like polka dots). `draw` gets each
// shape's center and a running number for picking its color.
function staggeredGrid(draw: (x: number, y: number, index: number) => ReactNode) {
  return Array.from({ length: 5 }, (_, row) =>
    Array.from({ length: row % 2 ? 7 : 8 }, (_, col) => (
      <g key={`${row}-${col}`}>{draw(10 + col * 20 + (row % 2) * 10, 10 + row * 20, col + row * 2)}</g>
    )),
  );
}

// A small + − × ÷ = sign centered on (x, y), for the Math Symbols background.
function renderMathSign(kind: number, x: number, y: number, color: string) {
  const stroke = { stroke: color, strokeWidth: 2.2, strokeLinecap: "round" as const, fill: "none" };
  if (kind === 0) return <path d={`M${x - 4.5} ${y}H${x + 4.5}M${x} ${y - 4.5}V${y + 4.5}`} {...stroke} />;
  if (kind === 1) return <path d={`M${x - 4.5} ${y}H${x + 4.5}`} {...stroke} />;
  if (kind === 2) return <path d={`M${x - 3.2} ${y - 3.2}L${x + 3.2} ${y + 3.2}M${x + 3.2} ${y - 3.2}L${x - 3.2} ${y + 3.2}`} {...stroke} />;
  if (kind === 3) {
    return (
      <>
        <path d={`M${x - 4.5} ${y}H${x + 4.5}`} {...stroke} />
        <circle cx={x} cy={y - 3.4} r="1.3" fill={color} />
        <circle cx={x} cy={y + 3.4} r="1.3" fill={color} />
      </>
    );
  }
  return <path d={`M${x - 4.5} ${y - 1.9}H${x + 4.5}M${x - 4.5} ${y + 1.9}H${x + 4.5}`} {...stroke} />;
}

function renderPatternCard(color: string, pattern: ReactNode) {
  return (
    <>
      <rect x="0" y="0" width="160" height="100" rx="10" fill={color} />
      {pattern}
    </>
  );
}

// Every asset shares a 0–100 viewBox so element width/height map to it uniformly.
const ASSETS: ElementAsset[] = [
  // Shapes
  {
    id: "square",
    category: "shape",
    label: "Square",
    defaultColor: "#F59E0B",
    stretchX: true,
    viewBox: (settings: RenderSettings) => boxViewBox(settings, 100, 100),
    defaultSize: { width: 120, height: 120 },
    render: (color: string, settings: RenderSettings) => renderBoxRect(color, settings, 100, 100),
  },
  {
    id: "rectangle",
    category: "shape",
    label: "Rectangle",
    defaultColor: "#3B82F6",
    stretchX: true,
    viewBox: (settings: RenderSettings) => boxViewBox(settings, 100, 76),
    defaultSize: { width: 160, height: 122 },
    render: (color: string, settings: RenderSettings) => renderBoxRect(color, settings, 100, 76),
  },
  {
    id: "circle",
    category: "shape",
    label: "Circle",
    defaultColor: "#EF4444",
    render: (color) => <circle cx="50" cy="50" r="42" fill={color} />,
  },
  {
    id: "triangle",
    category: "shape",
    label: "Triangle",
    defaultColor: "#22C55E",
    render: (color) => <polygon points="50,10 90,88 10,88" fill={color} />,
  },
  {
    id: "diamond",
    category: "shape",
    label: "Diamond",
    defaultColor: "#A855F7",
    render: (color) => <polygon points="50,4 96,50 50,96 4,50" fill={color} />,
  },
  {
    id: "star",
    category: "shape",
    label: "Star",
    defaultColor: "#FACC15",
    render: (color) => <path d="M50 5 61 37 96 37 67 57 78 90 50 70 22 90 33 57 4 37 39 37Z" fill={color} />,
  },
  {
    id: "oval",
    category: "shape",
    label: "Oval",
    defaultColor: "#EC4899",
    render: (color) => <ellipse cx="50" cy="50" rx="46" ry="32" fill={color} />,
  },
  {
    id: "pentagon",
    category: "shape",
    label: "Pentagon",
    defaultColor: "#F97316",
    render: (color) => <polygon points="50,4 94,36 77,87 23,87 6,36" fill={color} />,
  },
  {
    id: "hexagon",
    category: "shape",
    label: "Hexagon",
    defaultColor: "#14B8A6",
    render: (color) => <polygon points="50,4 90,27 90,73 50,96 10,73 10,27" fill={color} />,
  },
  {
    id: "heptagon",
    category: "shape",
    label: "Heptagon",
    defaultColor: "#8B5CF6",
    render: (color) => <polygon points="50,4 86,21.3 94.8,60.2 70,91.4 30,91.4 5.2,60.2 14,21.3" fill={color} />,
  },
  {
    id: "octagon",
    category: "shape",
    label: "Octagon",
    defaultColor: "#E11D48",
    render: (color) => <polygon points="18,4 82,4 96,18 96,82 82,96 18,96 4,82 4,18" fill={color} />,
  },
  {
    id: "nonagon",
    category: "shape",
    label: "Nonagon",
    defaultColor: "#D946EF",
    render: (color) => (
      <polygon points="50,4 79.6,14.8 95.3,42 89.8,73 65.7,93.2 34.3,93.2 10.2,73 4.7,42 20.4,14.8" fill={color} />
    ),
  },
  {
    id: "decagon",
    category: "shape",
    label: "Decagon",
    defaultColor: "#10B981",
    render: (color) => (
      <polygon
        points="50,4 77,12.8 93.7,35.8 93.7,64.2 77,87.2 50,96 23,87.2 6.3,64.2 6.3,35.8 23,12.8"
        fill={color}
      />
    ),
  },
  {
    id: "dodecagon",
    category: "shape",
    label: "Dodecagon",
    defaultColor: "#F43F5E",
    render: (color) => (
      <polygon
        points="50,4 73,10.2 89.8,27 96,50 89.8,73 73,89.8 50,96 27,89.8 10.2,73 4,50 10.2,27 27,10.2"
        fill={color}
      />
    ),
  },
  {
    id: "parallelogram",
    category: "shape",
    label: "Parallelogram",
    defaultColor: "#6366F1",
    render: (color) => <polygon points="20,18 96,18 80,82 4,82" fill={color} />,
  },
  {
    id: "trapezoid",
    category: "shape",
    label: "Trapezoid",
    defaultColor: "#0EA5E9",
    render: (color) => <polygon points="26,18 74,18 92,82 8,82" fill={color} />,
  },
  {
    id: "cross",
    category: "shape",
    label: "Cross",
    defaultColor: "#84CC16",
    render: (color) => (
      <polygon points="36,4 64,4 64,36 96,36 96,64 64,64 64,96 36,96 36,64 4,64 4,36 36,36" fill={color} />
    ),
  },

  // Lines — drawn to fit their box (see renderLine), so the side handles make them longer, not thicker.
  ...(
    [
      { id: "line", label: "Line", style: "plain" },
      { id: "line-arrow", label: "Arrow Line", style: "arrow" },
      { id: "line-double-arrow", label: "Double Arrow Line", style: "double-arrow" },
      { id: "line-dashed", label: "Dashed Line", style: "dashed" },
      { id: "line-dotted", label: "Dotted Line", style: "dotted" },
      { id: "line-dashed-arrow", label: "Dashed Arrow Line", style: "dashed-arrow" },
      { id: "line-thick", label: "Thick Line", style: "thick" },
      { id: "line-wavy", label: "Wavy Line", style: "wavy" },
    ] as const
  ).map(({ id, label, style }) => ({
    id,
    category: "line" as const,
    label,
    defaultColor: "#191A2C",
    isLine: true,
    viewBox: (settings: RenderSettings) => `0 0 ${lineLength(settings)} ${LINE_HEIGHT}`,
    defaultSize: { width: 220, height: 44 },
    render: (color: string, settings: RenderSettings) => renderLine(color, style, lineLength(settings)),
  })),

  // Arrows — fixed drawings (unlike lines, they grow evenly from the corners).
  ...[
    { id: "arrow-block-right", label: "Right Arrow", turn: 0 },
    { id: "arrow-block-down", label: "Down Arrow", turn: 90 },
    { id: "arrow-block-left", label: "Left Arrow", turn: 180 },
    { id: "arrow-block-up", label: "Up Arrow", turn: -90 },
    { id: "arrow-block-up-right", label: "Up-Right Arrow", turn: -45 },
    { id: "arrow-block-down-right", label: "Down-Right Arrow", turn: 45 },
    { id: "arrow-block-down-left", label: "Down-Left Arrow", turn: 135 },
    { id: "arrow-block-up-left", label: "Up-Left Arrow", turn: -135 },
  ].map(({ id, label, turn }) => ({
    id,
    category: "arrow" as const,
    label,
    render: (color: string) => renderBlockArrow(color, turn),
  })),
  {
    id: "arrow-left-right",
    category: "arrow",
    label: "Left-Right Arrow",
    render: (color) => <polygon points="4,50 30,20 30,38 70,38 70,20 96,50 70,80 70,62 30,62 30,80" fill={color} />,
  },
  {
    id: "arrow-up-down",
    category: "arrow",
    label: "Up-Down Arrow",
    render: (color) => (
      <polygon points="4,50 30,20 30,38 70,38 70,20 96,50 70,80 70,62 30,62 30,80" fill={color} transform="rotate(90 50 50)" />
    ),
  },
  ...[
    { id: "arrow-thin-right", label: "Thin Right Arrow", turn: 0 },
    { id: "arrow-thin-down", label: "Thin Down Arrow", turn: 90 },
    { id: "arrow-thin-left", label: "Thin Left Arrow", turn: 180 },
    { id: "arrow-thin-up", label: "Thin Up Arrow", turn: -90 },
    { id: "arrow-diagonal", label: "Diagonal Arrow", turn: -45 },
  ].map(({ id, label, turn }) => ({
    id,
    category: "arrow" as const,
    label,
    render: (color: string) => renderThinArrow(color, turn),
  })),
  {
    id: "arrow-four-way",
    category: "arrow",
    label: "Four-Way Arrow",
    render: (color) => (
      <polygon
        points="50,4 66,20 56,20 56,44 80,44 80,34 96,50 80,66 80,56 56,56 56,80 66,80 50,96 34,80 44,80 44,56 20,56 20,66 4,50 20,34 20,44 44,44 44,20 34,20"
        fill={color}
      />
    ),
  },
  {
    id: "arrow-chevron",
    category: "arrow",
    label: "Chevron",
    render: (color) => <polygon points="18,10 50,10 84,50 50,90 18,90 52,50" fill={color} />,
  },
  {
    id: "arrow-outline",
    category: "arrow",
    label: "Outline Arrow",
    render: (color) => (
      <polygon points={BLOCK_ARROW_POINTS} fill="none" stroke={color} strokeWidth="6" strokeLinejoin="round" />
    ),
  },
  {
    id: "arrow-turn",
    category: "arrow",
    label: "Turn Arrow",
    render: (color) => (
      <>
        <path d="M20 88V54A28 28 0 0 1 48 26H70" fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" />
        <polygon points="68,8 94,26 68,44" fill={color} />
      </>
    ),
  },
  {
    id: "arrow-u-turn",
    category: "arrow",
    label: "U-Turn Arrow",
    render: (color) => (
      <>
        <path d="M26 90V42A23 23 0 0 1 72 42V66" fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" />
        <polygon points="56,64 88,64 72,90" fill={color} />
      </>
    ),
  },
  {
    id: "arrow-circular",
    category: "arrow",
    label: "Circular Arrow",
    render: (color) => (
      <>
        <path d="M50 18A32 32 0 1 1 18 50" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" />
        <polygon points="5,54 31,54 18,34" fill={color} />
      </>
    ),
  },
  {
    id: "arrow-curved",
    category: "arrow",
    label: "Curved Arrow",
    render: (color) => (
      <>
        <path d="M10 80Q46 0 80 53" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" />
        <polygon points="91,70 71,59 89,47" fill={color} />
      </>
    ),
  },
  {
    id: "arrow-undo",
    category: "arrow",
    label: "Undo Arrow",
    render: (color) => (
      <>
        <path d="M30 40H62A22 22 0 0 1 62 84H36" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" />
        <polygon points="12,40 32,26 32,54" fill={color} />
      </>
    ),
  },
  {
    id: "arrow-redo",
    category: "arrow",
    label: "Redo Arrow",
    // The undo arrow, flipped left-to-right.
    render: (color) => (
      <g transform="translate(100 0) scale(-1 1)">
        <path d="M30 40H62A22 22 0 0 1 62 84H36" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" />
        <polygon points="12,40 32,26 32,54" fill={color} />
      </g>
    ),
  },
  {
    id: "arrow-cycle",
    category: "arrow",
    label: "Cycle Arrows",
    // One curved arrow over the top, and the same arrow turned halfway around under the bottom.
    render: (color) => (
      <>
        {[0, 180].map((turn) => (
          <g key={turn} transform={`rotate(${turn} 50 50)`}>
            <path d="M19.9 39.1A32 32 0 0 1 80.1 39.1" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" />
            <polygon points="85,52 72,42 89,36" fill={color} />
          </g>
        ))}
      </>
    ),
  },
  {
    id: "arrow-notched",
    category: "arrow",
    label: "Notched Arrow",
    render: (color) => <polygon points="6,36 58,36 58,14 94,50 58,86 58,64 6,64 20,50" fill={color} />,
  },
  {
    id: "arrow-striped",
    category: "arrow",
    label: "Striped Arrow",
    render: (color) => (
      <>
        <rect x="6" y="36" width="5" height="28" fill={color} />
        <rect x="15" y="36" width="5" height="28" fill={color} />
        <polygon points="26,36 58,36 58,14 94,50 58,86 58,64 26,64" fill={color} />
      </>
    ),
  },
  {
    id: "arrow-double-chevron",
    category: "arrow",
    label: "Double Chevron",
    render: (color) => (
      <>
        <polygon points="8,14 30,14 56,50 30,86 8,86 34,50" fill={color} />
        <polygon points="44,14 66,14 92,50 66,86 44,86 70,50" fill={color} />
      </>
    ),
  },
  {
    id: "arrow-zigzag",
    category: "arrow",
    label: "Zigzag Arrow",
    render: (color) => (
      <>
        <polyline points="8,70 36,40 56,60 80,30" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        <polygon points="90,17 88,36 72,24" fill={color} />
      </>
    ),
  },
  {
    id: "arrow-in-circle",
    category: "arrow",
    label: "Arrow in Circle",
    render: (color) => (
      <>
        <circle cx="50" cy="50" r="42" fill={color} />
        <polygon points="26,44 52,44 52,28 76,50 52,72 52,56 26,56" fill="#FFFFFF" />
      </>
    ),
  },
  {
    id: "arrow-callout",
    category: "arrow",
    label: "Callout Arrow",
    render: (color) => (
      <polygon points="6,22 56,22 56,42 76,42 76,32 96,50 76,68 76,58 56,58 56,78 6,78" fill={color} />
    ),
  },

  // Solid (3D) shapes — drawn by our own 3D math (see solids.tsx) so they can be rotated.
  ...[
    { id: "cube", defaultColor: "#F97316", label: "Cube" },
    { id: "cuboid", defaultColor: "#14B8A6", label: "Cuboid" },
    { id: "cylinder", defaultColor: "#3B82F6", label: "Cylinder" },
    { id: "cone", defaultColor: "#EF4444", label: "Cone" },
    { id: "sphere", defaultColor: "#A855F7", label: "Sphere" },
    { id: "pyramid", defaultColor: "#F59E0B", label: "Pyramid" },
    { id: "triangular-prism", defaultColor: "#22C55E", label: "Triangular Prism" },
  ].map(({ id, label, defaultColor }) => ({
    id,
    category: "solid" as const,
    label,
    defaultColor,
    is3d: true,
    render: (color: string, { rotation3d }: RenderSettings) => renderSolid(SOLIDS[id], color, rotation3d),
  })),

  // Icons
  {
    id: "heart",
    category: "icon",
    label: "Heart",
    render: (color) => (
      <path
        d="M50 88C50 88 12 62 12 34C12 18 24 8 38 8C44 8 50 12 50 20C50 12 56 8 62 8C76 8 88 18 88 34C88 62 50 88 50 88Z"
        fill={color}
      />
    ),
  },
  {
    id: "bolt",
    category: "icon",
    label: "Bolt",
    render: (color) => <path d="M56 6 24 52h18l-6 42 40-52H58Z" fill={color} />,
  },
  {
    id: "check-circle",
    category: "icon",
    label: "Check",
    render: (color) => (
      <>
        <circle cx="50" cy="50" r="42" fill="none" stroke={color} strokeWidth="7" />
        <path d="M32 52 46 66 70 34" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  {
    id: "arrow-right",
    category: "icon",
    label: "Arrow",
    render: (color) => (
      <>
        <line x1="10" y1="50" x2="80" y2="50" stroke={color} strokeWidth="7" strokeLinecap="round" />
        <path d="M58 26 86 50 58 74" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  {
    id: "lightbulb",
    category: "icon",
    label: "Idea",
    render: (color) => (
      <>
        <path
          d="M50 10a26 26 0 0 0-15 47c3 2 5 6 5 10h20c0-4 2-8 5-10A26 26 0 0 0 50 10Z"
          fill="none"
          stroke={color}
          strokeWidth="6"
        />
        <line x1="40" y1="82" x2="60" y2="82" stroke={color} strokeWidth="6" strokeLinecap="round" />
        <line x1="43" y1="92" x2="57" y2="92" stroke={color} strokeWidth="6" strokeLinecap="round" />
      </>
    ),
  },

  // Time & Date — both clocks share the same `time` and the toolbar's Set time panel.
  {
    id: "clock",
    category: "time",
    label: "Clock",
    defaultColor: "#191A2C",
    isClock: true,
    render: (color, { clockTime }) => renderClock(color, clockTime),
  },
  {
    id: "digital-clock",
    category: "time",
    label: "Digital Clock",
    defaultColor: "#191A2C",
    isClock: true,
    render: (color, { clockTime }) => renderDigitalClock(color, clockTime),
  },

  // Math Tools — both number lines share `numberLine` and the toolbar's Edit numbers panel.
  {
    id: "number-line",
    category: "math",
    label: "Number Line",
    defaultColor: "#191A2C",
    numberLine: { ticks: 11, centered: false },
    viewBox: "0 0 200 40",
    defaultSize: { width: 260, height: 52 },
    render: (color, { numberLine }) => renderNumberLine(color, 11, false, numberLine),
  },
  {
    id: "integer-number-line",
    category: "math",
    label: "Integer Number Line",
    defaultColor: "#1F1F1F",
    numberLine: { ticks: 17, centered: true },
    viewBox: "0 0 200 40",
    defaultSize: { width: 260, height: 52 },
    render: (color, { numberLine }) => renderNumberLine(color, 17, true, numberLine),
  },
  {
    id: "fraction-bar",
    category: "math",
    label: "Fraction Bar",
    defaultColor: "#3B82F6",
    mathTool: "fraction",
    viewBox: "0 0 200 40",
    defaultSize: { width: 240, height: 48 },
    render: (color, { fraction }) => renderFractionBar(color, fraction),
  },
  {
    id: "fraction-circle",
    category: "math",
    label: "Fraction Circle",
    defaultColor: "#3B82F6",
    mathTool: "fraction",
    render: (color, { fraction }) => renderFractionCircle(color, fraction),
  },
  {
    id: "fraction-number",
    category: "math",
    label: "Written Fraction",
    defaultColor: "#191A2C",
    mathTool: "fractionNumber",
    render: (color, { fraction }) => renderFractionNumber(color, fraction),
  },
  {
    id: "ten-frame",
    category: "math",
    label: "Counting Frame",
    defaultColor: "#EF4444",
    mathTool: "tenFrame",
    viewBox: ({ tenFrame }) => getTenFrameViewBox(tenFrame),
    defaultSize: { width: 220, height: 92 },
    render: (color, { tenFrame }) => renderTenFrame(color, tenFrame),
  },
  {
    id: "base-ten-blocks",
    category: "math",
    label: "Base-Ten Blocks",
    defaultColor: "#3B82F6",
    mathTool: "baseTen",
    viewBox: ({ baseTen }) => getBaseTenViewBox(baseTen),
    // 3 px per drawing unit, for the default 1 hundred, 2 tens, 3 ones.
    defaultSize: (() => {
      const [, , w, h] = getBaseTenViewBox().split(" ").map(Number);
      return { width: w * 3, height: h * 3 };
    })(),
    render: (color, { baseTen }) => renderBaseTen(color, baseTen),
  },
  {
    id: "thermometer",
    category: "math",
    label: "Thermometer",
    defaultColor: "#EF4444",
    mathTool: "thermometer",
    viewBox: "0 0 60 200",
    defaultSize: { width: 60, height: 200 },
    render: (color, { thermometer }) => renderThermometer(color, thermometer),
  },
  {
    id: "bar-graph",
    category: "math",
    label: "Bar Graph",
    defaultColor: "#3B82F6",
    mathTool: "barGraph",
    viewBox: "0 0 200 150",
    defaultSize: { width: 260, height: 195 },
    render: (color, { barGraph }) => renderBarGraph(color, barGraph),
  },
  {
    id: "protractor",
    category: "math",
    label: "Protractor",
    defaultColor: "#EF4444",
    mathTool: "protractor",
    viewBox: "0 0 200 110",
    defaultSize: { width: 240, height: 132 },
    render: (color, { protractor }) => renderProtractor(color, protractor),
  },
  // Rulers: no settings; sizes keep the drawing's shape so the numbers never get squashed.
  {
    id: "ruler-cm",
    category: "math",
    label: "Ruler (cm)",
    defaultColor: "#F2C94C",
    viewBox: "0 0 320 44",
    defaultSize: { width: 288, height: 39.6 },
    render: (color) => renderCmRuler(color),
  },
  {
    id: "ruler-inch",
    category: "math",
    label: "Ruler (inch)",
    defaultColor: "#93C5FD",
    viewBox: "0 0 308 44",
    defaultSize: { width: 277.2, height: 39.6 },
    render: (color) => renderInchRuler(color),
  },
  {
    id: "ruler-dual",
    category: "math",
    label: "Dual Ruler",
    defaultColor: "#F2C94C",
    viewBox: "0 0 320 64",
    defaultSize: { width: 288, height: 57.6 },
    render: (color) => renderDualRuler(color),
  },
  {
    id: "set-square-45",
    category: "math",
    label: "Set Square 45°",
    defaultColor: "#60A5FA",
    viewBox: "0 0 220 220",
    defaultSize: { width: 160, height: 160 },
    render: (color) => renderSetSquare45(color),
  },
  {
    id: "set-square-30-60",
    category: "math",
    label: "Set Square 30°/60°",
    defaultColor: "#60A5FA",
    viewBox: "0 0 216 130",
    defaultSize: { width: 180, height: 108.3 },
    render: (color) => renderSetSquare3060(color),
  },
  ...[1, 2, 3, 4, 5, 6].map((value) => ({
    id: `dice-${value}`,
    category: "math" as const,
    label: `Dice ${value}`,
    defaultColor: "#191A2C",
    render: (color: string) => renderDice(value, color),
  })),
  // Philippine peso coins (current series). Metal colors are the defaults; the color picker can still change them.
  ...[
    { id: "coin-25-sentimo", label: "25 Sentimo", value: "25", unit: "SENTIMO", color: COIN_GOLD },
    { id: "coin-1-peso", label: "₱1 Coin", value: "₱1", unit: "PISO", color: COIN_SILVER },
    { id: "coin-5-peso", label: "₱5 Coin", value: "₱5", unit: "PISO", color: COIN_SILVER },
    { id: "coin-10-peso", label: "₱10 Coin", value: "₱10", unit: "PISO", color: COIN_SILVER },
    { id: "coin-20-peso", label: "₱20 Coin", value: "₱20", unit: "PISO", color: COIN_GOLD },
  ].map(({ id, label, value, unit, color }) => ({
    id,
    category: "math" as const,
    label,
    defaultColor: color,
    render: (fill: string) => renderCoin(fill, value, unit),
  })),

  // Decorative
  {
    id: "dots",
    category: "decorative",
    label: "Dots",
    render: (color) => (
      <>
        <circle cx="26" cy="68" r="9" fill={color} />
        <circle cx="56" cy="38" r="15" fill={color} />
        <circle cx="80" cy="72" r="7" fill={color} />
      </>
    ),
  },
  {
    id: "wave",
    category: "decorative",
    label: "Wave",
    render: (color) => <path d="M5 60 Q27 30 50 60 T95 60" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" />,
  },
  {
    id: "sparkle",
    category: "decorative",
    label: "Sparkle",
    render: (color) => <path d="M50 4 59 41 96 50 59 59 50 96 41 59 4 50 41 41Z" fill={color} />,
  },
  {
    id: "ring",
    category: "decorative",
    label: "Ring",
    render: (color) => <circle cx="50" cy="50" r="36" fill="none" stroke={color} strokeWidth="9" />,
  },
  {
    id: "confetti",
    category: "decorative",
    label: "Confetti",
    render: (color) => (
      <>
        <rect x="20" y="20" width="14" height="6" rx="2" fill={color} transform="rotate(20 27 23)" />
        <rect x="60" y="15" width="12" height="6" rx="2" fill={color} transform="rotate(-15 66 18)" />
        <rect x="70" y="60" width="14" height="6" rx="2" fill={color} transform="rotate(35 77 63)" />
        <rect x="15" y="65" width="10" height="6" rx="2" fill={color} transform="rotate(-25 20 68)" />
        <circle cx="50" cy="45" r="4" fill={color} />
      </>
    ),
  },
  {
    id: "flower",
    category: "decorative",
    label: "Flower",
    render: (color) => (
      <>
        {[0, 72, 144, 216, 288].map((turn) => (
          <ellipse key={turn} cx="50" cy="28" rx="14" ry="22" fill={color} transform={`rotate(${turn} 50 50)`} />
        ))}
        <circle cx="50" cy="50" r="11" fill="#FFFFFF" stroke={color} strokeWidth="5" />
      </>
    ),
  },
  {
    id: "spiral",
    category: "decorative",
    label: "Spiral",
    render: (color) => <path d={SPIRAL_PATH} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" />,
  },
  {
    id: "zigzag",
    category: "decorative",
    label: "Zigzag",
    render: (color) => (
      <polyline
        points="8,62 22,38 36,62 50,38 64,62 78,38 92,62"
        fill="none"
        stroke={color}
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    id: "squiggle",
    category: "decorative",
    label: "Squiggle",
    render: (color) => (
      <path d="M6 50Q17 26 28 50T50 50T72 50T94 50" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" />
    ),
  },
  {
    id: "starburst",
    category: "decorative",
    label: "Starburst",
    render: (color) => <polygon points={STARBURST_POINTS} fill={color} strokeLinejoin="round" />,
  },
  {
    id: "twinkles",
    category: "decorative",
    label: "Twinkles",
    render: (color) => (
      <>
        {renderTwinkle(38, 44, 28, color)}
        {renderTwinkle(76, 24, 14, color)}
        {renderTwinkle(74, 76, 10, color)}
      </>
    ),
  },
  {
    id: "hearts",
    category: "decorative",
    label: "Hearts",
    render: (color) => (
      <>
        <path d={SMALL_HEART_PATH} fill={color} transform="translate(8 30) scale(2.6)" />
        <path d={SMALL_HEART_PATH} fill={color} transform="translate(62 12) scale(1.5)" />
        <path d={SMALL_HEART_PATH} fill={color} transform="translate(66 64) scale(1.1)" />
      </>
    ),
  },
  {
    id: "arcs",
    category: "decorative",
    label: "Arcs",
    render: (color) => (
      <g fill="none" stroke={color} strokeWidth="7" strokeLinecap="round">
        <path d="M14 75A36 36 0 0 1 86 75" />
        <path d="M27 75A23 23 0 0 1 73 75" />
        <path d="M40 75A10 10 0 0 1 60 75" />
      </g>
    ),
  },
  {
    id: "dotted-ring",
    category: "decorative",
    label: "Dotted ring",
    render: (color) => (
      <circle cx="50" cy="50" r="36" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray="0 12.57" />
    ),
  },
  {
    id: "blob",
    category: "decorative",
    label: "Blob",
    render: (color) => (
      <path d="M55 8C78 12 94 30 88 52C82 72 90 88 66 92C44 96 20 88 12 66C4 44 14 28 30 16C38 10 46 7 55 8Z" fill={color} />
    ),
  },
  {
    id: "swoosh",
    category: "decorative",
    label: "Swoosh",
    render: (color) => <path d="M8 72Q50 8 94 38Q50 28 8 72Z" fill={color} />,
  },
  {
    id: "banner",
    category: "decorative",
    label: "Banner",
    render: (color) => (
      <>
        <polygon points="4,42 22,42 22,72 4,72 12,57" fill={color} opacity="0.7" />
        <polygon points="96,42 78,42 78,72 96,72 88,57" fill={color} opacity="0.7" />
        <rect x="14" y="30" width="72" height="32" rx="3" fill={color} />
      </>
    ),
  },
  {
    id: "bunting",
    category: "decorative",
    label: "Bunting",
    render: (color) => (
      <>
        <path d="M4 22Q50 58 96 22" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
        {[
          [16, 29.5],
          [38, 37.7],
          [62, 37.7],
          [84, 29.5],
        ].map(([x, y], i) => (
          <polygon key={x} points={`${x - 10},${y} ${x + 10},${y} ${x},${y + 30}`} fill={color} opacity={i % 2 ? 0.6 : 1} />
        ))}
      </>
    ),
  },
  {
    id: "bow",
    category: "decorative",
    label: "Bow",
    render: (color) => (
      <>
        <polygon points="47,48 32,88 40,83 45,92 53,50" fill={color} opacity="0.7" />
        <polygon points="53,48 68,88 60,83 55,92 47,50" fill={color} opacity="0.7" />
        <path d="M50 45C30 18 6 24 8 45C10 64 32 64 50 45Z" fill={color} />
        <path d="M50 45C70 18 94 24 92 45C90 64 68 64 50 45Z" fill={color} />
        <rect x="41" y="36" width="18" height="19" rx="6" fill={color} stroke="#FFFFFF" strokeWidth="2" />
      </>
    ),
  },
  {
    id: "scallop",
    category: "decorative",
    label: "Scallop edge",
    render: (color) => (
      <>
        <rect x="2" y="34" width="96" height="16" fill={color} />
        {[10, 26, 42, 58, 74, 90].map((cx) => (
          <circle key={cx} cx={cx} cy="50" r="8" fill={color} />
        ))}
      </>
    ),
  },
  {
    id: "rainbow",
    category: "decorative",
    label: "Rainbow",
    render: (color) => (
      <g fill="none" stroke={color} strokeWidth="9" strokeLinecap="round">
        <path d="M10 78A40 40 0 0 1 90 78" />
        <path d="M21 78A29 29 0 0 1 79 78" opacity="0.7" />
        <path d="M32 78A18 18 0 0 1 68 78" opacity="0.45" />
      </g>
    ),
  },
  {
    id: "crown",
    category: "decorative",
    label: "Crown",
    render: (color) => (
      <>
        <polygon points="14,74 10,32 31,52 50,22 69,52 90,32 86,74" fill={color} strokeLinejoin="round" />
        <rect x="14" y="78" width="72" height="10" rx="3" fill={color} />
        <circle cx="10" cy="30" r="5" fill={color} />
        <circle cx="50" cy="19" r="5" fill={color} />
        <circle cx="90" cy="30" r="5" fill={color} />
      </>
    ),
  },
  {
    id: "rosette",
    category: "decorative",
    label: "Rosette",
    render: (color) => (
      <>
        <polygon points="40,54 28,94 40,87 47,96 54,58" fill={color} opacity="0.7" />
        <polygon points="60,54 72,94 60,87 53,96 46,58" fill={color} opacity="0.7" />
        {Array.from({ length: 12 }, (_, i) => (
          <circle key={i} cx="50" cy="16" r="9" fill={color} transform={`rotate(${i * 30} 50 40)`} />
        ))}
        <circle cx="50" cy="40" r="24" fill={color} />
        <circle cx="50" cy="40" r="15" fill="none" stroke="#FFFFFF" strokeWidth="2.5" />
      </>
    ),
  },
  {
    id: "laurel",
    category: "decorative",
    label: "Laurel",
    render: (color) => (
      <>
        <path d="M43.75 85.45A36 36 0 0 1 26.86 22.42M56.25 85.45A36 36 0 0 0 73.14 22.42" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
        {/* Leaves sit just outside and inside the stem, turned to follow the curve. */}
        {[110, 130, 150, 170, 190, 210, 230, 70, 50, 30, 10, -10, -30, -50].flatMap((angle) =>
          [42, 30].map((r) => {
            const rad = (angle * Math.PI) / 180;
            const x = 50 + r * Math.cos(rad);
            const y = 50 + r * Math.sin(rad);
            return <ellipse key={`${angle}-${r}`} cx={x} cy={y} rx="3.5" ry="7" fill={color} transform={`rotate(${angle} ${x} ${y})`} />;
          }),
        )}
      </>
    ),
  },
  {
    id: "balloons",
    category: "decorative",
    label: "Balloons",
    render: (color) => (
      <>
        <g fill="none" stroke={color} strokeWidth="1.5">
          <path d="M28 56Q38 76 50 94" />
          <path d="M72 56Q62 76 50 94" />
          <path d="M50 48V94" />
        </g>
        <ellipse cx="28" cy="38" rx="14" ry="17" fill={color} opacity="0.7" />
        <ellipse cx="72" cy="38" rx="14" ry="17" fill={color} opacity="0.7" />
        <ellipse cx="50" cy="28" rx="15" ry="18" fill={color} />
        <polygon points="47,49 53,49 50,45" fill={color} />
      </>
    ),
  },
  {
    id: "corner-frame",
    category: "decorative",
    label: "Corner frame",
    render: (color) => (
      <g fill="none" stroke={color} strokeWidth="5" strokeLinecap="round">
        <path d="M8 32V16A8 8 0 0 1 16 8H32" />
        <path d="M68 8H84A8 8 0 0 1 92 16V32" />
        <path d="M92 68V84A8 8 0 0 1 84 92H68" />
        <path d="M32 92H16A8 8 0 0 1 8 84V68" />
      </g>
    ),
  },
  {
    id: "divider",
    category: "decorative",
    label: "Divider",
    render: (color) => (
      <>
        <path d="M8 50H36M64 50H92" stroke={color} strokeWidth="3" strokeLinecap="round" />
        <polygon points="50,40 60,50 50,60 40,50" fill={color} />
        <circle cx="8" cy="50" r="3.5" fill={color} />
        <circle cx="92" cy="50" r="3.5" fill={color} />
      </>
    ),
  },
  {
    id: "polka-dots",
    category: "decorative",
    label: "Polka dots",
    render: (color) => (
      <>
        {[14, 38, 62, 86].flatMap((y, row) =>
          [14, 38, 62, 86]
            .map((x) => x + (row % 2 ? 12 : 0))
            .filter((x) => x < 96)
            .map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="5.5" fill={color} />),
        )}
      </>
    ),
  },
  {
    id: "burst-lines",
    category: "decorative",
    label: "Burst lines",
    render: (color) => (
      <>
        {Array.from({ length: 12 }, (_, i) => (
          <rect key={i} x="47" y="6" width="6" height="24" rx="3" fill={color} transform={`rotate(${i * 30} 50 50)`} />
        ))}
      </>
    ),
  },
  {
    id: "brush-stroke",
    category: "decorative",
    label: "Brush stroke",
    render: (color) => (
      <path d="M8 58C20 44 40 40 62 42C78 43 90 40 94 46C96 52 86 56 70 58C50 60 30 62 14 66C8 67 5 62 8 58Z" fill={color} />
    ),
  },
  {
    id: "slashes",
    category: "decorative",
    label: "Slashes",
    render: (color) => (
      <path d="M10 80L40 20M28 80L58 20M46 80L76 20M64 80L94 20" stroke={color} strokeWidth="7" strokeLinecap="round" />
    ),
  },
  {
    id: "pluses",
    category: "decorative",
    label: "Pluses",
    render: (color) => (
      <path
        d={[20, 50, 80].flatMap((y) => [20, 50, 80].map((x) => `M${x - 7} ${y}H${x + 7}M${x} ${y - 7}V${y + 7}`)).join("")}
        stroke={color}
        strokeWidth="4.5"
        strokeLinecap="round"
      />
    ),
  },
  {
    id: "loops",
    category: "decorative",
    label: "Loops",
    render: (color) => (
      <path
        d="M6 60C16 30 34 30 30 50C26 70 44 70 48 50C52 30 70 30 66 50C62 70 80 70 94 40"
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
      />
    ),
  },
  {
    id: "doodle-circle",
    category: "decorative",
    label: "Doodle circle",
    render: (color) => (
      <path
        d="M60 14C30 8 8 28 12 54C16 80 50 92 74 80C94 70 94 36 74 22C62 14 44 14 36 18"
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
      />
    ),
  },

  // Clouds
  {
    id: "cloud",
    category: "cloud",
    label: "Cloud",
    render: (color) => (
      <g transform="translate(5,15) scale(3.75)">
        <path d={CLOUD_PATH} fill={color} />
      </g>
    ),
  },
  {
    id: "cloud-outline",
    category: "cloud",
    label: "Cloud outline",
    render: (color) => (
      <g transform="translate(5,15) scale(3.75)">
        <path d={CLOUD_PATH} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
      </g>
    ),
  },
  {
    id: "cloud-rain",
    category: "cloud",
    label: "Rain cloud",
    render: (color) => (
      <>
        <g transform="translate(5,8) scale(3.2)">
          <path d={CLOUD_PATH} fill={color} />
        </g>
        <line x1="30" y1="80" x2="24" y2="94" stroke={color} strokeWidth="5" strokeLinecap="round" />
        <line x1="50" y1="80" x2="44" y2="94" stroke={color} strokeWidth="5" strokeLinecap="round" />
        <line x1="70" y1="80" x2="64" y2="94" stroke={color} strokeWidth="5" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: "cloud-sun",
    category: "cloud",
    label: "Sun cloud",
    render: (color) => (
      <>
        <circle cx="32" cy="30" r="16" fill={color} />
        <line x1="32" y1="2" x2="32" y2="10" stroke={color} strokeWidth="5" strokeLinecap="round" />
        <line x1="8" y1="30" x2="0" y2="30" stroke={color} strokeWidth="5" strokeLinecap="round" />
        <line x1="12" y1="10" x2="7" y2="5" stroke={color} strokeWidth="5" strokeLinecap="round" />
        <g transform="translate(18,35) scale(3.2)">
          <path d={CLOUD_PATH} fill={color} />
        </g>
      </>
    ),
  },
  {
    id: "cloud-storm",
    category: "cloud",
    label: "Storm cloud",
    render: (color) => (
      <>
        <g transform="translate(5,6) scale(3.2)">
          <path d={CLOUD_PATH} fill={color} />
        </g>
        <path d="M54 66 40 86h12l-8 20 26-30H56Z" fill={color} />
      </>
    ),
  },
  {
    id: "cloud-snow",
    category: "cloud",
    label: "Snow cloud",
    render: (color) => (
      <>
        <g transform="translate(5,8) scale(3.2)">
          <path d={CLOUD_PATH} fill={color} />
        </g>
        <circle cx="30" cy="84" r="4.5" fill={color} />
        <circle cx="50" cy="90" r="4.5" fill={color} />
        <circle cx="70" cy="84" r="4.5" fill={color} />
      </>
    ),
  },
  {
    id: "cloud-moon",
    category: "cloud",
    label: "Moon cloud",
    render: (color) => (
      <>
        <path d="M32 12a18 18 0 1 0 12 31 22 22 0 0 1 -12-31Z" fill={color} />
        <g transform="translate(18,35) scale(3.2)">
          <path d={CLOUD_PATH} fill={color} />
        </g>
      </>
    ),
  },
  {
    id: "cloud-double",
    category: "cloud",
    label: "Double cloud",
    render: (color) => (
      <>
        <g transform="translate(0,42) scale(2.6)">
          <path d={CLOUD_PATH} fill={color} opacity="0.55" />
        </g>
        <g transform="translate(28,18) scale(3.4)">
          <path d={CLOUD_PATH} fill={color} />
        </g>
      </>
    ),
  },

  // Music — note heads are tilted ellipses; stems and beams sit on the right side of the head.
  {
    id: "music-quarter-note",
    category: "music",
    label: "Quarter note",
    render: (color) => (
      <>
        <ellipse cx="38" cy="76" rx="15" ry="10.5" transform="rotate(-20 38 76)" fill={color} />
        <rect x="47" y="10" width="6" height="64" fill={color} />
      </>
    ),
  },
  {
    id: "music-eighth-note",
    category: "music",
    label: "Eighth note",
    render: (color) => (
      <>
        <ellipse cx="38" cy="76" rx="15" ry="10.5" transform="rotate(-20 38 76)" fill={color} />
        <rect x="47" y="10" width="6" height="64" fill={color} />
        <path d="M53 10C53 28 78 32 72 60 70 44 62 38 53 36Z" fill={color} />
      </>
    ),
  },
  {
    id: "music-beamed-notes",
    category: "music",
    label: "Beamed notes",
    render: (color) => (
      <>
        <ellipse cx="28" cy="80" rx="13" ry="9" transform="rotate(-20 28 80)" fill={color} />
        <ellipse cx="72" cy="70" rx="13" ry="9" transform="rotate(-20 72 70)" fill={color} />
        <rect x="35" y="24" width="5.5" height="54" fill={color} />
        <rect x="79" y="14" width="5.5" height="54" fill={color} />
        <polygon points="35,22 84.5,12 84.5,24 35,34" fill={color} />
      </>
    ),
  },
  {
    id: "music-half-note",
    category: "music",
    label: "Half note",
    render: (color) => (
      <>
        <ellipse cx="38" cy="76" rx="13" ry="8.5" transform="rotate(-20 38 76)" fill="none" stroke={color} strokeWidth="5" />
        <rect x="47.5" y="10" width="5.5" height="63" fill={color} />
      </>
    ),
  },
  {
    id: "music-whole-note",
    category: "music",
    label: "Whole note",
    // Outer oval with a tilted oval hole; evenodd cuts the hole out without needing a mask.
    render: (color) => (
      <path
        d="M12 50A38 26 0 1 0 88 50 38 26 0 1 0 12 50ZM60 32.7A20 12 -60 1 0 40 67.3 20 12 -60 1 0 60 32.7Z"
        fillRule="evenodd"
        fill={color}
      />
    ),
  },
  {
    id: "music-treble-clef",
    category: "music",
    label: "Treble clef",
    render: (color) => (
      <>
        <path
          d="M52 66C45 66 43 57 50 54 60 50 70 58 67 68 64 79 50 83 40 77 29 70 30 55 40 47 50 39 60 32 60 19 60 9 55 4 51 7 45 12 45 25 47 38L55 86C56 94 50 97 45 93"
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="45" cy="89" r="6" fill={color} />
      </>
    ),
  },
  {
    id: "music-bass-clef",
    category: "music",
    label: "Bass clef",
    render: (color) => (
      <>
        <circle cx="34" cy="38" r="8" fill={color} />
        <path d="M28 36C28 22 40 14 52 14 66 14 76 24 76 40 76 62 56 78 26 90" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" />
        <circle cx="88" cy="28" r="5" fill={color} />
        <circle cx="88" cy="50" r="5" fill={color} />
      </>
    ),
  },
  {
    id: "music-sharp",
    category: "music",
    label: "Sharp",
    render: (color) => (
      <>
        <line x1="40" y1="14" x2="40" y2="90" stroke={color} strokeWidth="5" strokeLinecap="round" />
        <line x1="60" y1="10" x2="60" y2="86" stroke={color} strokeWidth="5" strokeLinecap="round" />
        <polygon points="24,38 76,26 76,36 24,48" fill={color} />
        <polygon points="24,64 76,52 76,62 24,74" fill={color} />
      </>
    ),
  },
  {
    id: "music-flat",
    category: "music",
    label: "Flat",
    render: (color) => (
      <>
        <line x1="34" y1="6" x2="34" y2="90" stroke={color} strokeWidth="6" strokeLinecap="round" />
        <path d="M34 90C60 76 74 64 70 52 66 40 48 44 34 58" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: "music-natural",
    category: "music",
    label: "Natural",
    render: (color) => (
      <>
        <line x1="36" y1="8" x2="36" y2="72" stroke={color} strokeWidth="5" strokeLinecap="round" />
        <line x1="64" y1="28" x2="64" y2="92" stroke={color} strokeWidth="5" strokeLinecap="round" />
        <polygon points="36,34 64,26 64,36 36,44" fill={color} />
        <polygon points="36,62 64,54 64,64 36,72" fill={color} />
      </>
    ),
  },
  {
    id: "music-staff",
    category: "music",
    label: "Staff",
    render: (color) => (
      <>
        {[22, 36, 50, 64, 78].map((y) => (
          <line key={y} x1="4" y1={y} x2="96" y2={y} stroke={color} strokeWidth="2.5" />
        ))}
        <ellipse cx="38" cy="64" rx="9" ry="6.5" transform="rotate(-20 38 64)" fill={color} />
        <rect x="43.5" y="24" width="3.5" height="39" fill={color} />
        <ellipse cx="66" cy="43" rx="9" ry="6.5" transform="rotate(-20 66 43)" fill={color} />
        <rect x="71.5" y="6" width="3.5" height="36" fill={color} />
      </>
    ),
  },
  {
    id: "music-piano-keys",
    category: "music",
    label: "Piano keys",
    render: (color) => (
      <>
        <rect x="6" y="18" width="88" height="64" rx="6" fill="none" stroke={color} strokeWidth="4" />
        {[18.6, 31.1, 43.7, 56.3, 68.9, 81.4].map((x) => (
          <line key={x} x1={x} y1="18" x2={x} y2="82" stroke={color} strokeWidth="2.5" />
        ))}
        {[18.6, 31.1, 56.3, 68.9, 81.4].map((x) => (
          <rect key={x} x={x - 4} y="18" width="8" height="38" fill={color} />
        ))}
      </>
    ),
  },
  {
    id: "music-headphones",
    category: "music",
    label: "Headphones",
    render: (color) => (
      <>
        <path d="M18 62V50a32 32 0 0 1 64 0v12" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" />
        <rect x="10" y="56" width="16" height="30" rx="6" fill={color} />
        <rect x="74" y="56" width="16" height="30" rx="6" fill={color} />
      </>
    ),
  },
  {
    id: "music-microphone",
    category: "music",
    label: "Microphone",
    render: (color) => (
      <>
        <rect x="36" y="6" width="28" height="48" rx="14" fill={color} />
        <path d="M24 44a26 26 0 0 0 52 0" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" />
        <line x1="50" y1="70" x2="50" y2="86" stroke={color} strokeWidth="6" />
        <line x1="34" y1="90" x2="66" y2="90" stroke={color} strokeWidth="6" strokeLinecap="round" />
      </>
    ),
  },

  // Fruits — the body uses `color` (starting at the fruit's real color); leaves, stems, and seeds
  // keep fixed natural colors so the fruit still reads correctly after a recolor.
  {
    id: "apple",
    category: "fruit",
    label: "Apple",
    defaultColor: "#E53935",
    render: (color) => (
      <>
        <path d="M50 30C40 22 18 22 14 44C10 66 28 92 42 90C46 89 48 87 50 87C52 87 54 89 58 90C72 92 90 66 86 44C82 22 60 22 50 30Z" fill={color} />
        <line x1="50" y1="30" x2="53" y2="12" stroke={STEM_BROWN} strokeWidth="4" strokeLinecap="round" />
        <path d="M54 20C60 8 74 8 78 12C72 20 62 22 54 20Z" fill={LEAF_GREEN} />
      </>
    ),
  },
  {
    id: "banana",
    category: "fruit",
    label: "Banana",
    defaultColor: "#FACC15",
    render: (color) => (
      <>
        <path d="M18 30C14 60 36 88 72 86C82 85 88 80 90 76C80 80 60 80 46 68C32 56 28 42 28 30Z" fill={color} />
        <path d="M18 30 20 20H28V30Z" fill={STEM_BROWN} />
        <circle cx="89" cy="77" r="3" fill={STEM_BROWN} />
      </>
    ),
  },
  {
    id: "orange",
    category: "fruit",
    label: "Orange",
    defaultColor: "#F97316",
    render: (color) => (
      <>
        <circle cx="50" cy="56" r="36" fill={color} />
        <path d="M50 20C54 10 66 7 72 11C66 19 58 21 50 20Z" fill={LEAF_GREEN} />
        <circle cx="50" cy="21" r="3" fill={STEM_BROWN} />
      </>
    ),
  },
  {
    id: "lemon",
    category: "fruit",
    label: "Lemon",
    defaultColor: "#FDE047",
    render: (color) => (
      <>
        <path d="M8 54C14 38 32 26 50 26C68 26 86 38 92 54C86 70 68 82 50 82C32 82 14 70 8 54Z" fill={color} />
        <path d="M50 26C54 16 64 12 72 14C68 22 58 26 50 26Z" fill={LEAF_GREEN} />
      </>
    ),
  },
  {
    id: "pear",
    category: "fruit",
    label: "Pear",
    defaultColor: "#A3E635",
    render: (color) => (
      <>
        <path d="M50 20C42 20 40 30 40 38C40 46 24 54 24 70C24 84 36 92 50 92C64 92 76 84 76 70C76 54 60 46 60 38C60 30 58 20 50 20Z" fill={color} />
        <line x1="50" y1="21" x2="52" y2="8" stroke={STEM_BROWN} strokeWidth="4" strokeLinecap="round" />
        <path d="M52 14C58 6 68 6 72 9C66 15 58 16 52 14Z" fill={LEAF_GREEN} />
      </>
    ),
  },
  {
    id: "cherry",
    category: "fruit",
    label: "Cherry",
    defaultColor: "#DC2626",
    render: (color) => (
      <>
        <path d="M32 58Q38 30 56 14M68 60Q62 34 56 14" fill="none" stroke="#65A30D" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M56 14C64 6 78 8 82 14C74 20 62 20 56 14Z" fill={LEAF_GREEN} />
        <circle cx="32" cy="72" r="16" fill={color} />
        <circle cx="68" cy="74" r="16" fill={color} />
      </>
    ),
  },
  {
    id: "grapes",
    category: "fruit",
    label: "Grapes",
    defaultColor: "#7C3AED",
    render: (color) => (
      <>
        <line x1="50" y1="32" x2="50" y2="14" stroke={STEM_BROWN} strokeWidth="4" strokeLinecap="round" />
        <path d="M50 22C58 12 72 12 78 18C70 26 58 26 50 22Z" fill={LEAF_GREEN} />
        {[[32, 42], [50, 42], [68, 42], [41, 58], [59, 58], [50, 74]].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="10" fill={color} stroke="#000" strokeOpacity="0.15" strokeWidth="1.5" />
        ))}
      </>
    ),
  },
  {
    id: "strawberry",
    category: "fruit",
    label: "Strawberry",
    defaultColor: "#E11D48",
    render: (color) => (
      <>
        <path d="M50 92C30 80 14 58 18 40C21 28 34 26 50 30C66 26 79 28 82 40C86 58 70 80 50 92Z" fill={color} />
        <path d="M30 32 38 16 46 28 50 12 54 28 62 16 70 32C62 36 38 36 30 32Z" fill={LEAF_GREEN} />
        {[[34, 46], [50, 44], [66, 46], [40, 60], [60, 60], [50, 74]].map(([cx, cy]) => (
          <ellipse key={`${cx}-${cy}`} cx={cx} cy={cy} rx="2" ry="3" fill="#FDE68A" />
        ))}
      </>
    ),
  },
  {
    id: "watermelon",
    category: "fruit",
    label: "Watermelon",
    defaultColor: "#EF4444",
    render: (color) => (
      <>
        <path d="M8 34A42 42 0 0 0 92 34Z" fill="#16A34A" />
        <path d="M14 34A36 36 0 0 0 86 34Z" fill="#BBF7D0" />
        <path d="M18 34A32 32 0 0 0 82 34Z" fill={color} />
        {[[34, 44], [50, 48], [66, 44], [42, 56], [58, 56]].map(([cx, cy]) => (
          <ellipse key={`${cx}-${cy}`} cx={cx} cy={cy} rx="2" ry="3.5" fill="#1F1F1F" />
        ))}
      </>
    ),
  },
  {
    id: "pineapple",
    category: "fruit",
    label: "Pineapple",
    defaultColor: "#F59E0B",
    render: (color) => (
      <>
        <path d="M36 42 30 18 44 30 50 4 56 30 70 18 64 42Z" fill={LEAF_GREEN} />
        <ellipse cx="50" cy="66" rx="25" ry="28" fill={color} />
        {[[40, 52], [60, 52], [50, 62], [36, 70], [64, 70], [50, 78], [42, 86], [58, 86]].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.5" fill="#B45309" />
        ))}
      </>
    ),
  },
  // Kitchen — the body uses `color`; water and small fixed parts keep their natural colors
  // so the item still reads correctly after a recolor.
  {
    id: "kitchen-glass-water",
    category: "kitchen",
    label: "Glass of Water",
    defaultColor: "#94A3B8",
    render: (color) => (
      <>
        <path d="M29 42H71L68 88H32Z" fill={WATER_BLUE} fillOpacity="0.75" />
        <path d="M29 42Q40 38 50 42T71 42" fill="none" stroke="#FFFFFF" strokeOpacity="0.8" strokeWidth="2" />
        <path d="M26 12H74L68 92H32Z" fill={color} fillOpacity="0.15" stroke={color} strokeWidth="3" strokeLinejoin="round" />
        <line x1="34" y1="20" x2="37" y2="80" stroke="#FFFFFF" strokeOpacity="0.8" strokeWidth="3" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: "kitchen-pitcher-water",
    category: "kitchen",
    label: "Pitcher of Water",
    defaultColor: "#94A3B8",
    render: (color) => (
      <>
        <path d="M28 46C23 60 23 80 31 89H69C77 80 77 60 72 46Z" fill={WATER_BLUE} fillOpacity="0.75" />
        <path d="M72 32C94 32 94 70 74 76" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" />
        <path d="M16 12L70 14L66 30C80 46 80 80 70 92H30C20 80 20 46 34 30Z" fill={color} fillOpacity="0.15" stroke={color} strokeWidth="3" strokeLinejoin="round" />
        <line x1="32" y1="50" x2="32" y2="80" stroke="#FFFFFF" strokeOpacity="0.8" strokeWidth="3" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: "kitchen-plate",
    category: "kitchen",
    label: "Plate",
    defaultColor: "#60A5FA",
    render: (color) => (
      <>
        <circle cx="50" cy="50" r="44" fill={color} />
        <circle cx="50" cy="50" r="30" fill="#FFFFFF" fillOpacity="0.35" stroke="#000" strokeOpacity="0.12" strokeWidth="1.5" />
      </>
    ),
  },
  {
    id: "kitchen-bowl",
    category: "kitchen",
    label: "Bowl",
    defaultColor: "#F97316",
    render: (color) => (
      <>
        <rect x="38" y="82" width="24" height="8" rx="3" fill={color} />
        <path d="M10 44H90C90 70 72 86 50 86C28 86 10 70 10 44Z" fill={color} />
        <ellipse cx="50" cy="44" rx="40" ry="7" fill="#000" fillOpacity="0.15" />
      </>
    ),
  },
  {
    id: "kitchen-mug",
    category: "kitchen",
    label: "Mug",
    defaultColor: "#3B82F6",
    render: (color) => (
      <>
        <path d="M70 38C90 38 90 70 70 70" fill="none" stroke={color} strokeWidth="7" />
        <rect x="18" y="24" width="54" height="64" rx="8" fill={color} />
        <rect x="18" y="24" width="54" height="7" rx="3" fill="#000" fillOpacity="0.15" />
      </>
    ),
  },
  {
    id: "kitchen-teapot",
    category: "kitchen",
    label: "Teapot",
    defaultColor: "#14B8A6",
    render: (color) => (
      <>
        <path d="M24 58C14 56 10 44 6 38L12 35C16 44 20 50 26 50Z" fill={color} />
        <path d="M78 50C94 50 94 76 76 76" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" />
        <ellipse cx="50" cy="64" rx="30" ry="26" fill={color} />
        <path d="M34 40Q50 26 66 40Z" fill={color} stroke="#000" strokeOpacity="0.15" strokeWidth="1.5" />
        <circle cx="50" cy="28" r="4" fill={color} />
      </>
    ),
  },
  {
    id: "kitchen-spoon",
    category: "kitchen",
    label: "Spoon",
    defaultColor: "#94A3B8",
    render: (color) => (
      <>
        <rect x="47" y="40" width="6" height="54" rx="3" fill={color} />
        <ellipse cx="50" cy="24" rx="14" ry="19" fill={color} />
        <ellipse cx="50" cy="24" rx="9" ry="13" fill="#000" fillOpacity="0.1" />
      </>
    ),
  },
  {
    id: "kitchen-fork",
    category: "kitchen",
    label: "Fork",
    defaultColor: "#94A3B8",
    render: (color) => (
      <>
        {[36, 44, 52, 60].map((x) => (
          <rect key={x} x={x} y="8" width="4" height="30" rx="2" fill={color} />
        ))}
        <path d="M36 32H64C64 42 58 46 53 48H47C42 46 36 42 36 32Z" fill={color} />
        <rect x="47" y="44" width="6" height="50" rx="3" fill={color} />
      </>
    ),
  },
  {
    id: "kitchen-knife",
    category: "kitchen",
    label: "Knife",
    defaultColor: "#94A3B8",
    render: (color) => (
      <>
        <path d="M44 6C60 14 60 40 57 56H44Z" fill={color} />
        <rect x="42" y="54" width="16" height="40" rx="5" fill="#1F2937" />
      </>
    ),
  },
  {
    id: "kitchen-pot",
    category: "kitchen",
    label: "Cooking Pot",
    defaultColor: "#475569",
    render: (color) => (
      <>
        <rect x="6" y="44" width="16" height="7" rx="3" fill={color} />
        <rect x="78" y="44" width="16" height="7" rx="3" fill={color} />
        <rect x="18" y="36" width="64" height="50" rx="6" fill={color} />
        <rect x="14" y="30" width="72" height="8" rx="4" fill={color} stroke="#000" strokeOpacity="0.15" strokeWidth="1.5" />
        <rect x="42" y="22" width="16" height="8" rx="3" fill="#1F2937" />
      </>
    ),
  },
  {
    id: "kitchen-frying-pan",
    category: "kitchen",
    label: "Frying Pan",
    defaultColor: "#334155",
    render: (color) => (
      <>
        <rect x="64" y="51" width="32" height="10" rx="5" fill="#1F2937" />
        <circle cx="38" cy="56" r="32" fill={color} />
        <circle cx="38" cy="56" r="25" fill="#000" fillOpacity="0.2" />
      </>
    ),
  },

  // Vehicles — the body uses `color`; tires, windows, and small parts keep fixed colors so the
  // vehicle still reads correctly after a recolor.
  {
    id: "vehicle-car",
    category: "vehicle",
    label: "Car",
    defaultColor: "#EF4444",
    render: (color) => renderCar(color),
  },
  {
    id: "vehicle-taxi",
    category: "vehicle",
    label: "Taxi",
    defaultColor: "#FACC15",
    render: (color) => renderCar(color, <rect x="42" y="20" width="16" height="9" rx="2" fill={TIRE_DARK} />),
  },
  {
    id: "vehicle-police-car",
    category: "vehicle",
    label: "Police Car",
    defaultColor: "#1E3A8A",
    render: (color) =>
      renderCar(
        color,
        <>
          <rect x="40" y="21" width="10" height="8" rx="2" fill="#EF4444" />
          <rect x="50" y="21" width="10" height="8" rx="2" fill="#3B82F6" />
        </>,
      ),
  },
  {
    id: "vehicle-bus",
    category: "vehicle",
    label: "Bus",
    defaultColor: "#F59E0B",
    render: (color) => (
      <>
        <rect x="6" y="20" width="88" height="58" rx="8" fill={color} />
        {[12, 32, 52].map((x) => (
          <rect key={x} x={x} y="28" width="16" height="16" rx="2" fill={WINDOW_BLUE} />
        ))}
        <rect x="74" y="28" width="14" height="38" rx="2" fill={WINDOW_BLUE} />
        {renderWheel(26, 78, 9)}
        {renderWheel(66, 78, 9)}
      </>
    ),
  },
  {
    id: "vehicle-school-bus",
    category: "vehicle",
    label: "School Bus",
    defaultColor: "#FACC15",
    render: (color) => (
      <>
        <rect x="4" y="22" width="92" height="54" rx="6" fill={color} />
        {[10, 26, 42, 58].map((x) => (
          <rect key={x} x={x} y="30" width="12" height="14" rx="2" fill={WINDOW_BLUE} />
        ))}
        <rect x="76" y="30" width="14" height="36" rx="2" fill={WINDOW_BLUE} />
        <rect x="4" y="50" width="70" height="3" fill={TIRE_DARK} />
        {renderWheel(22, 76, 9)}
        {renderWheel(68, 76, 9)}
      </>
    ),
  },
  {
    id: "vehicle-fire-truck",
    category: "vehicle",
    label: "Fire Truck",
    defaultColor: "#DC2626",
    render: (color) => (
      <>
        <path
          d="M10 30H62M10 38H62M16 30V38M26 30V38M36 30V38M46 30V38M56 30V38"
          fill="none"
          stroke="#9CA3AF"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <rect x="72" y="24" width="8" height="6" rx="1" fill="#3B82F6" />
        <rect x="6" y="40" width="60" height="32" rx="3" fill={color} />
        <path d="M66 30H82L94 48V72H66Z" fill={color} />
        <polygon points="71,35 80,35 89,48 71,48" fill={WINDOW_BLUE} />
        {renderWheel(22, 74, 9)}
        {renderWheel(80, 74, 9)}
      </>
    ),
  },
  {
    id: "vehicle-ambulance",
    category: "vehicle",
    label: "Ambulance",
    defaultColor: "#F8FAFC",
    render: (color) => (
      <>
        <rect x="30" y="20" width="10" height="7" rx="1" fill="#EF4444" />
        <rect x="6" y="26" width="60" height="46" rx="4" fill={color} stroke={SAIL_EDGE} strokeWidth="1.5" />
        <path d="M66 38H80L94 54V72H66Z" fill={color} stroke={SAIL_EDGE} strokeWidth="1.5" />
        <polygon points="70,43 79,43 88,54 70,54" fill={WINDOW_BLUE} />
        <path d="M32 36H40V46H50V54H40V64H32V54H22V46H32Z" fill="#EF4444" />
        {renderWheel(24, 74, 9)}
        {renderWheel(78, 74, 9)}
      </>
    ),
  },
  {
    id: "vehicle-truck",
    category: "vehicle",
    label: "Truck",
    defaultColor: "#3B82F6",
    render: (color) => (
      <>
        <rect x="6" y="24" width="54" height="48" rx="4" fill={color} />
        <path d="M63 38H80L94 55V72H63Z" fill={color} />
        <polygon points="68,43 78,43 88,55 68,55" fill={WINDOW_BLUE} />
        {renderWheel(24, 74, 9)}
        {renderWheel(78, 74, 9)}
      </>
    ),
  },
  {
    id: "vehicle-train",
    category: "vehicle",
    label: "Train",
    defaultColor: "#22C55E",
    render: (color) => (
      <>
        <rect x="28" y="16" width="10" height="16" fill={TIRE_DARK} />
        <rect x="20" y="30" width="70" height="40" rx="4" fill={color} />
        <rect x="60" y="14" width="30" height="22" rx="3" fill={color} />
        <rect x="66" y="20" width="18" height="12" rx="2" fill={WINDOW_BLUE} />
        <polygon points="20,60 6,74 20,74" fill={TIRE_DARK} />
        {renderWheel(32, 76, 8)}
        {renderWheel(54, 76, 8)}
        {renderWheel(76, 76, 8)}
      </>
    ),
  },
  {
    id: "vehicle-airplane",
    category: "vehicle",
    label: "Airplane",
    defaultColor: "#3B82F6",
    render: (color) => (
      <>
        <polygon points="50,34 94,56 94,64 50,54 6,64 6,56" fill={color} />
        <polygon points="50,78 70,90 70,95 50,89 30,95 30,90" fill={color} />
        <ellipse cx="50" cy="50" rx="8" ry="44" fill={color} />
        <ellipse cx="50" cy="18" rx="4" ry="7" fill={WINDOW_BLUE} />
      </>
    ),
  },
  {
    id: "vehicle-airplane-side",
    category: "vehicle",
    label: "Airplane (Side)",
    defaultColor: "#6366F1",
    render: (color) => (
      <>
        <polygon points="8,52 14,22 26,22 36,44" fill={color} />
        <path d="M8 52C8 45 14 42 22 42H78C88 42 96 47 96 52C96 56 90 60 82 60H22C14 60 8 57 8 52Z" fill={color} />
        <polygon points="44,54 70,54 50,82 38,82" fill={color} stroke="#000" strokeOpacity="0.15" strokeWidth="1.5" />
        {[40, 50, 60, 70].map((cx) => (
          <circle key={cx} cx={cx} cy="49" r="3" fill={WINDOW_BLUE} />
        ))}
        <polygon points="80,45 90,48 88,51 80,51" fill={WINDOW_BLUE} />
      </>
    ),
  },
  {
    id: "vehicle-helicopter",
    category: "vehicle",
    label: "Helicopter",
    defaultColor: "#EF4444",
    render: (color) => (
      <>
        <line x1="10" y1="26" x2="78" y2="26" stroke={TIRE_DARK} strokeWidth="4" strokeLinecap="round" />
        <rect x="42" y="26" width="4" height="12" fill={TIRE_DARK} />
        <rect x="64" y="50" width="28" height="7" rx="3" fill={color} />
        <rect x="87" y="40" width="5" height="24" rx="2" fill={TIRE_DARK} />
        <ellipse cx="44" cy="54" rx="26" ry="18" fill={color} />
        <ellipse cx="32" cy="50" rx="10" ry="8" fill={WINDOW_BLUE} />
        <path d="M32 70V82M56 70V82M22 82H66" fill="none" stroke={TIRE_DARK} strokeWidth="4" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: "vehicle-sailboat",
    category: "vehicle",
    label: "Sailboat",
    defaultColor: "#0EA5E9",
    render: (color) => (
      <>
        <line x1="50" y1="8" x2="50" y2="70" stroke={STEM_BROWN} strokeWidth="3" />
        <polygon points="53,12 53,64 86,64" fill={SAIL_WHITE} stroke={SAIL_EDGE} strokeWidth="2" strokeLinejoin="round" />
        <polygon points="47,24 47,64 20,64" fill={SAIL_WHITE} stroke={SAIL_EDGE} strokeWidth="2" strokeLinejoin="round" />
        <path d="M8 70H92L78 88H22Z" fill={color} />
      </>
    ),
  },
  {
    id: "vehicle-ship",
    category: "vehicle",
    label: "Ship",
    defaultColor: "#1E3A8A",
    render: (color) => (
      <>
        <rect x="44" y="20" width="12" height="20" fill={TIRE_DARK} />
        <rect x="28" y="38" width="44" height="22" rx="2" fill={SAIL_WHITE} stroke={SAIL_EDGE} strokeWidth="2" />
        {[38, 50, 62].map((cx) => (
          <circle key={cx} cx={cx} cy="49" r="4" fill={WINDOW_BLUE} stroke={SAIL_EDGE} strokeWidth="1.5" />
        ))}
        <path d="M4 60H96L82 86H18Z" fill={color} />
      </>
    ),
  },
  {
    id: "vehicle-submarine",
    category: "vehicle",
    label: "Submarine",
    defaultColor: "#FACC15",
    render: (color) => (
      <>
        <path d="M54 32V16H66" fill="none" stroke={TIRE_DARK} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <polygon points="86,50 96,44 96,76 86,70" fill={TIRE_DARK} />
        <rect x="36" y="30" width="24" height="18" rx="4" fill={color} />
        <ellipse cx="48" cy="60" rx="40" ry="20" fill={color} />
        {[30, 48, 66].map((cx) => (
          <circle key={cx} cx={cx} cy="60" r="5" fill={WINDOW_BLUE} stroke={TIRE_DARK} strokeWidth="2" />
        ))}
      </>
    ),
  },
  {
    id: "vehicle-bicycle",
    category: "vehicle",
    label: "Bicycle",
    defaultColor: "#14B8A6",
    render: (color) => (
      <>
        <circle cx="24" cy="66" r="16" fill="none" stroke={TIRE_DARK} strokeWidth="4" />
        <circle cx="76" cy="66" r="16" fill="none" stroke={TIRE_DARK} strokeWidth="4" />
        <path
          d="M24 66 42 40H68L76 66M42 40 50 66 68 40M50 66H24M42 40 38 32M32 32H46M68 40 66 28H74"
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    ),
  },
  {
    id: "vehicle-motorcycle",
    category: "vehicle",
    label: "Motorcycle",
    defaultColor: "#EF4444",
    render: (color) => (
      <>
        <path d="M20 70 36 56M80 70 75 42M70 30H78L75 42" fill="none" stroke={TIRE_DARK} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {renderWheel(20, 70, 14)}
        {renderWheel(80, 70, 14)}
        <path d="M26 58 38 46H60L70 38H77L74 58Z" fill={color} />
        <path d="M34 46C38 38 54 38 58 46Z" fill={TIRE_DARK} />
      </>
    ),
  },
  {
    id: "vehicle-excavator",
    category: "vehicle",
    label: "Excavator",
    defaultColor: "#F59E0B",
    render: (color) => (
      <>
        <rect x="8" y="70" width="56" height="18" rx="9" fill={TIRE_DARK} />
        {[17, 36, 55].map((cx) => (
          <circle key={cx} cx={cx} cy="79" r="5" fill={HUB_GRAY} />
        ))}
        <path d="M50 54 74 22 88 46" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        <polygon points="82,46 96,46 94,62 80,58" fill={TIRE_DARK} />
        <rect x="12" y="48" width="44" height="22" rx="3" fill={color} />
        <rect x="16" y="30" width="22" height="20" rx="3" fill={color} />
        <rect x="20" y="34" width="14" height="12" rx="2" fill={WINDOW_BLUE} />
      </>
    ),
  },
  {
    id: "vehicle-rocket",
    category: "vehicle",
    label: "Rocket",
    defaultColor: "#E5E7EB",
    render: (color) => (
      <>
        <polygon points="40,72 60,72 50,95" fill="#F97316" />
        <polygon points="36,50 20,76 37,70" fill="#EF4444" />
        <polygon points="64,50 80,76 63,70" fill="#EF4444" />
        <path d="M50 5C67 20 69 46 64 72H36C31 46 33 20 50 5Z" fill={color} stroke={SAIL_EDGE} strokeWidth="1.5" />
        <circle cx="50" cy="36" r="8" fill={WINDOW_BLUE} stroke={TIRE_DARK} strokeWidth="2.5" />
      </>
    ),
  },
  {
    id: "vehicle-hot-air-balloon",
    category: "vehicle",
    label: "Hot Air Balloon",
    defaultColor: "#EC4899",
    render: (color) => (
      <>
        <path d="M50 5C74 5 86 23 86 40C86 58 64 68 60 74H40C36 68 14 58 14 40C14 23 26 5 50 5Z" fill={color} />
        <path d="M50 5C40 20 40 58 46 74H54C60 58 60 20 50 5Z" fill="#FFFFFF" fillOpacity="0.35" />
        <path d="M41 74 43 84M59 74 57 84" stroke={TIRE_DARK} strokeWidth="2" />
        <rect x="40" y="84" width="20" height="12" rx="2" fill={STEM_BROWN} />
      </>
    ),
  },
  {
    id: "vehicle-tractor",
    category: "vehicle",
    label: "Tractor",
    defaultColor: "#16A34A",
    render: (color) => (
      <>
        <rect x="62" y="24" width="5" height="18" fill={TIRE_DARK} />
        <rect x="28" y="18" width="26" height="30" rx="3" fill={color} />
        <rect x="33" y="23" width="16" height="14" rx="2" fill={WINDOW_BLUE} />
        <rect x="28" y="42" width="62" height="22" rx="4" fill={color} />
        {renderWheel(38, 70, 20)}
        {renderWheel(80, 78, 12)}
      </>
    ),
  },

  // Animals — friendly front-facing faces. The fur/skin uses `color`; eyes, noses, beaks, and
  // markings keep fixed colors so the animal still reads correctly after a recolor.
  {
    id: "animal-cat",
    category: "animal",
    label: "Cat",
    defaultColor: "#F97316",
    render: (color) => (
      <>
        <polygon points="16,42 22,8 46,26" fill={color} />
        <polygon points="84,42 78,8 54,26" fill={color} />
        <polygon points="24,32 26,16 38,26" fill={ANIMAL_PINK} />
        <polygon points="76,32 74,16 62,26" fill={ANIMAL_PINK} />
        <circle cx="50" cy="56" r="36" fill={color} />
        {renderEyes(52, 14)}
        <polygon points="46,63 54,63 50,68" fill={ANIMAL_PINK} />
        <path
          d="M50 68Q46 75 42 72M50 68Q54 75 58 72M30 64H14M30 70 16 75M70 64H86M70 70 84 75"
          fill="none"
          stroke={ANIMAL_INK}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </>
    ),
  },
  {
    id: "animal-dog",
    category: "animal",
    label: "Dog",
    defaultColor: "#C58B4E",
    render: (color) => (
      <>
        <ellipse cx="50" cy="54" rx="30" ry="34" fill={color} />
        <ellipse cx="20" cy="46" rx="10" ry="22" transform="rotate(20 20 46)" fill="#5D4037" />
        <ellipse cx="80" cy="46" rx="10" ry="22" transform="rotate(-20 80 46)" fill="#5D4037" />
        {lightPatch(<ellipse cx="50" cy="70" rx="16" ry="12" />)}
        {renderEyes(46, 12)}
        <ellipse cx="50" cy="64" rx="6" ry="4" fill={ANIMAL_INK} />
        <path d="M50 68V73M43 75Q50 80 57 75" fill="none" stroke={ANIMAL_INK} strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: "animal-bear",
    category: "animal",
    label: "Bear",
    defaultColor: "#92400E",
    render: (color) => (
      <>
        <circle cx="22" cy="24" r="12" fill={color} />
        <circle cx="78" cy="24" r="12" fill={color} />
        {lightPatch(
          <>
            <circle cx="22" cy="24" r="6" />
            <circle cx="78" cy="24" r="6" />
          </>,
        )}
        <circle cx="50" cy="56" r="36" fill={color} />
        {lightPatch(<ellipse cx="50" cy="68" rx="14" ry="11" />)}
        {renderEyes(48, 14)}
        <ellipse cx="50" cy="63" rx="5" ry="3.5" fill={ANIMAL_INK} />
        <path d="M50 66V72" stroke={ANIMAL_INK} strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: "animal-panda",
    category: "animal",
    label: "Panda",
    defaultColor: "#F8FAFC",
    render: (color) => (
      <>
        <circle cx="22" cy="24" r="12" fill={ANIMAL_INK} />
        <circle cx="78" cy="24" r="12" fill={ANIMAL_INK} />
        <circle cx="50" cy="56" r="36" fill={color} stroke={SAIL_EDGE} strokeWidth="1.5" />
        <ellipse cx="36" cy="52" rx="9" ry="11" transform="rotate(20 36 52)" fill={ANIMAL_INK} />
        <ellipse cx="64" cy="52" rx="9" ry="11" transform="rotate(-20 64 52)" fill={ANIMAL_INK} />
        <circle cx="37" cy="50" r="3" fill="#FFFFFF" />
        <circle cx="63" cy="50" r="3" fill="#FFFFFF" />
        <ellipse cx="50" cy="66" rx="5" ry="3.5" fill={ANIMAL_INK} />
        <path d="M50 69V73M44 75Q50 79 56 75" fill="none" stroke={ANIMAL_INK} strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: "animal-pig",
    category: "animal",
    label: "Pig",
    defaultColor: "#F9A8D4",
    render: (color) => (
      <>
        <polygon points="18,38 16,10 42,24" fill={color} />
        <polygon points="82,38 84,10 58,24" fill={color} />
        <circle cx="50" cy="54" r="36" fill={color} />
        <ellipse cx="50" cy="64" rx="14" ry="10" fill="#F472B6" />
        <ellipse cx="45" cy="64" rx="2" ry="3.5" fill={ANIMAL_INK} />
        <ellipse cx="55" cy="64" rx="2" ry="3.5" fill={ANIMAL_INK} />
        {renderEyes(46, 14)}
      </>
    ),
  },
  {
    id: "animal-rabbit",
    category: "animal",
    label: "Rabbit",
    defaultColor: "#D6D3D1",
    render: (color) => (
      <>
        <ellipse cx="36" cy="26" rx="9" ry="22" fill={color} />
        <ellipse cx="64" cy="26" rx="9" ry="22" fill={color} />
        <ellipse cx="36" cy="28" rx="4" ry="15" fill={ANIMAL_PINK} />
        <ellipse cx="64" cy="28" rx="4" ry="15" fill={ANIMAL_PINK} />
        <circle cx="50" cy="64" r="30" fill={color} />
        {renderEyes(58, 11)}
        <ellipse cx="50" cy="68" rx="4" ry="3" fill={ANIMAL_PINK} />
        <path d="M50 71Q46 75 43 73M50 71Q54 75 57 73" fill="none" stroke={ANIMAL_INK} strokeWidth="1.8" strokeLinecap="round" />
        <rect x="47" y="73" width="6" height="6" rx="1" fill="#FFFFFF" stroke={SAIL_EDGE} strokeWidth="1" />
      </>
    ),
  },
  {
    id: "animal-lion",
    category: "animal",
    label: "Lion",
    defaultColor: "#F59E0B",
    render: (color) => (
      <>
        <circle cx="50" cy="52" r="44" fill="#B45309" />
        <circle cx="28" cy="26" r="8" fill={color} />
        <circle cx="72" cy="26" r="8" fill={color} />
        <circle cx="50" cy="54" r="30" fill={color} />
        {lightPatch(<ellipse cx="50" cy="66" rx="12" ry="9" />)}
        {renderEyes(48, 11)}
        <polygon points="45,60 55,60 50,66" fill={ANIMAL_INK} />
        <path d="M50 66Q46 72 42 70M50 66Q54 72 58 70" fill="none" stroke={ANIMAL_INK} strokeWidth="1.8" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: "animal-fox",
    category: "animal",
    label: "Fox",
    defaultColor: "#EA580C",
    render: (color) => (
      <>
        <polygon points="14,40 20,6 42,26" fill={color} />
        <polygon points="86,40 80,6 58,26" fill={color} />
        <polygon points="22,30 22,16 34,26" fill={ANIMAL_INK} />
        <polygon points="78,30 78,16 66,26" fill={ANIMAL_INK} />
        <path d="M10 38Q50 14 90 38Q80 70 50 92Q20 70 10 38Z" fill={color} />
        <path d="M18 50Q34 54 50 68Q66 54 82 50Q72 76 50 92Q28 76 18 50Z" fill="#FFFFFF" />
        {renderEyes(46, 14)}
        <circle cx="50" cy="88" r="4" fill={ANIMAL_INK} />
      </>
    ),
  },
  {
    id: "animal-mouse",
    category: "animal",
    label: "Mouse",
    defaultColor: "#9CA3AF",
    render: (color) => (
      <>
        <circle cx="24" cy="30" r="18" fill={color} />
        <circle cx="76" cy="30" r="18" fill={color} />
        <circle cx="24" cy="30" r="10" fill={ANIMAL_PINK} />
        <circle cx="76" cy="30" r="10" fill={ANIMAL_PINK} />
        <ellipse cx="50" cy="60" rx="28" ry="26" fill={color} />
        {renderEyes(56, 10)}
        <circle cx="50" cy="70" r="4" fill={ANIMAL_PINK} />
        <path d="M36 70H20M36 75 22 80M64 70H80M64 75 78 80" fill="none" stroke={ANIMAL_INK} strokeWidth="1.5" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: "animal-monkey",
    category: "animal",
    label: "Monkey",
    defaultColor: "#92400E",
    render: (color) => (
      <>
        <circle cx="14" cy="50" r="12" fill={color} />
        <circle cx="86" cy="50" r="12" fill={color} />
        <circle cx="14" cy="50" r="6" fill="#FCD9B6" />
        <circle cx="86" cy="50" r="6" fill="#FCD9B6" />
        <circle cx="50" cy="50" r="36" fill={color} />
        <g fill="#FCD9B6">
          <circle cx="38" cy="44" r="14" />
          <circle cx="62" cy="44" r="14" />
          <ellipse cx="50" cy="64" rx="24" ry="18" />
        </g>
        {renderEyes(46, 12)}
        <circle cx="47" cy="60" r="1.5" fill={ANIMAL_INK} />
        <circle cx="53" cy="60" r="1.5" fill={ANIMAL_INK} />
        <path d="M40 68Q50 75 60 68" fill="none" stroke={ANIMAL_INK} strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: "animal-cow",
    category: "animal",
    label: "Cow",
    defaultColor: "#F8FAFC",
    render: (color) => (
      <>
        <polygon points="30,22 26,6 38,16" fill="#E7E5E4" stroke={SAIL_EDGE} strokeWidth="1.5" strokeLinejoin="round" />
        <polygon points="70,22 74,6 62,16" fill="#E7E5E4" stroke={SAIL_EDGE} strokeWidth="1.5" strokeLinejoin="round" />
        <ellipse cx="16" cy="36" rx="12" ry="6" fill={color} stroke={SAIL_EDGE} strokeWidth="1.5" />
        <ellipse cx="84" cy="36" rx="12" ry="6" fill={color} stroke={SAIL_EDGE} strokeWidth="1.5" />
        <ellipse cx="50" cy="48" rx="28" ry="32" fill={color} stroke={SAIL_EDGE} strokeWidth="1.5" />
        <ellipse cx="62" cy="30" rx="10" ry="8" fill={ANIMAL_INK} />
        {renderEyes(48, 12)}
        <ellipse cx="50" cy="74" rx="22" ry="14" fill={ANIMAL_PINK} />
        <ellipse cx="42" cy="74" rx="3" ry="4" fill={ANIMAL_INK} />
        <ellipse cx="58" cy="74" rx="3" ry="4" fill={ANIMAL_INK} />
      </>
    ),
  },
  {
    id: "animal-frog",
    category: "animal",
    label: "Frog",
    defaultColor: "#22C55E",
    render: (color) => (
      <>
        <circle cx="30" cy="30" r="14" fill={color} />
        <circle cx="70" cy="30" r="14" fill={color} />
        <ellipse cx="50" cy="58" rx="40" ry="30" fill={color} />
        <circle cx="30" cy="30" r="9" fill="#FFFFFF" />
        <circle cx="70" cy="30" r="9" fill="#FFFFFF" />
        <circle cx="30" cy="30" r="4" fill={ANIMAL_INK} />
        <circle cx="70" cy="30" r="4" fill={ANIMAL_INK} />
        <path d="M28 64Q50 80 72 64" fill="none" stroke={ANIMAL_INK} strokeWidth="3" strokeLinecap="round" />
        <circle cx="22" cy="62" r="5" fill={ANIMAL_PINK} fillOpacity="0.7" />
        <circle cx="78" cy="62" r="5" fill={ANIMAL_PINK} fillOpacity="0.7" />
      </>
    ),
  },
  {
    id: "animal-owl",
    category: "animal",
    label: "Owl",
    defaultColor: "#A16207",
    render: (color) => (
      <>
        <polygon points="18,28 22,6 40,20" fill={color} />
        <polygon points="82,28 78,6 60,20" fill={color} />
        <ellipse cx="50" cy="56" rx="36" ry="40" fill={color} />
        {lightPatch(<ellipse cx="50" cy="76" rx="20" ry="16" />)}
        <circle cx="34" cy="40" r="15" fill="#FFFFFF" />
        <circle cx="66" cy="40" r="15" fill="#FFFFFF" />
        <circle cx="34" cy="40" r="7" fill={ANIMAL_INK} />
        <circle cx="66" cy="40" r="7" fill={ANIMAL_INK} />
        <polygon points="44,52 56,52 50,64" fill={BEAK_ORANGE} />
      </>
    ),
  },
  {
    id: "animal-penguin",
    category: "animal",
    label: "Penguin",
    defaultColor: "#1F2937",
    render: (color) => (
      <>
        <ellipse cx="38" cy="94" rx="8" ry="4" fill={BEAK_ORANGE} />
        <ellipse cx="62" cy="94" rx="8" ry="4" fill={BEAK_ORANGE} />
        <ellipse cx="50" cy="52" rx="32" ry="42" fill={color} />
        <ellipse cx="50" cy="60" rx="22" ry="32" fill="#FFFFFF" />
        {renderEyes(38, 10)}
        <polygon points="44,45 56,45 50,53" fill={BEAK_ORANGE} />
      </>
    ),
  },
  {
    id: "animal-chick",
    category: "animal",
    label: "Chick",
    defaultColor: "#FACC15",
    render: (color) => (
      <>
        <path d="M42 90V96M58 90V96M38 96H46M54 96H62" fill="none" stroke={BEAK_ORANGE} strokeWidth="3" strokeLinecap="round" />
        <path d="M46 28Q44 16 50 14Q52 20 54 28Z" fill={color} />
        <circle cx="50" cy="58" r="34" fill={color} />
        <ellipse cx="80" cy="62" rx="7" ry="13" fill={color} stroke="#000" strokeOpacity="0.15" strokeWidth="1.5" />
        <ellipse cx="20" cy="62" rx="7" ry="13" fill={color} stroke="#000" strokeOpacity="0.15" strokeWidth="1.5" />
        {renderEyes(50, 10)}
        <polygon points="44,58 56,58 50,66" fill={BEAK_ORANGE} />
      </>
    ),
  },
  {
    id: "animal-fish",
    category: "animal",
    label: "Fish",
    defaultColor: "#3B82F6",
    render: (color) => (
      <>
        <polygon points="68,50 94,28 94,72" fill={color} />
        <polygon points="36,30 54,16 60,32" fill={color} />
        <ellipse cx="44" cy="50" rx="34" ry="22" fill={color} />
        <circle cx="26" cy="46" r="5" fill="#FFFFFF" />
        <circle cx="26" cy="46" r="2.5" fill={ANIMAL_INK} />
        <path d="M12 56Q16 58 20 56" fill="none" stroke={ANIMAL_INK} strokeWidth="2" strokeLinecap="round" />
        <path d="M50 34Q58 50 50 66" fill="none" stroke="#000" strokeOpacity="0.15" strokeWidth="2" />
      </>
    ),
  },

  // Solar System — each planet's main color uses `color`; bands, craters, and spots are
  // see-through patches so they still show after a recolor.
  {
    id: "space-sun",
    category: "space",
    label: "Sun",
    defaultColor: "#FACC15",
    render: (color) => (
      <>
        {[0, 45, 90, 135, 180, 225, 270, 315].map((turn) => (
          <polygon key={turn} points="50,2 57,17 43,17" fill={color} transform={`rotate(${turn} 50 50)`} />
        ))}
        <circle cx="50" cy="50" r="30" fill={color} />
        {lightPatch(<circle cx="42" cy="42" r="12" />)}
      </>
    ),
  },
  {
    id: "space-mercury",
    category: "space",
    label: "Mercury",
    defaultColor: "#9CA3AF",
    render: (color) => (
      <>
        <circle cx="50" cy="50" r="40" fill={color} />
        {darkPatch(
          <>
            <circle cx="36" cy="38" r="7" />
            <circle cx="62" cy="58" r="9" />
            <circle cx="42" cy="68" r="5" />
            <circle cx="66" cy="32" r="4" />
          </>,
        )}
      </>
    ),
  },
  {
    id: "space-venus",
    category: "space",
    label: "Venus",
    defaultColor: "#E8B25C",
    render: (color) => (
      <>
        <circle cx="50" cy="50" r="40" fill={color} />
        <path
          d="M18 38Q50 28 82 40M12 54Q50 46 88 58M22 72Q50 66 78 76"
          fill="none"
          stroke="#FFFFFF"
          strokeOpacity="0.4"
          strokeWidth="6"
          strokeLinecap="round"
        />
      </>
    ),
  },
  {
    id: "space-earth",
    category: "space",
    label: "Earth",
    defaultColor: "#3B82F6",
    render: (color) => (
      <>
        <circle cx="50" cy="50" r="40" fill={color} />
        <g fill={LEAF_GREEN}>
          <path d="M30 20Q40 14 48 20Q52 30 44 36Q36 42 38 52Q34 60 26 54Q16 44 22 32Z" />
          <path d="M60 42Q70 38 78 46Q82 58 72 68Q62 76 58 66Q62 58 56 50Z" />
          <path d="M40 76Q48 72 54 78Q50 86 42 84Z" />
        </g>
      </>
    ),
  },
  {
    id: "space-mars",
    category: "space",
    label: "Mars",
    defaultColor: "#DC4B2A",
    render: (color) => (
      <>
        <circle cx="50" cy="50" r="40" fill={color} />
        {darkPatch(
          <>
            <ellipse cx="38" cy="42" rx="10" ry="6" />
            <ellipse cx="62" cy="62" rx="12" ry="7" />
            <circle cx="66" cy="36" r="4" />
          </>,
        )}
        <ellipse cx="50" cy="14" rx="12" ry="4" fill="#FFFFFF" />
      </>
    ),
  },
  {
    id: "space-jupiter",
    category: "space",
    label: "Jupiter",
    defaultColor: "#D9A066",
    render: (color) => (
      <>
        <circle cx="50" cy="50" r="40" fill={color} />
        {darkPatch(renderBands(40, [28, 40, 56, 70], 6))}
        <ellipse cx="62" cy="62" rx="8" ry="5" fill="#B45309" />
      </>
    ),
  },
  {
    id: "space-saturn",
    category: "space",
    label: "Saturn",
    defaultColor: "#E3C77A",
    // The ring is drawn in two halves — back half behind the planet, front half over it.
    render: (color) => (
      <g transform="rotate(-15 50 50)">
        <path d="M4 50A46 13 0 0 1 96 50" fill="none" stroke="#B8A07A" strokeWidth="6" />
        <circle cx="50" cy="50" r="28" fill={color} />
        {darkPatch(renderBands(28, [40, 58], 5))}
        <path d="M4 50A46 13 0 0 0 96 50" fill="none" stroke="#B8A07A" strokeWidth="6" />
      </g>
    ),
  },
  {
    id: "space-uranus",
    category: "space",
    label: "Uranus",
    defaultColor: "#7DD3FC",
    render: (color) => (
      <>
        <circle cx="50" cy="50" r="38" fill={color} />
        {lightPatch(renderBands(38, [36], 8))}
        <ellipse cx="50" cy="50" rx="10" ry="47" fill="none" stroke="#FFFFFF" strokeOpacity="0.7" strokeWidth="2.5" />
      </>
    ),
  },
  {
    id: "space-neptune",
    category: "space",
    label: "Neptune",
    defaultColor: "#2563EB",
    render: (color) => (
      <>
        <circle cx="50" cy="50" r="40" fill={color} />
        {lightPatch(renderBands(40, [30, 66], 3))}
        {darkPatch(<ellipse cx="38" cy="46" rx="9" ry="6" />)}
      </>
    ),
  },
  {
    id: "space-pluto",
    category: "space",
    label: "Pluto",
    defaultColor: "#C9A98B",
    render: (color) => (
      <>
        <circle cx="50" cy="50" r="34" fill={color} />
        {lightPatch(<path d="M56 70C44 62 42 52 48 48C52 46 56 50 57 54C58 49 64 46 68 50C72 56 66 64 56 70Z" />)}
        {darkPatch(<circle cx="36" cy="38" r="5" />)}
      </>
    ),
  },
  {
    id: "space-moon",
    category: "space",
    label: "Moon",
    defaultColor: "#D1D5DB",
    render: (color) => (
      <>
        <circle cx="50" cy="50" r="40" fill={color} />
        {darkPatch(
          <>
            <circle cx="34" cy="36" r="8" />
            <circle cx="60" cy="30" r="5" />
            <circle cx="62" cy="60" r="10" />
            <circle cx="36" cy="66" r="5" />
          </>,
        )}
      </>
    ),
  },
  {
    id: "space-crescent-moon",
    category: "space",
    label: "Crescent Moon",
    defaultColor: "#FDE047",
    render: (color) => <path d="M50 8A42 42 0 1 0 50 92A52 52 0 0 1 50 8Z" fill={color} />,
  },
  {
    id: "space-comet",
    category: "space",
    label: "Comet",
    defaultColor: "#7DD3FC",
    render: (color) => (
      <>
        <path d="M64 20 8 90 80 36Z" fill={color} fillOpacity="0.35" />
        <path d="M67 25 22 84 76 33Z" fill={color} fillOpacity="0.6" />
        <circle cx="74" cy="28" r="13" fill={color} />
        {lightPatch(<circle cx="71" cy="25" r="6" />)}
      </>
    ),
  },
  {
    id: "space-asteroid",
    category: "space",
    label: "Asteroid",
    defaultColor: "#78716C",
    render: (color) => (
      <>
        <path d="M30 18 58 12 82 28 88 56 72 82 40 86 16 66 14 38Z" fill={color} stroke={color} strokeWidth="6" strokeLinejoin="round" />
        {darkPatch(
          <>
            <circle cx="38" cy="36" r="7" />
            <circle cx="64" cy="54" r="10" />
            <circle cx="36" cy="66" r="5" />
          </>,
        )}
      </>
    ),
  },
  {
    id: "space-solar-system",
    category: "space",
    label: "Solar System",
    defaultColor: "#FACC15",
    // The Sun and the 8 planets in order. Only the Sun uses `color`; each planet keeps its own.
    viewBox: "0 0 200 60",
    defaultSize: { width: 320, height: 96 },
    render: (color) => (
      <>
        <circle cx="16" cy="30" r="14" fill={color} />
        {[
          { cx: 40, r: 2.5, fill: "#9CA3AF" },
          { cx: 51, r: 4, fill: "#E8B25C" },
          { cx: 64, r: 4.2, fill: "#3B82F6" },
          { cx: 77, r: 3.2, fill: "#DC4B2A" },
          { cx: 100, r: 11, fill: "#D9A066" },
          { cx: 132, r: 8.5, fill: "#E3C77A" },
          { cx: 159, r: 6, fill: "#7DD3FC" },
          { cx: 184, r: 6, fill: "#2563EB" },
        ].map(({ cx, r, fill }) => (
          <circle key={cx} cx={cx} cy="30" r={r} fill={fill} />
        ))}
        <ellipse cx="132" cy="30" rx="14" ry="3.5" fill="none" stroke="#B8A07A" strokeWidth="1.8" transform="rotate(-15 132 30)" />
      </>
    ),
  },

  // Sports — the main part uses `color`; seams, lines, holes, and handles keep fixed colors.
  {
    id: "sport-soccer-ball",
    category: "sport",
    label: "Soccer Ball",
    defaultColor: "#F8FAFC",
    // A dark pentagon in the middle, lines out to five half-seen pentagons near the edge.
    render: (color) => (
      <>
        <circle cx="50" cy="50" r="42" fill={color} stroke={ANIMAL_INK} strokeWidth="2.5" />
        <polygon points={polygonPoints(50, 50, 12, 5)} fill={ANIMAL_INK} />
        {[0, 1, 2, 3, 4].map((i) => {
          const turn = -90 + i * 72;
          const rad = (turn * Math.PI) / 180;
          const at = (r: number) => [50 + r * Math.cos(rad), 50 + r * Math.sin(rad)];
          const [x1, y1] = at(12);
          const [x2, y2] = at(27);
          const [cx, cy] = at(34);
          return (
            <g key={i}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={ANIMAL_INK} strokeWidth="2.5" />
              <polygon points={polygonPoints(cx, cy, 7, 5, turn + 180)} fill={ANIMAL_INK} />
            </g>
          );
        })}
      </>
    ),
  },
  {
    id: "sport-basketball",
    category: "sport",
    label: "Basketball",
    defaultColor: "#F97316",
    render: (color) => (
      <>
        <circle cx="50" cy="50" r="42" fill={color} />
        <path d="M8 50H92M50 8V92M22 20Q40 50 22 80M78 20Q60 50 78 80" fill="none" stroke={ANIMAL_INK} strokeWidth="3" />
        <circle cx="50" cy="50" r="42" fill="none" stroke={ANIMAL_INK} strokeWidth="3" />
      </>
    ),
  },
  {
    id: "sport-baseball",
    category: "sport",
    label: "Baseball",
    defaultColor: "#F8FAFC",
    // Each seam is a red curve plus a thick dashed copy of it, which draws the short stitches.
    render: (color) => (
      <>
        <circle cx="50" cy="50" r="42" fill={color} stroke={SAIL_EDGE} strokeWidth="2" />
        <g fill="none" stroke="#EF4444">
          <path d="M26 16Q42 50 26 84M74 16Q58 50 74 84" strokeWidth="2.5" />
          <path d="M26 16Q42 50 26 84M74 16Q58 50 74 84" strokeWidth="8" strokeDasharray="1.5 5" />
        </g>
      </>
    ),
  },
  {
    id: "sport-tennis-ball",
    category: "sport",
    label: "Tennis Ball",
    defaultColor: "#C6E94B",
    render: (color) => (
      <>
        <circle cx="50" cy="50" r="42" fill={color} />
        <path d="M20 18Q44 50 20 82M80 18Q56 50 80 82" fill="none" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: "sport-volleyball",
    category: "sport",
    label: "Volleyball",
    defaultColor: "#F8FAFC",
    render: (color) => (
      <>
        <circle cx="50" cy="50" r="42" fill={color} />
        <path
          d="M50 50Q50 24 30 12M50 50Q74 60 90 44M50 50Q28 66 30 90M40 34Q58 18 76 18M64 60Q58 80 64 92M34 60Q14 58 8 46"
          fill="none"
          stroke={ANIMAL_INK}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="50" cy="50" r="42" fill="none" stroke={ANIMAL_INK} strokeWidth="2.5" />
      </>
    ),
  },
  {
    id: "sport-football",
    category: "sport",
    label: "American Football",
    defaultColor: "#8B4513",
    render: (color) => (
      <g transform="rotate(-35 50 50)">
        <ellipse cx="50" cy="50" rx="44" ry="26" fill={color} />
        <path d="M36 50H64M40 45V55M46 45V55M52 45V55M58 45V55M22 38V62M78 38V62" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />
      </g>
    ),
  },
  {
    id: "sport-golf-ball",
    category: "sport",
    label: "Golf Ball",
    defaultColor: "#F8FAFC",
    render: (color) => (
      <>
        <circle cx="50" cy="50" r="40" fill={color} stroke={SAIL_EDGE} strokeWidth="2" />
        {darkPatch(
          [
            [34, 30], [50, 26], [66, 30], [26, 46], [42, 42], [58, 42], [74, 46],
            [34, 58], [50, 56], [66, 58], [42, 72], [58, 72],
          ].map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3.2" />),
        )}
      </>
    ),
  },
  {
    id: "sport-bowling-ball",
    category: "sport",
    label: "Bowling Ball",
    defaultColor: "#1E3A8A",
    render: (color) => (
      <>
        <circle cx="50" cy="50" r="42" fill={color} />
        {lightPatch(<ellipse cx="30" cy="30" rx="9" ry="5" transform="rotate(-40 30 30)" />)}
        <circle cx="44" cy="30" r="5" fill={ANIMAL_INK} />
        <circle cx="60" cy="32" r="5" fill={ANIMAL_INK} />
        <circle cx="54" cy="48" r="5.5" fill={ANIMAL_INK} />
      </>
    ),
  },
  {
    id: "sport-beach-ball",
    category: "sport",
    label: "Beach Ball",
    defaultColor: "#EF4444",
    render: (color) => (
      <>
        <circle cx="50" cy="50" r="42" fill={color} />
        <path d="M50 8Q24 50 50 92Q76 50 50 8Z" fill="#FFFFFF" />
        <path d="M50 8Q38 50 50 92Q62 50 50 8Z" fill="#FACC15" />
        <circle cx="50" cy="50" r="42" fill="none" stroke="#000" strokeOpacity="0.15" strokeWidth="2" />
      </>
    ),
  },
  {
    id: "sport-tennis-racket",
    category: "sport",
    label: "Tennis Racket",
    defaultColor: "#3B82F6",
    render: (color) => (
      <>
        <path
          d="M38 12.3V59.7M50 7V65M62 12.3V59.7M30.8 20H69.2M27.2 32H72.8M27.9 44H72.1M33.4 56H66.6"
          stroke="#9CA3AF"
          strokeWidth="1.5"
        />
        <ellipse cx="50" cy="36" rx="26" ry="32" fill="none" stroke={color} strokeWidth="6" />
        <path d="M40 65 48 74M60 65 52 74" stroke={color} strokeWidth="5" strokeLinecap="round" />
        <rect x="45" y="72" width="10" height="24" rx="3" fill={ANIMAL_INK} />
      </>
    ),
  },
  {
    id: "sport-baseball-bat",
    category: "sport",
    label: "Baseball Bat",
    defaultColor: "#C58B4E",
    render: (color) => (
      <g transform="rotate(-45 50 50)">
        <path d="M8 50Q8 46 12 46L40 47Q70 44 90 43Q96 43 96 50Q96 57 90 57Q70 56 40 53L12 54Q8 54 8 50Z" fill={color} />
        <rect x="10" y="46" width="20" height="8" rx="2" fill={ANIMAL_INK} />
        <circle cx="7" cy="50" r="5" fill={ANIMAL_INK} />
      </g>
    ),
  },
  {
    id: "sport-ping-pong-paddle",
    category: "sport",
    label: "Ping Pong Paddle",
    defaultColor: "#EF4444",
    render: (color) => (
      <>
        <line x1="62" y1="60" x2="86" y2="84" stroke="#C58B4E" strokeWidth="12" strokeLinecap="round" />
        <circle cx="44" cy="42" r="30" fill={color} />
        <circle cx="84" cy="22" r="7" fill="#FFFFFF" stroke={SAIL_EDGE} strokeWidth="1.5" />
      </>
    ),
  },
  {
    id: "sport-shuttlecock",
    category: "sport",
    label: "Shuttlecock",
    defaultColor: "#F8FAFC",
    render: (color) => (
      <>
        <polygon points="28,8 72,8 58,62 42,62" fill={color} stroke={SAIL_EDGE} strokeWidth="2" strokeLinejoin="round" />
        <path d="M39 8 46 62M50 8V62M61 8 54 62M31 26H69M35 44H65" fill="none" stroke={SAIL_EDGE} strokeWidth="1.5" />
        <rect x="41" y="58" width="18" height="5" rx="1" fill={ANIMAL_INK} />
        <path d="M40 63H60V72A10 10 0 0 1 40 72Z" fill="#C58B4E" />
      </>
    ),
  },
  {
    id: "sport-bowling-pin",
    category: "sport",
    label: "Bowling Pin",
    defaultColor: "#F8FAFC",
    render: (color) => (
      <>
        <path
          d="M50 6C58 6 60 14 58 22C56 28 54 30 56 36C64 48 68 60 66 76C64 88 58 94 50 94C42 94 36 88 34 76C32 60 36 48 44 36C46 30 44 28 42 22C40 14 42 6 50 6Z"
          fill={color}
          stroke={SAIL_EDGE}
          strokeWidth="2"
        />
        <path d="M44 25H56M44 31H56" stroke="#EF4444" strokeWidth="3" />
      </>
    ),
  },
  {
    id: "sport-dumbbell",
    category: "sport",
    label: "Dumbbell",
    defaultColor: "#374151",
    render: (color) => (
      <>
        <rect x="20" y="46" width="60" height="8" rx="2" fill="#9CA3AF" />
        <rect x="6" y="36" width="10" height="28" rx="3" fill={color} />
        <rect x="14" y="28" width="12" height="44" rx="4" fill={color} />
        <rect x="74" y="28" width="12" height="44" rx="4" fill={color} />
        <rect x="84" y="36" width="10" height="28" rx="3" fill={color} />
      </>
    ),
  },
  {
    id: "sport-whistle",
    category: "sport",
    label: "Whistle",
    defaultColor: "#EF4444",
    render: (color) => (
      <>
        <circle cx="18" cy="38" r="8" fill="none" stroke={ANIMAL_INK} strokeWidth="3" />
        <rect x="40" y="34" width="52" height="18" rx="4" fill={color} />
        <circle cx="42" cy="60" r="26" fill={color} />
        {darkPatch(<circle cx="42" cy="60" r="9" />)}
      </>
    ),
  },
  {
    id: "sport-trophy",
    category: "sport",
    label: "Trophy",
    defaultColor: "#FACC15",
    render: (color) => (
      <>
        <path d="M28 18H16V26C16 36 24 40 30 40M72 18H84V26C84 36 76 40 70 40" fill="none" stroke={color} strokeWidth="5" />
        <path d="M28 10H72V30C72 46 62 56 50 56C38 56 28 46 28 30Z" fill={color} />
        {lightPatch(<rect x="35" y="16" width="6" height="26" rx="3" />)}
        <rect x="46" y="55" width="8" height="15" fill={color} />
        <rect x="34" y="70" width="32" height="8" rx="2" fill={color} />
        <rect x="28" y="78" width="44" height="14" rx="2" fill={STEM_BROWN} />
      </>
    ),
  },
  {
    id: "sport-medal",
    category: "sport",
    label: "Medal",
    defaultColor: "#FACC15",
    render: (color) => (
      <>
        <polygon points="28,4 44,4 58,42 42,42" fill="#3B82F6" />
        <polygon points="72,4 56,4 42,42 58,42" fill="#EF4444" />
        <circle cx="50" cy="64" r="26" fill={color} />
        <circle cx="50" cy="64" r="19" fill="none" stroke="#000" strokeOpacity="0.15" strokeWidth="3" />
        {lightPatch(<polygon points={starPoints(50, 64, 11, 4.5)} />)}
      </>
    ),
  },

  // Trees — the leaves use `color`; trunks, fruit, and flowers keep fixed colors.
  {
    id: "tree-round",
    category: "tree",
    label: "Round Tree",
    defaultColor: "#22C55E",
    render: (color) => renderRoundTree(color),
  },
  {
    id: "tree-apple",
    category: "tree",
    label: "Apple Tree",
    defaultColor: "#16A34A",
    render: (color) =>
      renderRoundTree(
        color,
        [[36, 36], [60, 28], [26, 54], [52, 50], [72, 54], [64, 40]].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="4" fill="#EF4444" />
        )),
      ),
  },
  {
    id: "tree-autumn",
    category: "tree",
    label: "Autumn Tree",
    defaultColor: "#F97316",
    render: (color) =>
      renderRoundTree(
        color,
        [[22, 84, 30], [74, 88, -20], [84, 76, 50]].map(([cx, cy, turn]) => (
          <ellipse key={cx} cx={cx} cy={cy} rx="5" ry="2.5" transform={`rotate(${turn} ${cx} ${cy})`} fill={color} />
        )),
      ),
  },
  {
    id: "tree-cherry-blossom",
    category: "tree",
    label: "Cherry Blossom",
    defaultColor: "#F9A8D4",
    render: (color) =>
      renderRoundTree(
        color,
        [[36, 36], [58, 24], [24, 50], [48, 48], [70, 50], [64, 38], [40, 60], [60, 62]].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3" fill="#FFFFFF" />
        )),
      ),
  },
  {
    id: "tree-pine",
    category: "tree",
    label: "Pine Tree",
    defaultColor: "#15803D",
    render: (color) => (
      <>
        <rect x="45" y="78" width="10" height="16" fill={STEM_BROWN} />
        <g fill={color}>
          <polygon points="50,40 88,80 12,80" />
          <polygon points="50,20 80,56 20,56" />
          <polygon points="50,4 72,34 28,34" />
        </g>
      </>
    ),
  },
  {
    id: "tree-christmas",
    category: "tree",
    label: "Christmas Tree",
    defaultColor: "#16A34A",
    render: (color) => (
      <>
        <rect x="45" y="80" width="10" height="14" fill={STEM_BROWN} />
        <g fill={color}>
          <polygon points="50,44 88,82 12,82" />
          <polygon points="50,26 78,60 22,60" />
          <polygon points="50,12 70,38 30,38" />
        </g>
        {[
          [44, 32, "#EF4444"], [58, 50, "#3B82F6"], [38, 54, "#FACC15"],
          [30, 74, "#3B82F6"], [52, 70, "#EF4444"], [70, 76, "#FACC15"],
        ].map(([cx, cy, fill]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3.5" fill={fill as string} />
        ))}
        <polygon points={starPoints(50, 10, 9, 4)} fill="#FACC15" />
      </>
    ),
  },
  {
    id: "tree-cypress",
    category: "tree",
    label: "Cypress Tree",
    defaultColor: "#166534",
    render: (color) => (
      <>
        <rect x="46" y="78" width="8" height="16" fill={STEM_BROWN} />
        <path d="M50 4C64 24 66 56 60 80H40C34 56 36 24 50 4Z" fill={color} />
        <path d="M46 20C42 36 42 52 44 66" fill="none" stroke="#FFFFFF" strokeOpacity="0.4" strokeWidth="3" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: "tree-birch",
    category: "tree",
    label: "Birch Tree",
    defaultColor: "#4ADE80",
    render: (color) => (
      <>
        <rect x="45" y="50" width="10" height="44" fill="#F8FAFC" stroke={SAIL_EDGE} strokeWidth="1.5" />
        <path d="M45 62H50M50 72H55M45 82H49M51 88H55" stroke={ANIMAL_INK} strokeWidth="2.5" />
        <ellipse cx="50" cy="32" rx="26" ry="30" fill={color} />
        {lightPatch(<ellipse cx="42" cy="22" rx="7" ry="10" />)}
      </>
    ),
  },
  {
    id: "tree-willow",
    category: "tree",
    label: "Willow Tree",
    defaultColor: "#65A30D",
    render: (color) => (
      <>
        <rect x="45" y="46" width="10" height="48" fill={STEM_BROWN} />
        <path d="M14 60Q14 12 50 12Q86 12 86 60Z" fill={color} />
        <path d="M18 54V80M28 44V86M38 40V84M62 40V84M72 44V86M82 54V80" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: "tree-palm",
    category: "tree",
    label: "Palm Tree",
    defaultColor: "#22C55E",
    render: (color) => (
      <>
        <path d="M52 94Q46 60 54 30" fill="none" stroke="#A16207" strokeWidth="8" strokeLinecap="round" />
        <path d="M52 94Q46 60 54 30" fill="none" stroke="#000" strokeOpacity="0.2" strokeWidth="8" strokeDasharray="1.5 7" />
        <g fill={color}>
          <path d="M54 28Q30 10 8 30Q30 22 54 28Z" />
          <path d="M54 28Q78 10 96 30Q76 22 54 28Z" />
          <path d="M54 28Q36 34 22 60Q38 38 54 28Z" />
          <path d="M54 28Q74 34 86 60Q70 38 54 28Z" />
          <path d="M54 28Q52 10 64 4Q58 16 54 28Z" />
        </g>
        <circle cx="50" cy="33" r="4" fill={STEM_BROWN} />
        <circle cx="58" cy="33" r="4" fill={STEM_BROWN} />
      </>
    ),
  },
  {
    id: "tree-bare",
    category: "tree",
    label: "Bare Tree",
    defaultColor: "#5D4037",
    // A winter tree with no leaves, so here the trunk and branches use `color`.
    render: (color) => (
      <g fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round">
        <path d="M50 94V50" strokeWidth="9" />
        <path d="M50 72 30 50M50 60 70 38M50 50 48 18" strokeWidth="5" />
        <path d="M30 50 20 30M30 50 38 32M70 38 82 22M70 38 62 20M48 32 36 16M48 28 60 12" strokeWidth="3" />
      </g>
    ),
  },
  {
    id: "tree-bush",
    category: "tree",
    label: "Bush",
    defaultColor: "#22C55E",
    render: (color) => (
      <>
        <g fill={color}>
          <circle cx="30" cy="66" r="20" />
          <circle cx="70" cy="66" r="20" />
          <circle cx="50" cy="56" r="26" />
          <rect x="10" y="66" width="80" height="20" rx="10" />
        </g>
        {lightPatch(<circle cx="42" cy="46" r="7" />)}
      </>
    ),
  },
  {
    id: "tree-cactus",
    category: "tree",
    label: "Cactus",
    defaultColor: "#16A34A",
    render: (color) => (
      <>
        <path d="M40 56H28Q22 56 22 50V36M60 46H72Q78 46 78 40V28" fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" />
        <rect x="40" y="12" width="20" height="76" rx="10" fill={color} />
        <path d="M50 20V80" stroke="#000" strokeOpacity="0.15" strokeWidth="2" />
        <polygon points="30,84 70,84 66,96 34,96" fill="#C2410C" />
      </>
    ),
  },
  {
    id: "tree-stump",
    category: "tree",
    label: "Tree Stump",
    defaultColor: "#A16207",
    render: (color) => (
      <>
        <polygon points="20,90 30,78 34,90" fill={color} />
        <polygon points="80,90 70,78 66,90" fill={color} />
        <path d="M26 50V86Q26 92 50 92Q74 92 74 86V50Z" fill={color} />
        {darkPatch(<path d="M26 50V86Q26 92 50 92Q74 92 74 86V50Z" />)}
        <ellipse cx="50" cy="50" rx="24" ry="8" fill={color} />
        {lightPatch(<ellipse cx="50" cy="50" rx="24" ry="8" />)}
        <g fill="none" stroke="#000" strokeOpacity="0.2" strokeWidth="1.5">
          <ellipse cx="50" cy="50" rx="16" ry="5" />
          <ellipse cx="50" cy="50" rx="8" ry="2.5" />
        </g>
      </>
    ),
  },

  {
    id: "tree-oak",
    category: "tree",
    label: "Oak Tree",
    defaultColor: "#15803D",
    // Each acorn = a light-brown nut with a dark-brown cap on top.
    render: (color) =>
      renderRoundTree(
        color,
        [[34, 40], [60, 28], [66, 54], [42, 58]].map(([cx, cy]) => (
          <g key={`${cx}-${cy}`}>
            <ellipse cx={cx} cy={cy + 3} rx="3.5" ry="4.5" fill="#C58B4E" />
            <path d={`M${cx - 4.5} ${cy + 1}a4.5 3.5 0 0 1 9 0Z`} fill={STEM_BROWN} />
          </g>
        )),
      ),
  },
  {
    id: "tree-mango",
    category: "tree",
    label: "Mango Tree",
    defaultColor: "#16A34A",
    render: (color) =>
      renderRoundTree(
        color,
        [[34, 42, 15], [58, 32, -10], [70, 56, 10], [46, 60, -15], [26, 60, 20]].map(([cx, cy, turn]) => (
          <ellipse
            key={`${cx}-${cy}`}
            cx={cx}
            cy={cy}
            rx="4"
            ry="6"
            transform={`rotate(${turn} ${cx} ${cy})`}
            fill="#F59E0B"
          />
        )),
      ),
  },
  {
    id: "tree-bamboo",
    category: "tree",
    label: "Bamboo",
    defaultColor: "#84CC16",
    // Three stalks with darker rings (nodes) along them, and small leaves off the side.
    render: (color) => (
      <>
        {[
          { x: 22, top: 14 },
          { x: 46, top: 4 },
          { x: 70, top: 20 },
        ].map(({ x, top }) => (
          <g key={x}>
            <rect x={x} y={top} width="8" height={94 - top} rx="3" fill={color} />
            {darkPatch(
              [30, 46, 62, 78]
                .filter((y) => y > top + 6)
                .map((y) => <rect key={y} x={x} y={y - 1.5} width="8" height="3" />),
            )}
          </g>
        ))}
        <g fill={color}>
          {[
            [30, 30, -30],
            [22, 46, 210],
            [54, 20, -25],
            [46, 40, 205],
            [78, 36, -30],
            [70, 52, 210],
          ].map(([x, y, turn]) => (
            <path key={`${x}-${y}`} d={LEAFLET_PATH} transform={`translate(${x} ${y}) rotate(${turn}) scale(1.3)`} />
          ))}
        </g>
      </>
    ),
  },
  {
    id: "tree-flower",
    category: "tree",
    label: "Flower",
    defaultColor: "#EC4899",
    render: (color) => (
      <>
        <path d="M50 94V50" fill="none" stroke={LEAF_GREEN} strokeWidth="4" strokeLinecap="round" />
        <path d="M50 78Q64 64 78 70Q66 84 50 78Z" fill={LEAF_GREEN} />
        <path d="M50 70Q36 56 22 62Q34 76 50 70Z" fill={LEAF_GREEN} />
        {[0, 60, 120, 180, 240, 300].map((turn) => (
          <ellipse key={turn} cx="50" cy="18" rx="9" ry="14" fill={color} transform={`rotate(${turn} 50 34)`} />
        ))}
        <circle cx="50" cy="34" r="9" fill="#FACC15" />
      </>
    ),
  },
  {
    id: "tree-mushroom",
    category: "tree",
    label: "Mushroom",
    defaultColor: "#EF4444",
    render: (color) => (
      <>
        <path d="M40 54Q38 80 34 92H66Q62 80 60 54Z" fill="#F5F0E6" stroke={SAIL_EDGE} strokeWidth="1.5" />
        <path d="M8 58Q8 14 50 14Q92 14 92 58Z" fill={color} />
        {[[28, 40, 6], [52, 28, 7], [72, 44, 5], [46, 48, 4]].map(([cx, cy, r]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="#FFFFFF" />
        ))}
      </>
    ),
  },

  // Leaves — the leaf uses `color`; veins are see-through dark lines so they show on any color.
  {
    id: "leaf-simple",
    category: "leaf",
    label: "Leaf",
    defaultColor: "#22C55E",
    render: (color) => (
      <g transform="rotate(30 50 50)">
        <line x1="50" y1="84" x2="50" y2="96" stroke={color} strokeWidth="3" strokeLinecap="round" />
        <path d="M50 6Q88 34 50 86Q12 34 50 6Z" fill={color} />
        {renderVeins("M50 14V84M50 36 62 26M50 36 38 26M50 52 66 40M50 52 34 40M50 68 62 58M50 68 38 58")}
      </g>
    ),
  },
  {
    id: "leaf-maple",
    category: "leaf",
    label: "Maple Leaf",
    defaultColor: "#DC2626",
    render: (color) => (
      <>
        <line x1="50" y1="76" x2="50" y2="96" stroke={color} strokeWidth="3" strokeLinecap="round" />
        <polygon
          points="50,6 56,24 66,18 64,36 80,28 76,40 92,42 78,54 84,62 64,62 66,74 54,68 50,80 46,68 34,74 36,62 16,62 22,54 8,42 24,40 20,28 36,36 34,18 44,24"
          fill={color}
          strokeLinejoin="round"
        />
        {renderVeins("M50 76V14M50 66 82 42M50 66 18 42M50 70 70 62M50 70 30 62")}
      </>
    ),
  },
  {
    id: "leaf-oak",
    category: "leaf",
    label: "Oak Leaf",
    defaultColor: "#65A30D",
    render: (color) => (
      <>
        <line x1="50" y1="84" x2="50" y2="96" stroke={color} strokeWidth="3" strokeLinecap="round" />
        <path
          d="M50 6Q60 8 58 18Q70 16 66 28Q78 30 70 42Q82 46 72 56Q80 66 66 70Q68 82 54 80L52 88H48L46 80Q32 82 34 70Q20 66 28 56Q18 46 30 42Q22 30 34 28Q30 16 42 18Q40 8 50 6Z"
          fill={color}
        />
        {renderVeins("M50 12V86M50 24 60 20M50 24 40 20M50 36 64 32M50 36 36 32M50 50 68 48M50 50 32 48M50 64 64 66M50 64 36 66")}
      </>
    ),
  },
  {
    id: "leaf-heart",
    category: "leaf",
    label: "Heart Leaf",
    defaultColor: "#22C55E",
    render: (color) => (
      <>
        <line x1="50" y1="68" x2="50" y2="96" stroke={color} strokeWidth="3" strokeLinecap="round" />
        <path d="M50 8Q86 38 86 60Q86 82 66 82Q54 82 50 70Q46 82 34 82Q14 82 14 60Q14 38 50 8Z" fill={color} />
        {renderVeins("M50 70V16M50 56 70 44M50 56 30 44M50 40 64 30M50 40 36 30")}
      </>
    ),
  },
  {
    id: "leaf-round",
    category: "leaf",
    label: "Round Leaf",
    defaultColor: "#4ADE80",
    render: (color) => (
      <>
        <line x1="50" y1="88" x2="50" y2="97" stroke={color} strokeWidth="3" strokeLinecap="round" />
        <path d="M50 6Q82 18 82 52Q82 84 50 90Q18 84 18 52Q18 18 50 6Z" fill={color} />
        {renderVeins("M50 12V88M50 40 70 30M50 40 30 30M50 58 74 50M50 58 26 50M50 74 68 70M50 74 32 70")}
      </>
    ),
  },
  {
    id: "leaf-ginkgo",
    category: "leaf",
    label: "Ginkgo Leaf",
    defaultColor: "#EAB308",
    render: (color) => (
      <>
        <path d="M50 58Q50 80 54 94" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
        <path d="M50 60L10 28Q22 8 46 10L50 24L54 10Q78 8 90 28Z" fill={color} strokeLinejoin="round" />
        {renderVeins("M50 58 22 22M50 58 36 14M50 58 64 14M50 58 78 22")}
      </>
    ),
  },
  {
    id: "leaf-willow",
    category: "leaf",
    label: "Willow Leaf",
    defaultColor: "#84CC16",
    render: (color) => (
      <g transform="rotate(40 50 50)">
        <path d="M50 2Q64 50 50 98Q36 50 50 2Z" fill={color} />
        {renderVeins("M50 8V92")}
      </g>
    ),
  },
  {
    id: "leaf-fern",
    category: "leaf",
    label: "Fern",
    defaultColor: "#15803D",
    render: (color) =>
      renderLeafletsAlong(
        color,
        [[30, 94], [40, 50], [74, 8]],
        [0.12, 0.22, 0.32, 0.42, 0.52, 0.62, 0.72, 0.82, 0.9],
        (t) => 1.4 * (1 - t) + 0.5,
      ),
  },
  {
    id: "leaf-branch",
    category: "leaf",
    label: "Leafy Branch",
    defaultColor: "#22C55E",
    render: (color) => (
      <>
        {renderLeafletsAlong(color, [[8, 92], [46, 64], [88, 14]], [0.25, 0.5, 0.75], () => 1.5)}
        {/* Drawn last so the brown branch covers the helper's green stem. */}
        <path d="M8 92Q46 64 88 14" fill="none" stroke={STEM_BROWN} strokeWidth="4" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: "leaf-clover",
    category: "leaf",
    label: "Clover",
    defaultColor: "#16A34A",
    render: (color) => renderCloverLeaflets(color, [0, 120, 240]),
  },
  {
    id: "leaf-four-leaf-clover",
    category: "leaf",
    label: "Four-Leaf Clover",
    defaultColor: "#16A34A",
    render: (color) => renderCloverLeaflets(color, [45, 135, 225, 315]),
  },
  {
    id: "leaf-holly",
    category: "leaf",
    label: "Holly",
    defaultColor: "#15803D",
    // Two spiky leaves (one drawing, the second flipped) with red berries where they meet.
    render: (color) => (
      <>
        {["rotate(-20 50 50)", "translate(100 0) scale(-1 1) rotate(-20 50 50)"].map((transform) => (
          <g key={transform} transform={transform}>
            <polygon points="50,50 42,40 36,44 28,34 22,40 12,34 6,48 12,58 22,56 28,66 36,58 42,62" fill={color} strokeLinejoin="round" />
            {renderVeins("M50 50H10")}
          </g>
        ))}
        {[[50, 54], [43, 61], [57, 61]].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="6" fill="#DC2626" />
        ))}
      </>
    ),
  },
  {
    id: "leaf-sprout",
    category: "leaf",
    label: "Sprout",
    defaultColor: "#22C55E",
    render: (color) => (
      <>
        <path d="M50 92V48" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" />
        <path d="M50 58Q20 62 16 36Q44 32 50 58Z" fill={color} />
        <path d="M50 50Q80 52 86 26Q56 20 50 50Z" fill={color} />
        {renderVeins("M50 58 26 40M50 50 76 30")}
        <path d="M20 94Q50 78 80 94Z" fill={STEM_BROWN} />
      </>
    ),
  },

  // Numbers
  ...["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => ({
    id: `number-${digit}`,
    category: "number" as const,
    label: digit,
    render: (color: string) => renderGlyph(digit, color),
  })),

  // Alphabet
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => ({
    id: `letter-${letter}`,
    category: "letter" as const,
    label: letter,
    render: (color: string) => renderGlyph(letter, color),
  })),

  // Symbols
  ...[
    { char: "!", label: "Exclamation" },
    { char: "?", label: "Question" },
    { char: "+", label: "Plus" },
    { char: "−", label: "Minus" },
    { char: "×", label: "Multiply" },
    { char: "÷", label: "Divide" },
    { char: "%", label: "Percent" },
    { char: "&", label: "Ampersand" },
    { char: "@", label: "At" },
    { char: "#", label: "Hash" },
    { char: "*", label: "Asterisk" },
    { char: "=", label: "Equals" },
  ].map(({ char, label }) => ({
    id: `symbol-${label.toLowerCase()}`,
    category: "symbol" as const,
    label,
    render: (color: string) => renderGlyph(char, color),
  })),

  // Emoji — color emoji fonts render their own built-in colors regardless of the SVG fill, so
  // these ignore the selected element color and always show up colorful, same as renderGlyph
  // already does for numbers/letters/symbols.
  ...[
    { char: "🙂", label: "Smiling face" },
    { char: "😊", label: "Blushing smile" },
    { char: "😀", label: "Grinning face" },
    { char: "😃", label: "Big grin" },
    { char: "😂", label: "Laughing face" },
    { char: "😍", label: "Heart eyes" },
    { char: "😎", label: "Sunglasses face" },
    { char: "🤔", label: "Thinking face" },
    { char: "😢", label: "Crying face" },
    { char: "😮", label: "Surprised face" },
    { char: "🙌", label: "Raised hands" },
    { char: "👍", label: "Thumbs up" },
    { char: "👎", label: "Thumbs down" },
    { char: "👏", label: "Clapping hands" },
    { char: "🎉", label: "Party popper" },
    { char: "🔥", label: "Fire" },
    { char: "⭐", label: "Star emoji" },
    { char: "❤️", label: "Heart emoji" },
    { char: "💡", label: "Light bulb" },
    { char: "✅", label: "Check mark" },
    { char: "❌", label: "Cross mark" },
    { char: "🚀", label: "Rocket" },
    { char: "💯", label: "Hundred points" },
  ].map(({ char, label }) => ({
    id: `emoji-${label.toLowerCase().replace(/\s+/g, "-")}`,
    category: "emoji" as const,
    label,
    render: (color: string) => renderGlyph(char, color),
  })),

  // Backgrounds — the card uses `color`; the rainbow pattern on top keeps its own colors.
  ...[
    {
      id: "background-dots",
      label: "Polka Dots",
      defaultColor: "#FEF3C7",
      pattern: Array.from({ length: 5 }, (_, row) =>
        Array.from({ length: row % 2 ? 7 : 8 }, (_, col) => (
          <circle key={`${row}-${col}`} cx={10 + col * 20 + (row % 2) * 10} cy={10 + row * 20} r="5" fill={patternColor(col + row)} />
        )),
      ),
    },
    {
      id: "background-stripes",
      label: "Rainbow Stripes",
      defaultColor: "#FFFFFF",
      pattern: Array.from({ length: 7 }, (_, i) => (
        <rect key={i} x="8" y={8 + i * 12} width="144" height="9" rx="4.5" fill={patternColor(i)} />
      )),
    },
    {
      id: "background-zigzag",
      label: "Zigzag",
      defaultColor: "#ECFEFF",
      pattern: Array.from({ length: 5 }, (_, row) => (
        <polyline
          key={row}
          points={Array.from({ length: 15 }, (_, i) => `${10 + i * 10},${18 + row * 16 + (i % 2 ? -5 : 5)}`).join(" ")}
          fill="none"
          stroke={patternColor(row * 2)}
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )),
    },
    {
      id: "background-waves",
      label: "Waves",
      defaultColor: "#EFF6FF",
      pattern: Array.from({ length: 6 }, (_, row) => (
        <path
          key={row}
          d={`M8 ${16 + row * 14}q10 -7 20 0${" t20 0".repeat(6)}`}
          fill="none"
          stroke={patternColor(row + 3)}
          strokeWidth="4"
          strokeLinecap="round"
        />
      )),
    },
    {
      id: "background-checkers",
      label: "Checkerboard",
      defaultColor: "#FFFFFF",
      pattern: Array.from({ length: 7 }, (_, row) =>
        Array.from({ length: 12 }, (_, col) =>
          (row + col) % 2 === 0 ? (
            <rect key={`${row}-${col}`} x={8 + col * 12} y={8 + row * 12} width="12" height="12" fill={patternColor((col - row + 14) / 2)} />
          ) : null,
        ),
      ),
    },
    {
      id: "background-triangles",
      label: "Triangles",
      defaultColor: "#FDF4FF",
      pattern: Array.from({ length: 6 }, (_, row) =>
        Array.from({ length: 9 }, (_, col) => {
          const x = 8 + col * 16;
          const y = 8 + row * 14;
          return <polygon key={`${row}-${col}`} points={`${x},${y + 14} ${x + 8},${y} ${x + 16},${y + 14}`} fill={patternColor(col + row * 3)} />;
        }),
      ),
    },
    {
      id: "background-stars",
      label: "Stars",
      defaultColor: "#1E1B4B",
      pattern: Array.from({ length: 5 }, (_, row) =>
        Array.from({ length: row % 2 ? 7 : 8 }, (_, col) => (
          <polygon key={`${row}-${col}`} points={starPoints(10 + col * 20 + (row % 2) * 10, 10 + row * 20, 6.5, 3)} fill={patternColor(col + row * 2)} />
        )),
      ),
    },
    {
      id: "background-confetti",
      label: "Confetti",
      defaultColor: "#FFFFFF",
      pattern: Array.from({ length: 5 }, (_, row) =>
        Array.from({ length: 8 }, (_, col) => {
          // Small made-up offsets so the pieces look scattered, not lined up.
          const x = 10 + col * 20 + ((col * 7 + row * 13) % 7) - 3;
          const y = 10 + row * 20 + ((col * 5 + row * 11) % 7) - 3;
          const fill = patternColor(col * 3 + row * 5);
          const key = `${row}-${col}`;
          const shape = (col + row * 2) % 3;
          if (shape === 0) return <circle key={key} cx={x} cy={y} r="3.5" fill={fill} />;
          if (shape === 1) return <rect key={key} x={x - 4} y={y - 2} width="8" height="4" rx="1" fill={fill} transform={`rotate(${(col * 40 + row * 25) % 180} ${x} ${y})`} />;
          return <polygon key={key} points={`${x},${y - 4} ${x + 4},${y + 3} ${x - 4},${y + 3}`} fill={fill} />;
        }),
      ),
    },
    {
      id: "background-hearts",
      label: "Hearts",
      defaultColor: "#FFF1F2",
      pattern: staggeredGrid((x, y, i) => (
        <path d={SMALL_HEART_PATH} transform={`translate(${x - 6.5} ${y - 6.5}) scale(0.65)`} fill={patternColor(i + 7)} />
      )),
    },
    {
      id: "background-flowers",
      label: "Flowers",
      defaultColor: "#F0FDF4",
      pattern: staggeredGrid((x, y, i) => (
        <>
          {Array.from({ length: 5 }, (_, petal) => {
            const angle = (petal * 72 - 90) * (Math.PI / 180);
            return <circle key={petal} cx={x + 3.2 * Math.cos(angle)} cy={y + 3.2 * Math.sin(angle)} r="2.6" fill={patternColor(i)} />;
          })}
          <circle cx={x} cy={y} r="1.8" fill="#FFFFFF" />
        </>
      )),
    },
    {
      id: "background-math",
      label: "Math Symbols",
      defaultColor: "#EFF6FF",
      pattern: Array.from({ length: 5 }, (_, row) =>
        Array.from({ length: 8 }, (_, col) => (
          <g key={`${row}-${col}`}>{renderMathSign((col + row * 3) % 5, 10 + col * 20, 10 + row * 20, patternColor(col + row))}</g>
        )),
      ),
    },
    {
      id: "background-bubbles",
      label: "Bubbles",
      defaultColor: "#ECFEFF",
      pattern: Array.from({ length: 5 }, (_, row) =>
        Array.from({ length: 8 }, (_, col) => {
          // Small made-up offsets and sizes so the bubbles look like they're floating, not lined up.
          const r = 2.5 + ((col * 7 + row * 3) % 4);
          const x = 10 + col * 20 + ((col * 5 + row * 7) % 5) - 2;
          const y = 10 + row * 20 + ((col * 3 + row * 11) % 5) - 2;
          return (
            <g key={`${row}-${col}`}>
              <circle cx={x} cy={y} r={r} fill="none" stroke={patternColor(col * 2 + row)} strokeWidth="1.8" />
              <circle cx={x - r * 0.4} cy={y - r * 0.4} r={r * 0.22} fill={patternColor(col * 2 + row)} />
            </g>
          );
        }),
      ),
    },
    {
      id: "background-rainbows",
      label: "Rainbows",
      defaultColor: "#FFFBEB",
      pattern: staggeredGrid((x, y) =>
        [6, 4.2, 2.4].map((r, band) => (
          <path
            key={band}
            d={`M${x - r} ${y + 3}A${r} ${r} 0 0 1 ${x + r} ${y + 3}`}
            fill="none"
            stroke={["#EF4444", "#FACC15", "#3B82F6"][band]}
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        )),
      ),
    },
    {
      id: "background-diamonds",
      label: "Diamonds",
      defaultColor: "#FAF5FF",
      pattern: staggeredGrid((x, y, i) => (
        <polygon points={`${x},${y - 6.5} ${x + 5},${y} ${x},${y + 6.5} ${x - 5},${y}`} fill={patternColor(i + 3)} />
      )),
    },
    {
      id: "background-moons",
      label: "Moons & Stars",
      defaultColor: "#312E81",
      pattern: staggeredGrid((x, y, i) =>
        i % 2 ? (
          <polygon points={starPoints(x, y, 5, 2.2)} fill={patternColor(i)} />
        ) : (
          // A crescent: a half circle on the left with a shallower curve cut out of it.
          <path d={`M${x + 1.5} ${y - 5.5}A5.5 5.5 0 1 0 ${x + 1.5} ${y + 5.5}A7 7 0 0 1 ${x + 1.5} ${y - 5.5}Z`} fill="#FACC15" />
        ),
      ),
    },
    {
      id: "background-sprinkles",
      label: "Sprinkles",
      defaultColor: "#FFF7ED",
      pattern: Array.from({ length: 6 }, (_, row) =>
        Array.from({ length: 10 }, (_, col) => {
          const x = 8 + col * 16;
          const y = 10 + row * 16;
          return (
            <rect
              key={`${row}-${col}`}
              x={x - 3.5}
              y={y - 1.3}
              width="7"
              height="2.6"
              rx="1.3"
              fill={patternColor(col * 3 + row * 5)}
              transform={`rotate(${(col * 47 + row * 71) % 180} ${x} ${y})`}
            />
          );
        }),
      ),
    },
  ].map(({ id, label, defaultColor, pattern }) => ({
    id,
    category: "background" as const,
    label,
    defaultColor,
    viewBox: "0 0 160 100",
    defaultSize: { width: 320, height: 200 },
    render: (color: string) => renderPatternCard(color, pattern),
  })),

  {
    id: "text-box",
    category: "text",
    label: "Text box",
    defaultColor: DEFAULT_TEXT_COLOR,
    isTextBox: true,
    defaultSize: { width: 240, height: 64 },
    render: (color) => (
      <path d="M22 26V18H78V26M50 18V84M38 84H62" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
];

// Shapes already have hand-picked colors; everything else gets a random-looking bright one.
export const ELEMENT_LIBRARY: ElementAsset[] = ASSETS.map((asset) =>
  asset.defaultColor || asset.category === "shape" ? asset : { ...asset, defaultColor: pickFunColor(asset.id) },
);

// The asset's drawing area for this element's settings.
export function getAssetViewBox(asset: ElementAsset, settings: RenderSettings) {
  return typeof asset.viewBox === "function" ? asset.viewBox(settings) : (asset.viewBox ?? "0 0 100 100");
}

// Looked up on every render of every element, so use a map instead of scanning the whole list.
const ASSETS_BY_ID = new Map(ELEMENT_LIBRARY.map((asset) => [asset.id, asset]));

export function getElementAsset(assetId: string): ElementAsset | undefined {
  return ASSETS_BY_ID.get(assetId);
}

export const ELEMENT_CATEGORY_LABELS: Record<ElementCategory, string> = {
  shape: "Shapes",
  line: "Lines",
  arrow: "Arrows",
  solid: "3D Solids",
  icon: "Icons",
  time: "Time & Date",
  math: "Math Tools",
  decorative: "Decorative",
  cloud: "Clouds",
  number: "Numbers",
  letter: "Alphabet",
  symbol: "Symbols",
  emoji: "Emoji",
  music: "Music",
  fruit: "Fruits",
  kitchen: "Kitchen",
  vehicle: "Vehicles",
  animal: "Animals",
  space: "Solar System",
  sport: "Sports",
  tree: "Trees",
  leaf: "Leaves",
  background: "Backgrounds",
  text: "Text",
};

export const DEFAULT_ELEMENT_COLOR = "#191A2C";
export const DEFAULT_ELEMENT_SIZE = 140;

// assetId of a custom drawing (e.g. one Claude drew) — not in the library; the element's `svg` holds it.
export const CUSTOM_SVG_ID = "custom-svg";

/**
 * SVG markup as a data: URL, for an <img> or a CSS background. Browsers show SVG images in a locked-down
 * mode — no scripts, nothing loaded from outside — so markup from anywhere is safe to show this way.
 */
export function svgDataUrl(markup: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}
