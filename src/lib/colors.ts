// Color math for the Color panel's custom color picker. No imports, so `npm test` loads it.

/** Hue 0–360, saturation and brightness 0–1. */
export type Hsv = { h: number; s: number; v: number };

/** "#abc", "abc", "#aabbcc" or "aabbcc" (spaces around allowed) → "#AABBCC"; anything else → null. */
export function parseHex(text: string): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map((d) => d + d).join("") : match[1];
  return `#${digits.toUpperCase()}`;
}

/** A parsed "#RRGGBB" → hue, saturation, brightness. */
export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const range = max - Math.min(r, g, b);
  let h = 0;
  if (range > 0) {
    if (max === r) h = ((g - b) / range) % 6;
    else if (max === g) h = (b - r) / range + 2;
    else h = (r - g) / range + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max === 0 ? 0 : range / max, v: max };
}

/** Hue, saturation, brightness → "#RRGGBB". */
export function hsvToHex({ h, s, v }: Hsv): string {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6;
    const value = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(value * 255).toString(16).padStart(2, "0");
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`.toUpperCase();
}

/** The recent list with `color` first, each color once, at most `max`. */
export function withRecent(list: string[], color: string, max = 11): string[] {
  return [color, ...list.filter((c) => c !== color)].slice(0, max);
}

/** The recent colors saved in the browser (JSON), keeping only real colors. Junk → []. */
export function readRecentColors(text: string | null): string[] {
  try {
    const value: unknown = JSON.parse(text ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => (typeof item === "string" && parseHex(item) ? [parseHex(item) as string] : []));
  } catch {
    return [];
  }
}
