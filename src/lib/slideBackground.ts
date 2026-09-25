// A slide's background: a soft color, plus an optional pattern from the library drawn as a frame
// around the edges. Used by the Background panel and by the quiz importer, so both look the same.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ELEMENT_LIBRARY, getElementAsset } from "./svgLibrary";
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

// Text is dark, so backgrounds must stay light (0 = black, 1 = white).
const MIN_BACKGROUND_LIGHTNESS = 0.85;
// How solid a pattern is, in percent: faint by default so the text on top stays easy to read.
export const DEFAULT_PATTERN_OPACITY = 25;
export const PATTERN_OPACITY_RANGE = { min: 5, max: 100 };
// What a pattern sits on when the slide has no color of its own (the plain white surface).
const PLAIN_SLIDE_COLOR = "#FFFFFF";

/** A dark color mixed with white until it's light enough to read dark text on. */
export function lighten(hex: string): string {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lightness = (c: number[]) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
  let mixed = rgb;
  for (let white = 0.1; lightness(mixed) < MIN_BACKGROUND_LIGHTNESS; white += 0.1) {
    mixed = rgb.map((c) => Math.round(c + (255 - c) * Math.min(1, white)));
  }
  return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A library pattern as slide artwork (SVG markup). The pattern card is repeated 4×4, so its shapes are
 * small, and only shows as a soft 40px frame around the edges; a plain panel covers the middle so
 * text, pictures and cards stay clear. The cards take the slide's color, so their corners and seams
 * don't show.
 */
export function patternSvg(patternId: string, color: string, opacity = DEFAULT_PATTERN_OPACITY): string {
  const asset = getElementAsset(patternId)!;
  // The card is drawn once and repeated with <use>, which keeps the saved markup small.
  const tiles = [0, 1, 2, 3].flatMap((row) =>
    [0, 1, 2, 3].map((col) => createElement("use", { key: `${row}-${col}`, href: "#tile", x: col * 160, y: row * 100 })),
  );
  // 640×360 is exactly 16:9, and the cards' rows and columns sit every 20 units starting at 10, so
  // the outer row and column of shapes land whole inside the 20-unit (40px) frame.
  return renderToStaticMarkup(
    createElement(
      "svg",
      { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 640 360" },
      createElement("defs", null, createElement("g", { id: "tile" }, asset.render(color, {}))),
      createElement("g", { opacity: opacity / 100 }, tiles),
      createElement("rect", { x: 20, y: 20, width: 600, height: 320, rx: 8, fill: color }),
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
