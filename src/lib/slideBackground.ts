// A slide's background: a soft color or gradient, plus an optional pattern from the library drawn as a frame
// around the edges. Used by the Background panel and by the presentation importer, so both look the same.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ELEMENT_LIBRARY, getElementAsset } from "./svgLibrary";
import { GRADIENT_PREFIX } from "./constants";
import type { Slide } from "./schema";

export const BACKGROUND_PATTERN_IDS = ELEMENT_LIBRARY.filter((asset) => asset.category === "background").map(
  (asset) => asset.id,
) as [string, ...string[]];

// Soft colors the Background panel offers. All light, so the dark text stays easy to read.
export const BACKGROUND_COLORS = [
  "#FEF3C7",
  "#FFEDD5",
  "#FFE4E6",
  "#FCE7F3",
  "#EDE9FE",
  "#E0E7FF",
  "#E0F2FE",
  "#CCFBF1",
  "#DCFCE7",
  "#F5F5F4",
];

// Two-color gradients the Background panel offers (soft ones first, then stronger light ones), drawn from the top
// of the slide to the bottom. Stored like any gradient color ("gradient:#from,#to"). All light, so the dark text
// stays easy to read.
export const BACKGROUND_GRADIENTS = [
  ["#FEF9C3", "#DCFCE7"],
  ["#FEF3C7", "#FFE4E6"],
  ["#FFEDD5", "#FCE7F3"],
  ["#EDE9FE", "#E0F2FE"],
  ["#E0E7FF", "#FCE7F3"],
  ["#CCFBF1", "#E0E7FF"],
  ["#E0F2FE", "#DCFCE7"],
  ["#F5F5F4", "#EDE9FE"],
  ["#FFE4E6", "#EDE9FE"],
  ["#FEF3C7", "#E0F2FE"],
  ["#DCFCE7", "#CCFBF1"],
  ["#FCE7F3", "#E0F2FE"],
  ["#FFEDD5", "#FEF9C3"],
  ["#EDE9FE", "#FCE7F3"],
  ["#F5F5F4", "#E0F2FE"],
  ["#FDE68A", "#FCA5A5"],
  ["#C4B5FD", "#93C5FD"],
  ["#86EFAC", "#67E8F9"],
  ["#FDBA74", "#F9A8D4"],
  ["#F9A8D4", "#C4B5FD"],
  ["#A5B4FC", "#5EEAD4"],
  ["#FDE68A", "#86EFAC"],
  ["#7DD3FC", "#C4B5FD"],
  ["#FCA5A5", "#FDBA74"],
  ["#BEF264", "#FDE047"],
  ["#FEF08A", "#A5F3FC"],
  ["#FECDD3", "#BFDBFE"],
  ["#D9F99D", "#A7F3D0"],
  ["#FED7AA", "#DDD6FE"],
  ["#99F6E4", "#FEF08A"],
  ["#FBCFE8", "#FEF3C7"],
  ["#BAE6FD", "#FBCFE8"],
  ["#DDD6FE", "#A7F3D0"],
  ["#FECACA", "#FEF08A"],
  ["#C7D2FE", "#F5D0FE"],
].map(([from, to]) => `${GRADIENT_PREFIX}${from},${to}`);

// How solid a pattern is, in percent: faint by default so the text on top stays easy to read.
export const DEFAULT_PATTERN_OPACITY = 25;
export const PATTERN_OPACITY_RANGE = { min: 5, max: 100 };
// What a pattern sits on when the slide has no color of its own (the plain white surface).
const PLAIN_SLIDE_COLOR = "#FFFFFF";

/**
 * A library pattern as slide artwork (SVG markup). The pattern card is repeated 4×4, so its shapes are
 * small, and only shows as a soft 40px frame around the edges; a plain panel covers the middle so
 * text, pictures and cards stay clear. The cards take the slide's color, so their corners and seams
 * don't show. On a gradient slide, each row of cards gets its own copy of the gradient, moved so it
 * lines up with the part of the slide behind that row.
 */
export function patternSvg(patternId: string, color: string, opacity = DEFAULT_PATTERN_OPACITY): string {
  const asset = getElementAsset(patternId)!;
  const stops = color.startsWith(GRADIENT_PREFIX) ? color.slice(GRADIENT_PREFIX.length).split(",") : null;
  // A top-to-bottom gradient over the whole slide, in the coordinates of something drawn `top` units down.
  const gradient = (id: string, top: number) =>
    createElement(
      "linearGradient",
      { key: id, id, gradientUnits: "userSpaceOnUse", x1: 0, y1: -top, x2: 0, y2: 360 - top },
      createElement("stop", { offset: 0, stopColor: stops![0] }),
      createElement("stop", { offset: 1, stopColor: stops![1] }),
    );
  const rows = [0, 1, 2, 3];
  // The card is drawn once (once per row on a gradient) and repeated with <use>, which keeps the saved markup small.
  const tileId = (row: number) => (stops ? `tile${row}` : "tile");
  const defs = stops
    ? rows.flatMap((row) => [
        gradient(`bg${row}`, row * 100),
        createElement("g", { key: `tile${row}`, id: `tile${row}` }, asset.render(`url(#bg${row})`, {})),
      ])
    : [createElement("g", { key: "tile", id: "tile" }, asset.render(color, {}))];
  const tiles = rows.flatMap((row) =>
    [0, 1, 2, 3].map((col) => createElement("use", { key: `${row}-${col}`, href: `#${tileId(row)}`, x: col * 160, y: row * 100 })),
  );
  // 640×360 is exactly 16:9, and the cards' rows and columns sit every 20 units starting at 10, so
  // the outer row and column of shapes land whole inside the 20-unit (40px) frame.
  return renderToStaticMarkup(
    createElement(
      "svg",
      { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 640 360" },
      createElement("defs", null, ...defs, ...(stops ? [gradient("bg", 0)] : [])),
      createElement("g", { opacity: opacity / 100 }, tiles),
      createElement("rect", { x: 20, y: 20, width: 600, height: 320, rx: 8, fill: stops ? "url(#bg)" : color }),
    ),
  );
}

export type BackgroundPatch = Partial<Pick<Slide, "background" | "backgroundPattern" | "backgroundOpacity">>;

/**
 * The slide with a new background color, pattern and/or pattern strength (undefined = none / the
 * default), its pattern redrawn to match. Choosing a pattern, or "None", replaces any other artwork
 * (e.g. one Claude drew); changing only the color or strength keeps that artwork.
 */
export function withBackground(slide: Slide, patch: BackgroundPatch): Slide {
  const next = { ...slide, ...patch };
  if (next.backgroundPattern) {
    next.backgroundSvg = patternSvg(next.backgroundPattern, next.background ?? PLAIN_SLIDE_COLOR, next.backgroundOpacity);
  } else if ("backgroundPattern" in patch) {
    next.backgroundSvg = undefined;
  }
  return next;
}
