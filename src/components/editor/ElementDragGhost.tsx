"use client";

import { useEditorStore } from "@/lib/store";
import { ElementSvg } from "./ElementSvg";

/** Faint preview icons that follow the cursor while element(s) are being dragged over a different box. */
export function ElementDragGhost() {
  const ghosts = useEditorStore((s) => s.elementDragGhosts);

  return ghosts.map((ghost) => (
    <div
      key={ghost.id}
      className="pointer-events-none absolute opacity-60"
      style={{
        left: ghost.x,
        top: ghost.y,
        width: ghost.width,
        height: ghost.height,
        transform: `rotate(${ghost.rotation}deg)`,
      }}
    >
      <ElementSvg assetId={ghost.assetId} color={ghost.color} settings={ghost.settings} />
    </div>
  ));
}
