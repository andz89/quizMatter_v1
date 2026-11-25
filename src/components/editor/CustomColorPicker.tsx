"use client";

import { useRef, useState } from "react";
import { hexToHsv, hsvToHex, parseHex, type Hsv } from "@/lib/colors";

const HUE_BAR = "linear-gradient(to right, #F00 0%, #FF0 17%, #0F0 33%, #0FF 50%, #00F 67%, #F0F 83%, #F00 100%)";

interface Props {
  /** The color shown, "#RRGGBB". */
  color: string;
  /** False when `color` is only a start (a gradient, none or mixed colors): then any pick is a change. */
  hasColor: boolean;
  /** The square or the hue bar pressed: a drag starts. */
  onDragStart: () => void;
  /** Each move of the square or the hue bar that changes the color. */
  onChange: (hex: string) => void;
  /** The square or bar let go: the last color the drag sent, or null when it never left the target's color. */
  onDone: (lastColor: string | null) => void;
  /** The hex box is about to take the focus (a press on it), which ends typing in a text. */
  onHexStart: () => void;
  /** A good hex typed and used (Enter or leaving the box). */
  onHexColor: (hex: string) => void;
  /** The hex box lost the focus (after its color, if any, was used). */
  onHexEnd: () => void;
}

/**
 * The Color panel's custom color: a saturation / brightness square, a hue bar and a hex box. The square and bar never
 * take the focus, so words picked while typing stay picked.
 */
export function CustomColorPicker({ color, hasColor, onDragStart, onChange, onDone, onHexStart, onHexColor, onHexEnd }: Props) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(color));
  // A color from outside (another swatch, undo) moves the markers; our own changes keep the hue, even on grays.
  const [shown, setShown] = useState(color);
  if (color !== shown) {
    setShown(color);
    if (color !== hsvToHex(hsv)) setHsv(hexToHsv(color));
  }
  // What's typed in the hex box and not used yet; null = the box shows `color`.
  const [typed, setTyped] = useState<string | null>(null);

  // The last color this drag sent (at first the target's own, or none when it has no solid color), and whether it
  // sent any: a drag that never leaves the target's color changes nothing.
  const dragState = useRef<{ last: string | null; changed: boolean }>({ last: null, changed: false });

  const change = (next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next);
    setShown(hex);
    if (hex === dragState.current.last) return;
    dragState.current = { last: hex, changed: true };
    onChange(hex);
  };

  // The place inside the square or the bar as 0–1 (still tracked outside it) → the color there.
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    const y = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
    change(e.currentTarget.dataset.part === "hue" ? { ...hsv, h: x * 360 } : { ...hsv, s: x, v: 1 - y });
  };
  // Pointer handlers for the square and the bar (`data-part` says which).
  const dragHandlers = {
    // No focus change (it would end typing); the panel does the same for the rest of it.
    onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragState.current = { last: hasColor ? color : null, changed: false };
      onDragStart();
      move(e);
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e);
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    },
    // Let go, or the browser took the pointer away (a cancel): the drag ends either way.
    onLostPointerCapture: () => onDone(dragState.current.changed ? dragState.current.last : null),
  };

  // Always used, even when it matches the color shown: that can be only a start, or the box's color, not the words'.
  const applyHex = (text: string) => {
    setTyped(null);
    const hex = parseHex(text);
    if (hex) onHexColor(hex);
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        {...dragHandlers}
        data-part="shade"
        title="Drag to pick a shade"
        className="relative h-36 w-full cursor-crosshair touch-none rounded-dropdown"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #FFF, hsl(${hsv.h} 100% 50%))`,
        }}
      >
        <Marker left={hsv.s} top={1 - hsv.v} color={hsvToHex(hsv)} />
      </div>

      <div
        {...dragHandlers}
        data-part="hue"
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
          // Room for spaces around a pasted value; parseHex checks the rest.
          maxLength={16}
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
          onBlur={(e) => {
            if (typed !== null) applyHex(e.target.value);
            onHexEnd();
          }}
          className="h-9 w-full rounded-input border border-border-default bg-bg-surface px-3 text-sm font-semibold uppercase tabular-nums text-text-primary outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
    </div>
  );
}

function Marker({ left, top, color }: { left: number; top: number; color: string }) {
  return (
    <span
      className="color-marker pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full"
      style={{ left: `${left * 100}%`, top: `${top * 100}%`, background: color }}
    />
  );
}
