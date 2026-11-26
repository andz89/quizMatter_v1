import type { SvgElement } from "@/lib/schema";
import { ElementSvg } from "./ElementSvg";

/**
 * Read-only rendering of a slide's SVG elements — used in thumbnails and presentation. `hiddenIds`: elements whose
 * element effect hasn't played yet while presenting (drawn, but see-through, so their photos are ready). The inner
 * box carries `data-element-id`, so presenting can play an effect on it without touching the element's own turn.
 */
export function StaticElementView({ elements, hiddenIds }: { elements: SvgElement[]; hiddenIds?: ReadonlySet<string> }) {
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
          {/* Hidden by a class, not an inline style: an effect writes inline styles and clears them when it ends. */}
          <div data-element-id={element.id} className={`h-full w-full ${hiddenIds?.has(element.id) ? "opacity-0" : ""}`}>
            <ElementSvg assetId={element.assetId} color={element.color} settings={element} />
          </div>
        </div>
      ))}
    </>
  );
}
