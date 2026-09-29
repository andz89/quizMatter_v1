"use client";

import type { ReactNode } from "react";
import { useEditorStore } from "@/lib/store";
import { BookOpenIcon, FileTextIcon, ImageIcon, LayoutGridIcon, PaintBucketIcon, ShapesIcon } from "lucide-react";

/**
 * Canva-style narrow icon bar: "Elements", "Photos", "Background", "Details" and "Presentations" expand their sidebar panels,
 * "Slides" opens the thumbnail modal.
 */
export function IconRail() {
  const isElementsPanelOpen = useEditorStore((s) => s.isElementsPanelOpen);
  const toggleElementsPanel = useEditorStore((s) => s.toggleElementsPanel);
  const isPhotosPanelOpen = useEditorStore((s) => s.isPhotosPanelOpen);
  const togglePhotosPanel = useEditorStore((s) => s.togglePhotosPanel);
  const openGridView = useEditorStore((s) => s.openGridView);
  const isBackgroundPanelOpen = useEditorStore((s) => s.isBackgroundPanelOpen);
  const toggleBackgroundPanel = useEditorStore((s) => s.toggleBackgroundPanel);
  const isDetailsPanelOpen = useEditorStore((s) => s.isDetailsPanelOpen);
  const toggleDetailsPanel = useEditorStore((s) => s.toggleDetailsPanel);
  const isPresentationsPanelOpen = useEditorStore((s) => s.isPresentationsPanelOpen);
  const togglePresentationsPanel = useEditorStore((s) => s.togglePresentationsPanel);
  const slideCount = useEditorStore((s) => s.presentation.slides.length);

  return (
    <aside className="flex w-24 shrink-0 flex-col gap-1 border-r border-border-default bg-bg-surface px-1 py-3">
      <RailButton label="Elements" active={isElementsPanelOpen} onClick={toggleElementsPanel}>
        <ShapesIcon size={22} />
      </RailButton>
      <RailButton label="Photos" active={isPhotosPanelOpen} onClick={togglePhotosPanel}>
        <ImageIcon size={22} />
      </RailButton>
      <RailButton label="Slides" title={`Slides (${slideCount})`} onClick={openGridView}>
        <LayoutGridIcon size={22} />
      </RailButton>
      <RailButton label="Background" active={isBackgroundPanelOpen} onClick={toggleBackgroundPanel}>
        <PaintBucketIcon size={22} />
      </RailButton>
      <RailButton label="Details" active={isDetailsPanelOpen} onClick={toggleDetailsPanel}>
        <FileTextIcon size={22} />
      </RailButton>
      <RailButton label="Presentations" title="Slides from published presentations" active={isPresentationsPanelOpen} onClick={togglePresentationsPanel}>
        <BookOpenIcon size={22} />
      </RailButton>
    </aside>
  );
}

/** An ink icon on a soft tile; soft violet on hover, solid violet with a white icon while its panel is open. */
function RailButton({
  label,
  title,
  active,
  onClick,
  children,
}: {
  label: string;
  title?: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-keep-container-selection="true"
      onClick={onClick}
      title={title ?? label}
      className="group flex w-full flex-col items-center gap-2 rounded-dropdown py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-button transition-[transform,background-color] duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-110 ${
          active ? "bg-accent text-white" : "bg-bg-page text-text-primary group-hover:bg-accent-soft group-hover:text-accent"
        }`}
      >
        {children}
      </span>
      <span className={`w-full text-center text-[11px] leading-none tracking-tight ${active ? "font-semibold text-accent" : "font-medium text-text-primary"}`}>
        {label}
      </span>
    </button>
  );
}
