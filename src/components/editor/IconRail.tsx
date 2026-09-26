"use client";

import type { ReactNode } from "react";
import { useEditorStore } from "@/lib/store";
import { ElementsIcon } from "@/components/icons/ElementsIcon";
import { GridIcon } from "@/components/icons/GridIcon";
import { BackgroundIcon } from "@/components/icons/BackgroundIcon";
import { DetailsIcon } from "@/components/icons/DetailsIcon";
import { LessonsIcon } from "@/components/icons/LessonsIcon";

/**
 * Canva-style narrow icon bar: "Elements", "Background", "Details" and "Lessons" expand their sidebar panels,
 * "Slides" opens the thumbnail modal.
 */
export function IconRail() {
  const isElementsPanelOpen = useEditorStore((s) => s.isElementsPanelOpen);
  const toggleElementsPanel = useEditorStore((s) => s.toggleElementsPanel);
  const openGridView = useEditorStore((s) => s.openGridView);
  const isBackgroundPanelOpen = useEditorStore((s) => s.isBackgroundPanelOpen);
  const toggleBackgroundPanel = useEditorStore((s) => s.toggleBackgroundPanel);
  const isDetailsPanelOpen = useEditorStore((s) => s.isDetailsPanelOpen);
  const toggleDetailsPanel = useEditorStore((s) => s.toggleDetailsPanel);
  const isLessonsPanelOpen = useEditorStore((s) => s.isLessonsPanelOpen);
  const toggleLessonsPanel = useEditorStore((s) => s.toggleLessonsPanel);
  const slideCount = useEditorStore((s) => s.quiz.slides.length);

  return (
    <aside className="flex w-20 shrink-0 flex-col gap-1.5 border-r-2 border-border-default bg-bg-surface px-1.5 py-3">
      <RailButton label="Elements" hue={300} active={isElementsPanelOpen} onClick={toggleElementsPanel}>
        <ElementsIcon size={24} />
      </RailButton>
      <RailButton label="Slides" hue={30} title={`Slides (${slideCount})`} onClick={openGridView}>
        <GridIcon size={24} />
      </RailButton>
      <RailButton label="Background" hue={175} active={isBackgroundPanelOpen} onClick={toggleBackgroundPanel}>
        <BackgroundIcon size={24} />
      </RailButton>
      <RailButton label="Details" hue={250} active={isDetailsPanelOpen} onClick={toggleDetailsPanel}>
        <DetailsIcon size={24} />
      </RailButton>
      <RailButton label="Lessons" hue={140} title="Slides from published lessons" active={isLessonsPanelOpen} onClick={toggleLessonsPanel}>
        <LessonsIcon size={24} />
      </RailButton>
    </aside>
  );
}

/** Each button has its own hue: a pale tile normally, a solid tile with a white icon when active. */
function RailButton({
  label,
  hue,
  title,
  active,
  onClick,
  children,
}: {
  label: string;
  hue: number;
  title?: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const solid = `oklch(0.6 0.19 ${hue})`;

  return (
    <button
      type="button"
      data-keep-container-selection="true"
      onClick={onClick}
      title={title ?? label}
      className="group flex flex-col items-center gap-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-navy"
    >
      <span
        className="flex h-10 w-10 items-center justify-center rounded-full transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-115"
        style={{
          background: active ? solid : `oklch(0.94 0.045 ${hue})`,
          color: active ? "#fff" : solid,
          // White gap, then an outer ring in the same color.
          boxShadow: active ? `0 0 0 2px #fff, 0 0 0 4px ${solid}` : undefined,
        }}
      >
        {children}
      </span>
      <span
        className={`text-[11px] leading-none ${active ? "font-bold" : "font-medium text-text-primary"}`}
        style={active ? { color: `oklch(0.42 0.15 ${hue})` } : undefined}
      >
        {label}
      </span>
    </button>
  );
}
