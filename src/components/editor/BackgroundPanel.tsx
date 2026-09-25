"use client";

import { useEffect } from "react";
import { useEditorStore } from "@/lib/store";
import { getElementAsset } from "@/lib/svgLibrary";
import {
  BACKGROUND_COLORS,
  BACKGROUND_PATTERN_IDS,
  DEFAULT_PATTERN_OPACITY,
  PATTERN_OPACITY_RANGE,
} from "@/lib/slideBackground";
import { ElementSvg } from "./ElementSvg";
import { NONE_SWATCH } from "./ColorPanel";
import { PanelLabel, PanelSlider } from "./PanelControls";
import { SlideThumbnailPreview } from "./SlideThumbnailPreview";
import { CloseIcon } from "@/components/icons/CloseIcon";

/**
 * Sidebar panel for the selected slide's background: a soft color and an optional pattern frame with
 * its strength. Every change goes straight onto the slide; the small preview on top shows it too.
 */
export function BackgroundPanel() {
  const closeBackgroundPanel = useEditorStore((s) => s.closeBackgroundPanel);
  const setSlideBackground = useEditorStore((s) => s.setSlideBackground);
  const applyBackgroundToAll = useEditorStore((s) => s.applyBackgroundToAll);
  const slide = useEditorStore((s) => s.quiz.slides.find((slide) => slide.id === s.selectedSlideId));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeBackgroundPanel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeBackgroundPanel]);

  if (!slide) return null;

  return (
    <div
      data-keep-container-selection="true"
      className="flex w-72 shrink-0 flex-col gap-6 overflow-y-auto border-r border-border-default bg-bg-surface p-5"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-text-primary">Background</h2>
        <button
          type="button"
          onClick={closeBackgroundPanel}
          title="Close (Esc)"
          className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="flex justify-center">
        <SlideThumbnailPreview slide={slide} />
      </div>

      <section className="flex flex-col gap-3">
        <PanelLabel>Color</PanelLabel>
        <div className="flex flex-wrap gap-2.5">
          <Tile title="None" selected={!slide.background} onClick={() => setSlideBackground(slide.id, { background: undefined })}>
            <span className="block h-full w-full rounded-dropdown" style={{ background: NONE_SWATCH }} />
          </Tile>
          {BACKGROUND_COLORS.map((color) => (
            <Tile key={color} title={color} selected={slide.background === color} onClick={() => setSlideBackground(slide.id, { background: color })}>
              <span className="block h-full w-full rounded-dropdown" style={{ background: color }} />
            </Tile>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <PanelLabel>Pattern</PanelLabel>
        <p className="text-xs text-text-secondary">A soft frame around the slide&apos;s edges, in the slide&apos;s color.</p>
        <div className="grid grid-cols-3 gap-2.5">
          <Tile
            title="None"
            wide
            selected={!slide.backgroundPattern}
            onClick={() => setSlideBackground(slide.id, { backgroundPattern: undefined })}
          >
            <span className="flex h-full w-full items-center justify-center text-xs text-text-secondary">None</span>
          </Tile>
          {BACKGROUND_PATTERN_IDS.map((patternId) => (
            <Tile
              key={patternId}
              title={getElementAsset(patternId)?.label ?? patternId}
              wide
              selected={slide.backgroundPattern === patternId}
              onClick={() => setSlideBackground(slide.id, { backgroundPattern: patternId })}
            >
              {/* Shown in the slide's color, so the tile previews what the slide will get. */}
              <ElementSvg assetId={patternId} color={slide.background ?? getElementAsset(patternId)?.defaultColor ?? "#FFFFFF"} />
            </Tile>
          ))}
        </div>
        {/* Greyed out until there's a pattern to make stronger or fainter. */}
        <div className={slide.backgroundPattern ? "" : "pointer-events-none opacity-40"}>
          <PanelSlider
            label="Strength"
            unit="%"
            min={PATTERN_OPACITY_RANGE.min}
            max={PATTERN_OPACITY_RANGE.max}
            value={slide.backgroundOpacity ?? DEFAULT_PATTERN_OPACITY}
            onChange={(value) => setSlideBackground(slide.id, { backgroundOpacity: value })}
          />
        </div>
      </section>

      <button
        type="button"
        onClick={() => applyBackgroundToAll(slide.id)}
        className="rounded-button border border-border-default px-4 py-2.5 text-sm font-semibold text-text-primary transition-colors hover:border-accent-navy"
      >
        Apply to all slides
      </button>
    </div>
  );
}

function Tile({
  title,
  wide,
  selected,
  onClick,
  children,
}: {
  title: string;
  wide?: boolean;
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded-dropdown border bg-bg-page p-0.5 transition-colors hover:border-accent-navy ${wide ? "h-12 w-full" : "h-9 w-9"}`}
      style={{ borderColor: selected ? "var(--accent-navy)" : "var(--border-default)", borderWidth: selected ? 2 : 1 }}
    >
      {children}
    </button>
  );
}
