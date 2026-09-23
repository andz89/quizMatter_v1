"use client";

import type { ReactNode } from "react";
import { useEditorStore } from "@/lib/store";
import { ElementsIcon } from "@/components/icons/ElementsIcon";
import { GridIcon } from "@/components/icons/GridIcon";

/** Canva-style narrow icon bar: "Elements" expands the sidebar panel, "Slides" opens the thumbnail modal. */
export function IconRail() {
  const isElementsPanelOpen = useEditorStore((s) => s.isElementsPanelOpen);
  const toggleElementsPanel = useEditorStore((s) => s.toggleElementsPanel);
  const openGridView = useEditorStore((s) => s.openGridView);
  const slideCount = useEditorStore((s) => s.quiz.slides.length);

  return (
    <aside className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-border-default bg-bg-surface py-3">
      <RailButton label="Elements" active={isElementsPanelOpen} onClick={toggleElementsPanel}>
        <ElementsIcon size={20} />
      </RailButton>
      <RailButton label="Slides" title={`Slides (${slideCount})`} onClick={openGridView}>
        <GridIcon size={20} />
      </RailButton>
    </aside>
  );
}

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
      className="flex h-14 w-14 flex-col items-center justify-center gap-1 rounded-dropdown transition-colors hover:bg-bg-page"
      style={{ color: active ? "var(--accent-navy)" : "var(--text-primary)", background: active ? "var(--bg-page)" : undefined }}
    >
      {children}
      <span className="text-[10px] font-medium leading-none">{label}</span>
    </button>
  );
}
