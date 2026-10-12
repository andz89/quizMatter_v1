"use client";

import { useEffect } from "react";
import { useEditorStore, isPanelEscape } from "@/lib/store";
import { getSlideNumbers, MESH_PREFIX } from "@/lib/constants";
import { BACKGROUND_COLORS, BACKGROUND_GRADIENTS, BACKGROUND_MESHES } from "@/lib/slideBackground";
import { NONE_SWATCH } from "./ColorPanel";
import { PanelLabel } from "./PanelControls";
import { SlideThumbnailPreview } from "./SlideThumbnailPreview";
import { slideBackgroundCss } from "@/components/presentation/SlideStaticView";
import { XIcon } from "lucide-react";

/**
 * Sidebar panel for the selected slide's background: a soft color, gradient or soft blend. Every change goes straight onto the slide; the small preview on top shows it too.
 */
export function BackgroundPanel() {
  const closeBackgroundPanel = useEditorStore((s) => s.closeBackgroundPanel);
  const setSlideBackground = useEditorStore((s) => s.setSlideBackground);
  const applyBackgroundToAll = useEditorStore((s) => s.applyBackgroundToAll);
  const slide = useEditorStore((s) => s.presentation.slides.find((slide) => slide.id === s.selectedSlideId));
  const questionNumber = useEditorStore((s) => getSlideNumbers(s.presentation.slides).get(s.selectedSlideId ?? ""));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isPanelEscape(e)) closeBackgroundPanel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeBackgroundPanel]);

  if (!slide) return null;

  return (
    <div
      data-keep-container-selection="true"
      className="flex shrink-0 flex-col gap-6 overflow-y-auto border-r border-border-default bg-bg-surface side-panel"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-extrabold text-text-primary">Background</h2>
        <button
          type="button"
          onClick={closeBackgroundPanel}
          title="Close (Esc)"
          className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
        >
          <XIcon size={16} />
        </button>
      </div>

      <div className="flex justify-center">
        <SlideThumbnailPreview slide={slide} questionNumber={questionNumber} />
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
        <PanelLabel>Gradient</PanelLabel>
        <div className="flex flex-wrap gap-2.5">
          {BACKGROUND_GRADIENTS.map((gradient) => (
            <Tile
              key={gradient}
              title={gradient.slice(gradient.indexOf(":") + 1).replaceAll(",", " → ")}
              selected={slide.background === gradient} onClick={() => setSlideBackground(slide.id, { background: gradient })}>
              <span className="block h-full w-full rounded-dropdown" style={{ background: slideBackgroundCss(gradient) }} />
            </Tile>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <PanelLabel>Soft blend</PanelLabel>
        <div className="flex flex-wrap gap-2.5">
          {BACKGROUND_MESHES.map((mesh) => (
            <Tile
              key={mesh}
              title={mesh.slice(MESH_PREFIX.length).replaceAll(",", ", ")}
              selected={slide.background === mesh} onClick={() => setSlideBackground(slide.id, { background: mesh })}>
              <span className="block h-full w-full rounded-dropdown" style={{ background: slideBackgroundCss(mesh) }} />
            </Tile>
          ))}
        </div>
      </section>

      <button
        type="button"
        onClick={() => applyBackgroundToAll(slide.id)}
        className="rounded-button border border-border-default px-4 py-2.5 text-sm font-semibold text-text-primary transition-colors hover:border-accent"
      >
        Apply to all slides
      </button>
    </div>
  );
}

function Tile({
  title,
  selected,
  onClick,
  children,
}: {
  title: string;
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="h-9 w-9 rounded-dropdown border bg-bg-page p-0.5 transition-colors hover:border-accent"
      style={{ borderColor: selected ? "var(--accent)" : "var(--border-default)", borderWidth: selected ? 2 : 1 }}
    >
      {children}
    </button>
  );
}
