import { useId } from "react";
import { getAssetViewBox, getElementAsset, type RenderSettings } from "@/lib/svgLibrary";

interface ElementSvgProps {
  assetId: string;
  color: string;
  // The element's own settings (3D angle, clock time, number line); an SvgElement can be passed as-is.
  settings?: RenderSettings;
}

// Gradients are stored in the same color string as "gradient:#from,#to", so the schema stays a plain string.
export const GRADIENT_PREFIX = "gradient:";

// Turns a stored color string into a CSS background, for swatches shown outside the SVG.
export function toCssBackground(color: string) {
  return color.startsWith(GRADIENT_PREFIX) ? `linear-gradient(135deg, ${color.slice(GRADIENT_PREFIX.length)})` : color;
}

export function ElementSvg({ assetId, color, settings = {} }: ElementSvgProps) {
  // Strip anything that isn't safe inside url(#...), since useId output can contain ":" or "«»".
  const gradientId = `grad-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const asset = getElementAsset(assetId);
  if (!asset) return null;

  const gradientStops = color.startsWith(GRADIENT_PREFIX) ? color.slice(GRADIENT_PREFIX.length).split(",") : null;
  const viewBox = getAssetViewBox(asset, settings);
  const [, , viewWidth, viewHeight] = viewBox.split(" ").map(Number);

  return (
    <svg viewBox={viewBox} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
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
      {asset.render(gradientStops ? `url(#${gradientId})` : color, settings)}
    </svg>
  );
}
