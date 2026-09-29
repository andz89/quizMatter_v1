"use client";

import type { ReactNode } from "react";
import type { SlideType } from "@/lib/schema";
import { PanelLabel } from "./PanelControls";
import { HeadingIcon, ImageIcon, LayersIcon, ListChecksIcon, PresentationIcon, SquareCheckBigIcon, SquarePenIcon, SquarePlayIcon, TextCursorInputIcon } from "lucide-react";

// The Add slide menu, in labeled groups.
const SLIDE_TYPE_GROUPS: { label: string; types: { value: SlideType; label: string; icon: ReactNode }[] }[] = [
  {
    label: "Assessment slide",
    types: [
      { value: "choice", label: "Multiple choice", icon: <ListChecksIcon size={20} /> },
      { value: "short-answer", label: "Short answer", icon: <TextCursorInputIcon size={20} /> },
      { value: "true-false", label: "True or false", icon: <SquareCheckBigIcon size={20} /> },
      { value: "custom", label: "Custom question", icon: <SquarePenIcon size={20} /> },
    ],
  },
  {
    label: "Discussion",
    types: [
      { value: "title", label: "Title slide", icon: <HeadingIcon size={20} /> },
      { value: "blank", label: "Blank slide", icon: <PresentationIcon size={20} /> },
      { value: "video", label: "Embed video", icon: <SquarePlayIcon size={20} /> },
      { value: "embed-slides", label: "Embed slides", icon: <LayersIcon size={20} /> },
      { value: "image", label: "Embed image", icon: <ImageIcon size={20} /> },
    ],
  },
];

/** The pick-a-slide-type menu, shown inside a ToolPanelButton (slide toolbar + and the workspace's Add slide). */
export function AddSlideMenu({ onPick }: { onPick: (type: SlideType) => void }) {
  return (
    // Vertical menu (icon left, label right); -mx-4 lets the row hover reach the panel edges.
    <div className="-mx-4 flex w-56 flex-col">
      {SLIDE_TYPE_GROUPS.map((group, groupIndex) => (
        // A thin line splits each group from the one above.
        <div
          key={group.label}
          className={`flex flex-col py-1 ${groupIndex > 0 ? "mt-1 border-t border-border-default pt-3" : ""}`}
        >
          <div className="px-4 pb-1">
            <PanelLabel>{group.label}</PanelLabel>
          </div>
          {group.types.map((slideType) => (
            <button
              key={slideType.value}
              type="button"
              onClick={() => onPick(slideType.value)}
              className="flex items-center gap-3 whitespace-nowrap px-4 py-2.5 text-sm text-text-primary hover:bg-bg-page"
            >
              {slideType.icon}
              {slideType.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
