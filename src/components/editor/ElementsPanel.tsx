"use client";

import { useEffect, useRef, useState } from "react";
import { useEditorStore, isPanelEscape } from "@/lib/store";
import { ELEMENT_LIBRARY, ELEMENT_CATEGORY_LABELS, ELEMENT_PANEL_CATEGORIES, getElementAsset, type ElementCategory } from "@/lib/svgLibrary";
import { loadFavoriteCategories, saveFavoriteCategories } from "@/lib/userSettings";
import { checkPauses, pausedUntilFromError, useIsPaused } from "@/lib/clickLimits";
import { ELEMENT_DRAG_MIME } from "@/lib/constants";
import { ElementSvg } from "./ElementSvg";
import { Spinner } from "@/components/Spinner";
import { ScrollRow } from "./ScrollRow";
import { ChevronLeftIcon, StarIcon, XIcon } from "lucide-react";

export function ElementsPanel() {
  const closeElementsPanel = useEditorStore((s) => s.closeElementsPanel);
  const insertElement = useEditorStore((s) => s.insertElement);
  const recentElementAssetIds = useEditorStore((s) => s.recentElementAssetIds);
  const favoriteCategories = useEditorStore((s) => s.favoriteElementCategories);
  const setFavoriteCategories = useEditorStore((s) => s.setFavoriteElementCategories);
  const [isSavingFavorite, setIsSavingFavorite] = useState(false);
  // Changed settings too fast: the star greys out and the notice at the bottom says until when.
  const isSettingsPaused = useIsPaused("settings", "settings_daily");

  // Which category's items are showing; null means the top-level category grid. Escape steps back
  // one level at a time (out of a category first, then closes the panel), matching the back arrow.
  const [openCategory, setOpenCategory] = useState<ElementCategory | null>(null);

  // Favorites are loaded once per editor visit (the store keeps them while the panel closes and reopens).
  useEffect(() => {
    if (favoriteCategories !== null) return;
    loadFavoriteCategories()
      .then(setFavoriteCategories)
      .catch(() => setFavoriteCategories([]));
  }, [favoriteCategories, setFavoriteCategories]);

  // Stars or un-stars a category. The star changes at once; if saving fails, it flips back.
  const toggleFavorite = async (category: ElementCategory) => {
    const previous = favoriteCategories ?? [];
    const next = previous.includes(category)
      ? previous.filter((c) => c !== category)
      : ELEMENT_PANEL_CATEGORIES.filter((c) => c === category || previous.includes(c));
    setFavoriteCategories(next);
    setIsSavingFavorite(true);
    try {
      await saveFavoriteCategories(next);
    } catch (error) {
      setFavoriteCategories(previous);
      // The minute and the daily limit give the same refusal, so ask which is paused.
      if (pausedUntilFromError(error as { code?: string; details?: string })) await checkPauses();
    } finally {
      setIsSavingFavorite(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPanelEscape(e)) return;
      if (openCategory) setOpenCategory(null);
      else closeElementsPanel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openCategory, closeElementsPanel]);

  // Elements are added by dragging (the question/option boxes handle the drop themselves) or by a
  // click (insertElement picks the box). The panel stays open so several can be added in a row.
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
      className="flex shrink-0 flex-col overflow-y-auto border-r border-border-default bg-bg-surface side-panel"
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
              <ChevronLeftIcon size={16} />
            </button>
          )}
          <h2 className="text-[15px] font-extrabold text-text-primary">
            {openCategory ? ELEMENT_CATEGORY_LABELS[openCategory] : "Elements"}
          </h2>
          {openCategory && favoriteCategories !== null && (
            <button
              type="button"
              onClick={() => toggleFavorite(openCategory)}
              disabled={isSavingFavorite || isSettingsPaused}
              title={favoriteCategories.includes(openCategory) ? "Remove from favorites" : "Add to favorites"}
              className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page disabled:opacity-40"
            >
              {isSavingFavorite ? <Spinner size={14} /> : <StarIcon size={16} fill={favoriteCategories.includes(openCategory) ? "currentColor" : "none"} />}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={closeElementsPanel}
          title="Close (Esc)"
          className="flex h-8 w-8 items-center justify-center rounded-dropdown text-text-primary hover:bg-bg-page"
        >
          <XIcon size={16} />
        </button>
      </div>
      <p className="mb-4 text-xs text-text-secondary">Drag an element onto a box, or click it to add it.</p>

      {openCategory === null ? (
        <>
          <div className="mb-5 grid grid-cols-2 gap-2">
            <button
              type="button"
              draggable
              onDragStart={(e) => handleDragStart(e, "text-box")}
              onClick={() => insertElement("text-box")}
              className="flex cursor-grab items-center justify-center gap-2 whitespace-nowrap rounded-card border border-transparent bg-accent-soft p-2 text-[13px] font-semibold text-text-primary transition-colors hover:border-accent"
            >
              {/* The colored square is the drag image, so the ghost shows the icon, not a white "T". */}
              <span
                data-drag-image
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-button bg-accent text-white"
              >
                <span className="block h-4 w-4">
                  <ElementSvg assetId="text-box" color="currentColor" />
                </span>
              </span>
              Text box
            </button>
            <button
              type="button"
              draggable
              onDragStart={(e) => handleDragStart(e, "rectangle")}
              onClick={() => insertElement("rectangle")}
              className="flex cursor-grab items-center justify-center gap-2 whitespace-nowrap rounded-card border border-transparent bg-accent-soft p-2 text-[13px] font-semibold text-text-primary transition-colors hover:border-accent"
            >
              <span
                data-drag-image
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-button bg-accent text-white"
              >
                <span className="block h-4 w-4">
                  <ElementSvg assetId="rectangle" color="currentColor" />
                </span>
              </span>
              Box
            </button>
          </div>

          {/* Waits for the favorites, so the rows don't jump when the starred ones move to the top. */}
          {favoriteCategories === null ? (
            <div className="flex justify-center">
              <Spinner size={18} />
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {recentElementAssetIds.length > 0 && (
                <ScrollRow name="Recently used">
                  {recentElementAssetIds.map((assetId) => {
                    const asset = getElementAsset(assetId);
                    return asset ? (
                      <ElementButton key={asset.id} assetId={asset.id} label={asset.label} onDragStart={handleDragStart} onClick={insertElement} inRow />
                    ) : null;
                  })}
                </ScrollRow>
              )}
              {/* Starred categories first, then the rest in the usual order. */}
              {[...favoriteCategories, ...ELEMENT_PANEL_CATEGORIES.filter((c) => !favoriteCategories.includes(c))].map((category) => (
                <CategoryRow
                  key={category}
                  category={category}
                  isFavorite={favoriteCategories.includes(category)}
                  onSeeAll={() => setOpenCategory(category)}
                  onDragStart={handleDragStart}
                  onClick={insertElement}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        // Two columns of big tiles (they fill the columns).
        <div className="grid grid-cols-2 gap-2">
          {ELEMENT_LIBRARY.filter((asset) => asset.category === openCategory).map((asset) => (
            <ElementButton key={asset.id} assetId={asset.id} label={asset.label} onDragStart={handleDragStart} onClick={insertElement} />
          ))}
        </div>
      )}
    </div>
  );
}

// How many elements a category's row shows. "See all" shows the rest.
const ROW_ELEMENTS = 10;

/**
 * One category's row: its first elements, and "See all". There are many categories and some drawings are big,
 * so a row only draws its elements once it's about to scroll into view (until then, an empty space as tall as
 * the tiles, so the panel doesn't jump). Once drawn, it stays drawn.
 */
function CategoryRow({
  category,
  isFavorite,
  onSeeAll,
  onDragStart,
  onClick,
}: {
  category: ElementCategory;
  isFavorite: boolean;
  onSeeAll: () => void;
  onDragStart: (e: React.DragEvent, assetId: string) => void;
  onClick: (assetId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [isNear, setIsNear] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || isNear) return;
    // Watched inside the panel's own scroll area, starting a little before the row shows.
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setIsNear(true), {
      root: node.closest(".side-panel"),
      rootMargin: "300px 0px",
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [isNear]);

  return (
    <div ref={ref}>
      <ScrollRow
        name={ELEMENT_CATEGORY_LABELS[category]}
        icon={isFavorite ? <StarIcon size={12} fill="currentColor" className="shrink-0" /> : undefined}
        onSeeAll={onSeeAll}
      >
        {isNear ? (
          ELEMENT_LIBRARY.filter((asset) => asset.category === category)
            .slice(0, ROW_ELEMENTS)
            .map((asset) => (
              <ElementButton key={asset.id} assetId={asset.id} label={asset.label} onDragStart={onDragStart} onClick={onClick} inRow />
            ))
        ) : (
          <div className={category === "person" ? "h-20" : "h-16"} />
        )}
      </ScrollRow>
    </div>
  );
}

function ElementButton({
  assetId,
  label,
  onDragStart,
  onClick,
  inRow = false,
}: {
  assetId: string;
  label: string;
  onDragStart: (e: React.DragEvent, assetId: string) => void;
  onClick: (assetId: string) => void;
  // In a row: a fixed size. In the "See all" grid: as wide as its column.
  inRow?: boolean;
}) {
  const asset = getElementAsset(assetId);
  const isPerson = asset?.category === "person";
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => onDragStart(e, assetId)}
      onClick={() => onClick(assetId)}
      title={label}
      className={`flex cursor-grab items-center justify-center rounded-dropdown border border-border-default bg-bg-page text-text-primary transition-colors hover:border-accent ${
        !inRow ? "aspect-square w-full" : isPerson ? "h-20 w-20 shrink-0" : "h-16 w-16 shrink-0"
      } ${
        // People are tall and thin: bigger tiles with little padding so they're easy to see.
        // Shapes also get less padding so they fill more of the tile.
        isPerson || asset?.category === "shape" || asset?.category === "solid" ? "p-1" : "p-3"
      }`}
    >
      {/* Used as the drag image so the ghost shows only the SVG, not the tile's border/padding. */}
      <span data-drag-image className="block h-full w-full">
        <ElementSvg assetId={assetId} color={asset?.defaultColor ?? "currentColor"} />
      </span>
    </button>
  );
}
