"use client";

import { createContext, useContext, type MouseEvent } from "react";

/** Opens someone else's presentation in the modal (given by PresentationModalProvider, src/app/PresentationModal.tsx). */
export const OpenPresentationContext = createContext<((id: string) => void) | null>(null);

/**
 * For a link to someone else's presentation (a card, a "This week's lessons" row): a plain click opens it in the
 * modal instead of following the link. Ctrl/Shift/middle click still opens the link (the full page, in a new tab).
 * Outside the provider it does nothing, so the link works as before.
 */
export function useOpenOnClick() {
  const open = useContext(OpenPresentationContext);
  return (event: MouseEvent, id: string) => {
    if (!open || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    open(id);
  };
}
