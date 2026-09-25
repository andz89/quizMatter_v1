import { useId, useLayoutEffect, useRef, useState } from "react";
import { getAssetViewBox, getElementAsset, svgDataUrl, type RenderSettings } from "@/lib/svgLibrary";
import { TEXT_BOX_FONT_SIZE } from "@/lib/constants";
import { FitText } from "./FitText";

interface ElementSvgProps {
  assetId: string;
  color: string;
  // The element's own settings (3D angle, clock time, number line); an SvgElement can be passed as-is.
  settings?: RenderSettings;
  // Called with the drawing's real size (drawing units, lines included) whenever it's measured —
  // only for drawings that get trimmed. Lets a placed element fit its box to the drawing's shape.
  onMeasure?: (width: number, height: number) => void;
}

// Gradients are stored in the same color string as "gradient:#from,#to", so the schema stays a plain string.
export const GRADIENT_PREFIX = "gradient:";

// Empty space (px) left between a drawing's edges and its element box.
export const TRIM_PADDING = 2;

// Turns a stored color string into a CSS background, for swatches shown outside the SVG.
export function toCssBackground(color: string) {
  return color.startsWith(GRADIENT_PREFIX) ? `linear-gradient(135deg, ${color.slice(GRADIENT_PREFIX.length)})` : color;
}

export function ElementSvg({ assetId, color, settings = {}, onMeasure }: ElementSvgProps) {
  // Strip anything that isn't safe inside url(#...), since useId output can contain ":" or "«»".
  const gradientId = `grad-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const asset = getElementAsset(assetId);
  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  // The drawing area cut down to what's actually drawn (+ TRIM_PADDING); null until measured.
  const [trimmedViewBox, setTrimmedViewBox] = useState<string | null>(null);
  // Kept in a ref so measuring always calls the latest callback without re-measuring on every render.
  const onMeasureRef = useRef(onMeasure);
  useLayoutEffect(() => {
    onMeasureRef.current = onMeasure;
  });
  // Drawings are made with empty space around them in their 100×100 area. Trim it, except on
  // elements whose shape changes with their settings (3D angle, clock hands, math tools) — those
  // would jump in size while being adjusted — and on the text box, which isn't a drawing.
  const canTrim =
    !!asset &&
    !asset.isTextBox &&
    !asset.is3d &&
    !asset.isClock &&
    !asset.numberLine &&
    !asset.mathTool &&
    typeof asset.viewBox !== "function";

  useLayoutEffect(() => {
    const svg = svgRef.current;
    const content = contentRef.current;
    if (!canTrim || !svg || !content) return;

    const measure = () => {
      const box = content.getBBox();
      if (box.width === 0 || box.height === 0 || svg.clientWidth === 0 || svg.clientHeight === 0) return;
      // getBBox leaves out line thickness, so add half the thickest line on every side.
      const strokeWidths = [...content.querySelectorAll("[stroke]")]
        .filter((el) => el.getAttribute("stroke") !== "none")
        .map((el) => Number(el.getAttribute("stroke-width") ?? 1));
      const edge = Math.max(0, ...strokeWidths) / 2;
      const width = box.width + edge * 2;
      const height = box.height + edge * 2;
      // Turn the 2px into drawing units at the size the drawing is shown (the tighter side decides).
      const pad =
        TRIM_PADDING *
        Math.max(width / Math.max(1, svg.clientWidth - TRIM_PADDING * 2), height / Math.max(1, svg.clientHeight - TRIM_PADDING * 2));
      setTrimmedViewBox(`${box.x - edge - pad} ${box.y - edge - pad} ${width + pad * 2} ${height + pad * 2}`);
      onMeasureRef.current?.(width, height);
    };

    measure();
    // Re-measure when the element is resized, so the gap stays 2px.
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [canTrim, assetId]);

  // A custom drawing is shown as an image, never put into the page itself, so nothing inside it can run.
  if (settings.svg) {
    // next/image is for files it can optimize; this is inline markup, so a plain <img> is right.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={svgDataUrl(settings.svg)} alt="" draggable={false} className="h-full w-full object-contain" />;
  }

  if (!asset) return null;

  // A placed text box shows its text (read-only here — thumbnails, presentation, drag previews).
  // Without text settings (the Elements panel tile) it falls through and draws its "T" icon.
  if (asset.isTextBox && settings.text) {
    return (
      <div className="h-full w-full" style={{ color }}>
        <FitText text="" html={settings.text.html} minFontSize={TEXT_BOX_FONT_SIZE.min} maxFontSize={TEXT_BOX_FONT_SIZE.max} />
      </div>
    );
  }

  const gradientStops = color.startsWith(GRADIENT_PREFIX) ? color.slice(GRADIENT_PREFIX.length).split(",") : null;
  const viewBox = getAssetViewBox(asset, settings);
  const [, , viewWidth, viewHeight] = viewBox.split(" ").map(Number);

  return (
    <svg ref={svgRef} viewBox={(canTrim && trimmedViewBox) || viewBox} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      {gradientStops && (
        <defs>
          {/* userSpaceOnUse spans the whole viewBox, so zero-height lines still render and
              multi-part assets share one continuous gradient. */}
          <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={viewWidth} y2={viewHeight}>
            <stop offset="0" stopColor={gradientStops[0]} />
            <stop offset="1" stopColor={gradientStops[1]} />
          </linearGradient>
        </defs>
      )}
      <g ref={contentRef}>{asset.render(gradientStops ? `url(#${gradientId})` : color, settings)}</g>
    </svg>
  );
}
