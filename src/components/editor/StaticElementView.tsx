import type { SvgElement } from "@/lib/schema";
import { ElementSvg } from "./ElementSvg";

/** Read-only rendering of a slide's SVG elements — used in thumbnails and presentation. */
export function StaticElementView({ elements }: { elements: SvgElement[] }) {
  return (
    <>
      {elements.map((element) => (
        <div
          key={element.id}
          className="pointer-events-none absolute"
          style={{
            left: element.x,
            top: element.y,
            width: element.width,
            height: element.height,
            transform: `rotate(${element.rotation ?? 0}deg)`,
            opacity: (element.opacity ?? 100) / 100,
          }}
        >
          <ElementSvg assetId={element.assetId} color={element.color} settings={element} />
        </div>
      ))}
    </>
  );
}
