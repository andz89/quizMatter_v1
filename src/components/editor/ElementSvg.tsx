import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { getAssetViewBox, getElementAsset, svgDataUrl, type RenderSettings } from "@/lib/svgLibrary";
import { isPeopleArt, isPeopleArtLoaded, loadPeopleArt } from "@/lib/peopleArt";
import { Spinner } from "@/components/Spinner";
import { GRADIENT_PREFIX, TEXT_BOX_FONT_SIZE, thumbnailUrl } from "@/lib/constants";
import { SlideText } from "./SlideText";

interface ElementSvgProps {
  assetId: string;
  color: string;
  // The element's own settings (3D angle, clock time, number line); an SvgElement can be passed as-is.
  settings?: RenderSettings;
  // Called with the drawing's real size (drawing units, lines included) whenever it's measured —
  // only for drawings that get trimmed. Lets a placed element fit its box to the drawing's shape.
  onMeasure?: (width: number, height: number) => void;
}

// Empty space (px) left between a drawing's edges and its element box.
export const TRIM_PADDING = 2;

// Turns a stored color string into a CSS background, for swatches shown outside the SVG.
export function toCssBackground(color: string) {
  return color.startsWith(GRADIENT_PREFIX) ? `linear-gradient(135deg, ${color.slice(GRADIENT_PREFIX.length)})` : color;
}

export function ElementSvg(props: ElementSvgProps) {
  const { crop, flipX, flipY } = props.settings ?? {};
  const drawing = crop ? <CroppedDrawing {...props} crop={crop} /> : <ElementDrawing {...props} />;
  if (!flipX && !flipY) return drawing;

  // Flipped: the picture (after cropping) is mirrored inside its box.
  return (
    <div className="h-full w-full" style={{ transform: `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})` }}>
      {drawing}
    </div>
  );
}

// Cropped: the whole picture is drawn bigger than the box and shifted, and the box hides what's outside it.
function CroppedDrawing({ crop, ...props }: ElementSvgProps & { crop: NonNullable<RenderSettings["crop"]> }) {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <div
        className="absolute"
        style={{
          left: `${(-crop.x / crop.width) * 100}%`,
          top: `${(-crop.y / crop.height) * 100}%`,
          width: `${100 / crop.width}%`,
          height: `${100 / crop.height}%`,
        }}
      >
        <ElementDrawing {...props} />
      </div>
    </div>
  );
}

/**
 * A photo on a slide: the full file (sharp in fullscreen). Until it has loaded, its small copy shows in its place
 * (usually already loaded by the Photos panel), so a new photo never shows as an empty box. The small copy is only
 * a stand-in: if it fails to load, it's simply left out.
 */
function SlidePhoto({ src }: { src: string }) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  return (
    <div className="relative h-full w-full">
      {!isLoaded && !thumbnailFailed && (
        // eslint-disable-next-line @next/next/no-img-element -- Cloudflare already makes the small copy; nothing for next/image to do.
        <img
          src={thumbnailUrl(src)}
          alt=""
          draggable={false}
          onError={() => setThumbnailFailed(true)}
          className="absolute inset-0 h-full w-full object-contain"
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- already shrunk when it was uploaded; nothing for next/image to do. */}
      <img
        // A photo the browser already has may finish loading before React listens, so that's checked too.
        ref={(img) => {
          if (img?.complete && img.naturalWidth > 0) setIsLoaded(true);
        }}
        src={src}
        alt=""
        draggable={false}
        onLoad={() => setIsLoaded(true)}
        className="relative h-full w-full object-contain"
      />
    </div>
  );
}

function ElementDrawing({ assetId, color, settings = {}, onMeasure }: ElementSvgProps) {
  // Strip anything that isn't safe inside url(#...), since useId output can contain ":" or "«»".
  const gradientId = `grad-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const asset = getElementAsset(assetId);
  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  // The drawing area cut down to what's actually drawn (+ TRIM_PADDING); null until measured.
  const [trimmedViewBox, setTrimmedViewBox] = useState<string | null>(null);
  // The School Boy and the clipart students are a separate download (see peopleArt.ts). Opened
  // presentations wait for it; anything else (Elements panel tiles, home page cards) shows the
  // Spinner here until it arrives, or nothing if it fails.
  const waitsForArt = isPeopleArt(assetId) && !isPeopleArtLoaded();
  const [artFailed, setArtFailed] = useState(false);
  const [, setArtLoaded] = useState(false);
  useEffect(() => {
    if (waitsForArt) loadPeopleArt().then(() => setArtLoaded(true), () => setArtFailed(true));
  }, [waitsForArt]);
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
    !waitsForArt &&
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

  if (settings.image) return <SlidePhoto key={settings.image.src} src={settings.image.src} />;

  if (!asset) return null;

  if (waitsForArt) {
    return artFailed ? null : (
      <div className="flex h-full w-full items-center justify-center">
        <Spinner size={16} />
      </div>
    );
  }

  // A placed text box shows its text (read-only here — thumbnails, presentation, drag previews).
  // Without text settings (the Elements panel tile) it falls through and draws its "T" icon.
  if (asset.isTextBox && settings.text) {
    return (
      <div className="h-full w-full" style={{ color }}>
        <SlideText text="" html={settings.text.html} fontSize={settings.text.fontSize ?? TEXT_BOX_FONT_SIZE} />
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
