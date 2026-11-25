"use client";

import { useState } from "react";
import { hexToHsv, hsvToHex, parseHex, type Hsv } from "@/lib/colors";

const HUE_BAR = "linear-gradient(to right, #F00 0%, #FF0 17%, #0F0 33%, #0FF 50%, #00F 67%, #F0F 83%, #F00 100%)";

interface Props {
  /** The color shown, "#RRGGBB". */
  color: string;
  /** Each move of the square or the hue bar. */
  onChange: (hex: string) => void;
  /** The square or bar let go: the color to remember as recent. */
  onDone: (hex: string) => void;
  /** The hex box is about to take the focus (a press on it), which ends typing in a text. */
  onHexStart: () => void;
  /** A good hex typed and used (Enter or leaving the box). */
  onHexColor: (hex: string) => void;
}

/**
 * The Color panel's custom color: a saturation / brightness square, a hue bar and a hex box. The square and bar never
 * take the focus, so words picked while typing stay picked.
 */
export function CustomColorPicker({ color, onChange, onDone, onHexStart, onHexColor }: Props) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(color));
  // A color from outside (another swatch, undo) moves the markers; our own changes keep the hue, even on grays.
  const [shown, setShown] = useState(color);
  if (color !== shown) {
    setShown(color);
    if (color !== hsvToHex(hsv)) setHsv(hexToHsv(color));
  }
  // What's typed in the hex box and not used yet; null = the box shows `color`.
  const [typed, setTyped] = useState<string | null>(null);

  const change = (next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next);
    setShown(hex);
    if (hex !== color) onChange(hex);
  };

  // Pointer handlers for the square and the bar: the place inside the box as 0–1, still tracked outside it.
  const drag = (pick: (x: number, y: number) => Hsv) => {
    const move = (e: React.PointerEvent<HTMLDivElement>) => {
      const box = e.currentTarget.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
      const y = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
      change(pick(x, y));
    };
    return {
      // No focus change (it would end typing); the panel does the same for the rest of it.
      onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
      onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      },
      onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e);
      },
      onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        onDone(shown);
      },
    };
  };

  const applyHex = (text: string) => {
    setTyped(null);
    const hex = parseHex(text);
    if (hex && hex !== color) onHexColor(hex);
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        {...drag((x, y) => ({ ...hsv, s: x, v: 1 - y }))}
        title="Drag to pick a shade"
        className="relative h-36 w-full cursor-crosshair touch-none rounded-dropdown"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #FFF, hsl(${hsv.h} 100% 50%))`,
        }}
      >
        <Marker left={hsv.s} top={1 - hsv.v} color={hsvToHex(hsv)} />
      </div>

      <div
        {...drag((x) => ({ ...hsv, h: x * 360 }))}
        title="Drag to pick a color"
        className="relative h-3 w-full cursor-pointer touch-none rounded-dropdown"
        style={{ background: HUE_BAR }}
      >
        <Marker left={hsv.h / 360} top={0.5} color={hsvToHex({ h: hsv.h, s: 1, v: 1 })} />
      </div>

      <div className="flex items-center gap-2">
        <span className="h-8 w-8 shrink-0 rounded-full border border-border-default" style={{ background: color }} />
        <input
          type="text"
          aria-label="Hex color"
          spellCheck={false}
          maxLength={7}
          value={typed ?? color}
          // The panel stops mousedown (so typing in a text keeps its focus); this box needs the focus. The press comes
          // before the text loses the focus, so the words picked in it can still be read.
          onMouseDown={(e) => {
            e.stopPropagation();
            onHexStart();
          }}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              applyHex(e.currentTarget.value);
            } else if (e.key === "Escape") {
              // Only puts the color back; the panel's own Escape closes it.
              setTyped(null);
            }
          }}
          onBlur={(e) => typed !== null && applyHex(e.target.value)}
          className="h-9 w-full rounded-input border border-border-default bg-bg-surface px-3 text-sm font-semibold uppercase tabular-nums text-text-primary outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
    </div>
  );
}

function Marker({ left, top, color }: { left: number; top: number; color: string }) {
  return (
    <span
      className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
      style={{ left: `${left * 100}%`, top: `${top * 100}%`, background: color, boxShadow: "0 0 0 1px rgba(0,0,0,0.3)" }}
    />
  );
}
