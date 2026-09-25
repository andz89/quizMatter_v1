"use client";

import { useEffect, useState } from "react";
import { useEditorStore } from "@/lib/store";
import { ELEMENT_LIBRARY, ELEMENT_CATEGORY_LABELS, getElementAsset, type ElementCategory } from "@/lib/svgLibrary";
import { ELEMENT_DRAG_MIME } from "@/lib/constants";
import { ElementSvg } from "./ElementSvg";
import { CloseIcon } from "@/components/icons/CloseIcon";

const CATEGORIES: ElementCategory[] = ["shape", "line", "arrow", "solid", "icon", "time", "math", "decorative", "cloud", "number", "letter", "symbol", "emoji", "music", "fruit", "kitchen", "vehicle", "animal", "space", "sport", "tree", "leaf"];

export function ElementsPanel() {
  const closeElementsPanel = useEditorStore((s) => s.closeElementsPanel);
  const recentElementAssetIds = useEditorStore((s) => s.recentElementAssetIds);

  // Which category's items are showing; null means the top-level category grid. Escape steps back
  // one level at a time (out of a category first, then closes the panel), matching the back arrow.
  const [openCategory, setOpenCategory] = useState<ElementCategory | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (openCategory) setOpenCategory(null);
      else closeElementsPanel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openCategory, closeElementsPanel]);

  // Elements are added only by dragging; the question/option boxes handle the drop themselves.
  // The panel stays open so several elements can be added in a row.
  const handleDragStart = (e: React.DragEvent, assetId: string) => {
    e.dataTransfer.setData(ELEMENT_DRAG_MIME, assetId);
    e.dataTransfer.effectAllowed = "copy";

    const image = e.currentTarget.querySelector<HTMLElement>("[data-drag-image]");
    if (image) {
      // The browser snapshots whatever is behind the element too (the tile's gray background),
      // so drag a copy placed off-screen with nothing behind it, then remove it.
      const rect = image.getBoundingClientRect();
      const copy = image.cloneNode(true) as HTMLElement;
      copy.style.cssText = `position:fixed;top:-1000px;left:0;width:${rect.width}px;height:${rect.height}px;color:${getComputedStyle(image).color}`;
      document.body.appendChild(copy);
      // Keep the cursor at the same spot on the SVG it was grabbed from.
      e.dataTransfer.setDragImage(copy, e.clientX - rect.left, e.clientY - rect.top);
      setTimeout(() => copy.remove());
    }
  };

  return (
    <div
      data-keep-container-selection="true"
      className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-border-default bg-bg-surface p-5"
    >
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-1">
          {openCategory && (
            <button
              type="button"
              onClick={() => setOpenCategory(null)}
              title="Back"
              className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
            >
              <BackIcon />
            </button>
          )}
          <h2 className="text-[15px] font-semibold text-text-primary">
            {openCategory ? ELEMENT_CATEGORY_LABELS[openCategory] : "Elements"}
          </h2>
        </div>
        <button
          type="button"
          onClick={closeElementsPanel}
          title="Close (Esc)"
          className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
        >
          <CloseIcon />
        </button>
      </div>
      <p className="mb-4 text-xs text-text-secondary">Drag an element onto the question or an option to add it.</p>

      {openCategory === null ? (
        <>
          <button
            type="button"
            draggable
            onDragStart={(e) => handleDragStart(e, "text-box")}
            className="mb-5 flex w-full cursor-grab items-center gap-3 rounded-button border border-border-default bg-bg-surface p-1.5 text-sm font-medium text-text-primary transition-colors hover:border-accent-navy"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-dropdown bg-bg-page">
              <span data-drag-image className="block h-4 w-4">
                <ElementSvg assetId="text-box" color="currentColor" />
              </span>
            </span>
            Text box
          </button>

          {recentElementAssetIds.length > 0 && (
            <div className="mb-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-header">Recently used</p>
              <div className="grid grid-cols-4 justify-items-center gap-3">
                {recentElementAssetIds.map((assetId) => {
                  const asset = getElementAsset(assetId);
                  return asset ? (
                    <ElementButton key={asset.id} assetId={asset.id} label={asset.label} onDragStart={handleDragStart} />
                  ) : null;
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-4">
            {CATEGORIES.map((category) => {
              const previewAsset = ELEMENT_LIBRARY.find((asset) => asset.category === category);
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setOpenCategory(category)}
                  className="flex flex-col items-center gap-2"
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-card border border-border-default bg-bg-page p-3 text-text-primary transition-colors hover:border-accent-navy">
                    {previewAsset && <ElementSvg assetId={previewAsset.id} color={previewAsset.defaultColor ?? "currentColor"} />}
                  </span>
                  <span className="text-xs font-medium text-text-primary">{ELEMENT_CATEGORY_LABELS[category]}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className="grid grid-cols-4 justify-items-center gap-3">
          {ELEMENT_LIBRARY.filter((asset) => asset.category === openCategory).map((asset) => (
            <ElementButton key={asset.id} assetId={asset.id} label={asset.label} onDragStart={handleDragStart} />
          ))}
        </div>
      )}
    </div>
  );
}

function ElementButton({
  assetId,
  label,
  onDragStart,
}: {
  assetId: string;
  label: string;
  onDragStart: (e: React.DragEvent, assetId: string) => void;
}) {
  const asset = getElementAsset(assetId);
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => onDragStart(e, assetId)}
      title={label}
      className={`flex h-12 w-12 cursor-grab items-center justify-center rounded-dropdown border border-border-default bg-bg-page text-text-primary transition-colors hover:border-accent-navy ${
        // Shapes get less padding so they fill more of the tile and are easier to see.
        asset?.category === "shape" || asset?.category === "solid" ? "p-1" : "p-2.5"
      }`}
    >
      {/* Used as the drag image so the ghost shows only the SVG, not the tile's border/padding. */}
      <span data-drag-image className="block h-full w-full">
        <ElementSvg assetId={assetId} color={asset?.defaultColor ?? "currentColor"} />
      </span>
    </button>
  );
}

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
