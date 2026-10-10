"use client";

import { useEffect, useState } from "react";
import { canTrimDrawing, DEFAULT_ELEMENT_COLOR, ELEMENT_LIBRARY } from "@/lib/svgLibrary";
import { loadPeopleArt } from "@/lib/peopleArt";
import { ElementSvg } from "@/components/editor/ElementSvg";
import { Spinner } from "@/components/Spinner";

// Only the drawings the editor trims: the rest keep their whole drawing area, so they need no shape.
const ASSETS = ELEMENT_LIBRARY.filter(canTrimDrawing);

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * Draws every library drawing with the editor's own ElementSvg, which measures the drawing's real shape
 * (without the empty space around it), and downloads them all as assetShapes.json for Claude's import.
 */
export function AssetShapes() {
  // Text drawings (numbers, letters) are measured right only once the fonts are in, and the people art
  // is a separate download.
  const [ready, setReady] = useState(false);
  const [shapes, setShapes] = useState<Record<string, [number, number]>>({});

  useEffect(() => {
    Promise.all([document.fonts.ready, loadPeopleArt()]).then(() => setReady(true));
  }, []);

  const measured = Object.keys(shapes).length;

  const download = () => {
    const sorted = Object.fromEntries(Object.entries(shapes).sort(([a], [b]) => a.localeCompare(b)));
    const url = URL.createObjectURL(new Blob([JSON.stringify(sorted, null, 2) + "\n"], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "assetShapes.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-5 p-5">
      <h1 className="text-2xl font-extrabold">Picture shapes</h1>
      <p className="text-sm text-text-secondary">
        Download the file and put it in src/lib/ (replacing assetShapes.json), then commit it. Run this again after
        adding or changing library art.
      </p>
      {!ready ? (
        <Spinner />
      ) : (
        <>
          <div className="flex items-center gap-3">
            {measured < ASSETS.length && <Spinner size={16} />}
            <span className="text-sm">
              {measured} of {ASSETS.length} measured
            </span>
            <button
              type="button"
              onClick={download}
              className="rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
            >
              Download assetShapes.json
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {ASSETS.map((asset) => (
              <div key={asset.id} title={asset.id} className="h-[120px] w-[120px] rounded-dropdown border border-border-default bg-bg-surface">
                <ElementSvg
                  assetId={asset.id}
                  color={asset.defaultColor ?? DEFAULT_ELEMENT_COLOR}
                  onMeasure={(width, height) =>
                    setShapes((current) => ({ ...current, [asset.id]: [round(width), round(height)] }))
                  }
                />
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
