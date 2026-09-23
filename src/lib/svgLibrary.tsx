import type { ReactNode } from "react";
import { renderSolid, SOLIDS } from "./solids";
import type { SvgElement } from "./schema";

export type ElementCategory = "shape" | "solid" | "icon" | "time" | "math" | "decorative" | "cloud" | "number" | "letter" | "symbol" | "emoji" | "music" | "fruit";

// The per-element settings some assets draw from (3D angle, clock time, number line numbers).
// A whole SvgElement fits here, so callers can just pass the element.
export type RenderSettings = Pick<
  SvgElement,
  "rotation3d" | "clockTime" | "numberLine" | "fraction" | "tenFrame" | "baseTen" | "thermometer" | "barGraph" | "protractor"
>;

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

// Written fraction: `shaded` is the numerator (top), `parts` the denominator (bottom).
export const DEFAULT_FRACTION_NUMBER: FractionSettings = { parts: 2, shaded: 1 };

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

// Natural colors for the parts of a fruit that don't change with the element color.
const LEAF_GREEN = "#22C55E";
const STEM_BROWN = "#6D4C41";

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

// Every asset shares a 0–100 viewBox so element width/height map to it uniformly.
const ASSETS: ElementAsset[] = [
  // Shapes
  {
    id: "rectangle",
    category: "shape",
    label: "Rectangle",
    defaultColor: "#3B82F6",
    render: (color) => <rect x="8" y="18" width="84" height="64" rx="8" fill={color} />,
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
];

// Shapes already have hand-picked colors; everything else gets a random-looking bright one.
export const ELEMENT_LIBRARY: ElementAsset[] = ASSETS.map((asset) =>
  asset.defaultColor || asset.category === "shape" ? asset : { ...asset, defaultColor: pickFunColor(asset.id) },
);

// The asset's drawing area for this element's settings.
export function getAssetViewBox(asset: ElementAsset, settings: RenderSettings) {
  return typeof asset.viewBox === "function" ? asset.viewBox(settings) : (asset.viewBox ?? "0 0 100 100");
}

export function getElementAsset(assetId: string): ElementAsset | undefined {
  return ELEMENT_LIBRARY.find((asset) => asset.id === assetId);
}

export const ELEMENT_CATEGORY_LABELS: Record<ElementCategory, string> = {
  shape: "Shapes",
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
};

export const DEFAULT_ELEMENT_COLOR = "#191A2C";
export const DEFAULT_ELEMENT_SIZE = 140;
