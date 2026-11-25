"use client";

import { createContext, useContext, useEffect, useEffectEvent, type MouseEvent } from "react";

/**
 * What the presentation modal (PresentationModalProvider, src/app/PresentationModal.tsx) gives the pages. The same
 * object for the whole visit, so the cards that read it don't redraw when the modal opens or closes.
 */
export type PresentationModalApi = {
  // Opens someone else's presentation in the modal. `fresh` skips the remembered copy (it changed since it opened).
  open: (id: string, options?: { fresh?: boolean }) => void;
  // Goes to another page from inside the modal (Make a copy, a profile link), taking the modal's Back entry away
  // first, so one Back returns to the list.
  leave: (href: string) => void;
};

export const PresentationModalContext = createContext<PresentationModalApi | null>(null);
// The modal is showing: the page behind leaves the arrow keys and presenting to it.
export const PresentationModalOpenContext = createContext(false);

/** The modal's tools, or null outside the provider. */
export function usePresentationModal() {
  return useContext(PresentationModalContext);
}

/** The modal is showing (the page under it then leaves the arrow keys and presenting to it). */
export function useIsPresentationModalOpen() {
  return useContext(PresentationModalOpenContext);
}

/**
 * For a link to someone else's presentation (a card, a "This week's lessons" row): a plain click opens it in the
 * modal instead of following the link. Ctrl/Shift/middle click still opens the link (the full page, in a new tab).
 * Outside the provider it does nothing, so the link works as before.
 */
export function useOpenOnClick() {
  const modal = usePresentationModal();
  return (event: MouseEvent, id: string) => {
    if (!modal || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    modal.open(id);
  };
}

/**
 * A presentation was saved / unsaved or liked / unliked somewhere (the modal, a card): every card of it on the page
 * shows it at once, so the bookmark or heart behind the modal is never stale. A like says only liked or not: each
 * heart that showed the other state adds or takes away one from its own count (counts loaded at different times
 * stay right).
 */
export type PresentationChange = { id: string; isSaved?: boolean; isLiked?: boolean };

const CHANGED = "qm:presentation-changed";

export function announcePresentationChange(change: PresentationChange) {
  window.dispatchEvent(new CustomEvent<PresentationChange>(CHANGED, { detail: change }));
}

/** Runs `onChange` for every announced change (added once, reading the newest props). */
export function usePresentationChanges(onChange: (change: PresentationChange) => void) {
  const handle = useEffectEvent((change: PresentationChange) => onChange(change));
  useEffect(() => {
    const listener = (event: Event) => handle((event as CustomEvent<PresentationChange>).detail);
    window.addEventListener(CHANGED, listener);
    return () => window.removeEventListener(CHANGED, listener);
  }, []);
}
