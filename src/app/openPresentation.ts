"use client";

import { createContext, useContext, useEffect, useEffectEvent, type MouseEvent } from "react";

/** What the presentation modal (PresentationModalProvider, src/app/PresentationModal.tsx) gives the pages. */
export type PresentationModalApi = {
  // Opens someone else's presentation in the modal. `fresh` skips the remembered copy (it changed since it opened).
  open: (id: string, options?: { fresh?: boolean }) => void;
  // The modal is showing: the page behind leaves the arrow keys and presenting to it.
  isOpen: boolean;
  // Goes to another page from inside the modal (Make a copy, a profile link), taking the modal's Back entry away
  // first, so one Back returns to the list.
  leave: (href: string) => void;
  // A box opened from inside the modal (Report) is on top: Escape and a click outside close only that box.
  setNestedOpen: (isOpen: boolean) => void;
};

export const PresentationModalContext = createContext<PresentationModalApi | null>(null);

/** The modal's tools, or null outside the provider. */
export function usePresentationModal() {
  return useContext(PresentationModalContext);
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

/** Tells the modal a box opened from inside it is showing (see setNestedOpen). */
export function useNestedDialog(isOpen: boolean) {
  const modal = usePresentationModal();
  const setNestedOpen = modal?.setNestedOpen;
  useEffect(() => {
    if (!isOpen || !setNestedOpen) return;
    setNestedOpen(true);
    return () => setNestedOpen(false);
  }, [isOpen, setNestedOpen]);
}

/**
 * A presentation was saved / unsaved or liked / unliked somewhere (the modal, a card): every card of it on the page
 * shows it at once, so the bookmark or heart behind the modal is never stale.
 */
export type PresentationChange = { id: string; isSaved?: boolean; isLiked?: boolean; likeCount?: number };

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
