"use client";

import { useEffect, useEffectEvent, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { XIcon } from "lucide-react";
import { Modal } from "@/components/Modal";
import { PeopleArtGate } from "@/components/PeopleArtGate";
import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";
import { usesPeopleArt } from "@/lib/peopleArt";
import { useEditorStore } from "@/lib/store";
import { openPresentation } from "./presentation/[id]/actions";
import type { PresentationViewData } from "./presentation/[id]/loadView";
import { PresentationDetails } from "./presentation/[id]/PresentationDetails";
import {
  PresentationModalContext,
  PresentationModalOpenContext,
  usePresentationChanges,
  type PresentationModalApi,
} from "./openPresentation";

// A presentation's own address: those links open in the modal (useOpenOnClick), not as a page.
const PRESENTATION_PATH = /^\/presentation\/[^/]+$/;

// The last presentations opened are remembered for a short while, so clicking one again shows it at once without
// asking the server. Only in this tab's memory; another page (or a reload) starts empty.
const REMEMBER_COUNT = 10;
const REMEMBER_MS = 5 * 60 * 1000;
// Only called on a click (open), never while drawing.
const clockNow = () => Date.now();
const isRecent = (at: number) => clockNow() - at < REMEMBER_MS;
// Right after opening, a click outside doesn't close it: a double-click's second click lands on the backdrop.
// (Escape and ✕ always close.)
const OPEN_GRACE_MS = 500;

/** Presenting ends (and fullscreen with it) when the modal goes away under it (the browser's Back). */
function stopPresenting() {
  const store = useEditorStore.getState();
  if (!store.isPresenting) return;
  store.exitPresentation();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

/**
 * The modal a card of someone else's presentation opens (spec: docs/superpowers/specs/2026-11-25-presentation-
 * modal-design.md), in the root layout. The address never changes, so a reload just reloads the page behind it.
 * Opening adds one history entry (same address), so Back closes it. Going to another page from inside it (a link,
 * Make a copy) takes that entry away first (`leave`), so one Back returns to the list. A Save or Like updates the
 * cards behind at once (announcePresentationChange) and refreshes the page behind when it closes. The pages get one
 * steady `PresentationModalApi` (cards don't redraw on open / close) and `isOpen` from its own context.
 */
export function PresentationModalProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isPresenting = useEditorStore((s) => s.isPresenting);
  // `view` null = still loading.
  const [shown, setShown] = useState<{ id: string; view: PresentationViewData | null } | null>(null);
  // Going to another page from inside it: the top line shows until that page opens.
  const [isLeaving, setIsLeaving] = useState(false);
  // Only the newest open counts (a second click while the first still loads).
  const requestRef = useRef(0);
  // The history entry Back takes away is still there.
  const hasEntryRef = useRef(false);
  // Something was saved or liked while it showed: the page behind is refreshed on close.
  const changedRef = useRef(false);
  // Our own Back (✕ / Escape) is on its way: the browser does it a moment later, and its popstate is ours, not a
  // Back that closes a modal opened meanwhile.
  const backPendingRef = useRef(false);
  // …and once it's done: refresh the page behind (something changed) / add the entry of a modal opened meanwhile.
  const refreshAfterBackRef = useRef(false);
  const pushAfterBackRef = useRef(false);
  // When it opened (see OPEN_GRACE_MS).
  const openedAtRef = useRef(0);
  // Our own Back from `leave` is on its way: that page opens once it's done.
  const leaveToRef = useRef<string | null>(null);
  // The remembered presentations, the one opened longest ago first (see REMEMBER_COUNT).
  const rememberedRef = useRef(new Map<string, { view: PresentationViewData; at: number }>());

  usePresentationChanges(({ id, isSaved, isLiked }) => {
    if (shown) changedRef.current = true;
    // A remembered copy keeps the newest Save / Like, so opening it again shows them right.
    const remembered = rememberedRef.current.get(id);
    if (!remembered) return;
    const view = { ...remembered.view };
    if (isSaved !== undefined) view.isSaved = isSaved;
    if (isLiked !== undefined && isLiked !== view.isLiked) {
      view.isLiked = isLiked;
      view.likeCount = Math.max(view.likeCount + (isLiked ? 1 : -1), 0);
    }
    remembered.view = view;
  });

  const hide = () => {
    requestRef.current++;
    setShown(null);
  };
  // A tick later, after Next's own Back handling (its popstate listener runs after ours and would undo it).
  const refreshSoon = () => setTimeout(() => router.refresh(), 0);
  const refreshIfChanged = () => {
    if (changedRef.current) refreshSoon();
    changedRef.current = false;
  };

  // The browser's Back closes it; ours (from close / leave) only needs what comes after it. Added once (re-adding it
  // on every render could miss a Back), reading the newest state when Back happens.
  const onPopState = useEffectEvent(() => {
    if (leaveToRef.current) {
      const href = leaveToRef.current;
      leaveToRef.current = null;
      // After Next's own Back handling (its listener runs after this one and would undo a push made now).
      setTimeout(() => router.push(href), 0);
      return;
    }
    if (backPendingRef.current) {
      backPendingRef.current = false;
      if (refreshAfterBackRef.current) refreshSoon();
      refreshAfterBackRef.current = false;
      // A card was clicked before our Back was done: its modal gets its entry now.
      if (pushAfterBackRef.current) {
        pushAfterBackRef.current = false;
        window.history.pushState(null, "", window.location.href);
        hasEntryRef.current = true;
      }
      return;
    }
    // The browser's own Back.
    if (!hasEntryRef.current) return;
    hasEntryRef.current = false;
    stopPresenting();
    hide();
    refreshIfChanged();
  });
  useEffect(() => {
    const handlePopState = () => onPopState();
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Another page opened (after `leave`, or a link the modal didn't catch): it's gone.
  const lastPathRef = useRef(pathname);
  useEffect(() => {
    if (lastPathRef.current === pathname) return;
    lastPathRef.current = pathname;
    hasEntryRef.current = false;
    changedRef.current = false;
    leaveToRef.current = null;
    backPendingRef.current = false;
    refreshAfterBackRef.current = false;
    pushAfterBackRef.current = false;
    rememberedRef.current.clear();
    stopPresenting();
    setIsLeaving(false);
    hide();
  }, [pathname]);

  const open = async (id: string, { fresh = false }: { fresh?: boolean } = {}) => {
    const request = ++requestRef.current;
    // What it showed before (a lesson or suggestion clicked inside): a failed load goes back to it.
    const previous = shown?.view ? shown : null;
    if (!previous) openedAtRef.current = clockNow();
    if (backPendingRef.current) pushAfterBackRef.current = true;
    else if (!hasEntryRef.current) {
      window.history.pushState(null, "", window.location.href);
      hasEntryRef.current = true;
    }
    const remembered = rememberedRef.current;
    const kept = remembered.get(id);
    if (kept && !fresh && isRecent(kept.at)) {
      // Opened again: it becomes the newest, so the one opened longest ago is forgotten first.
      remembered.delete(id);
      remembered.set(id, kept);
      setShown({ id, view: kept.view });
      return;
    }
    remembered.delete(id);
    setShown({ id, view: null });
    let view: PresentationViewData | null | undefined;
    try {
      view = await openPresentation(id);
    } catch {
      view = undefined;
    }
    if (request !== requestRef.current) return;
    if (!view) {
      toast.error(view === null ? "This presentation isn't available anymore." : "Couldn't open the presentation. Please try again.");
      if (previous && previous.id !== id) setShown(previous);
      else close();
      return;
    }
    remembered.set(id, { view, at: clockNow() });
    // Only the newest few (a Map keeps the order they were added).
    if (remembered.size > REMEMBER_COUNT) remembered.delete(remembered.keys().next().value!);
    setShown({ id, view });
  };

  const close = () => {
    hide();
    // Closed again before our Back was done: no entry to add.
    pushAfterBackRef.current = false;
    if (!hasEntryRef.current) {
      refreshIfChanged();
      return;
    }
    // Takes our history entry away; the popstate above then refreshes if needed.
    hasEntryRef.current = false;
    backPendingRef.current = true;
    refreshAfterBackRef.current = changedRef.current;
    changedRef.current = false;
    window.history.back();
  };
  // A click outside: not in the first moment, so a double-click's second click doesn't close it at once.
  const closeFromOutside = () => {
    if (clockNow() - openedAtRef.current < OPEN_GRACE_MS) return;
    close();
  };

  const leave = (href: string) => {
    const target = new URL(href, window.location.href);
    // The page it's already on: just close it.
    if (target.pathname === window.location.pathname && target.search === window.location.search) {
      close();
      return;
    }
    // Only the search words change (same page): the pathname effect won't see it, so the modal goes now.
    const samePage = target.pathname === window.location.pathname;
    if (samePage) hide();
    else setIsLeaving(true);
    if (!hasEntryRef.current) {
      router.push(href);
      return;
    }
    // Another page: the modal stays (with its spinners) until it opens; the pathname effect then hides it.
    hasEntryRef.current = false;
    changedRef.current = false;
    leaveToRef.current = href;
    window.history.back();
  };

  // A plain click on a link to another page inside the modal goes through `leave`. Links to a presentation open in
  // the modal (their own onClick), and new-tab links are left alone.
  const onLinkClick = (event: MouseEvent) => {
    const link = (event.target as HTMLElement).closest("a");
    if (!link || link.target === "_blank" || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin || PRESENTATION_PATH.test(url.pathname)) return;
    event.preventDefault();
    leave(url.pathname + url.search + url.hash);
  };

  // One steady object for the pages, calling the newest open / leave (set after each render).
  const latestRef = useRef({ open, leave });
  useEffect(() => {
    latestRef.current = { open, leave };
  });
  const [api] = useState<PresentationModalApi>(() => ({
    open: (id, options) => latestRef.current.open(id, options),
    leave: (href) => latestRef.current.leave(href),
  }));

  return (
    <PresentationModalContext value={api}>
      <PresentationModalOpenContext value={shown !== null}>{children}</PresentationModalOpenContext>
      {shown && (
        <Modal
          // A new presentation starts at the top of the box.
          key={shown.id}
          title={shown.view?.presentation.title || "Presentation"}
          onClose={close}
          onOutsideClick={closeFromOutside}
          // Escape while presenting belongs to the presentation. (A box on top, like Report, gets Escape by itself.)
          canClose={!isPresenting}
          hideHeader
          noPadding
          width={1280}
          corner={
            <button
              type="button"
              onClick={close}
              title="Close"
              aria-label="Close"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border-default bg-bg-surface text-text-primary transition-colors hover:bg-bg-page"
            >
              <XIcon size={18} />
            </button>
          }
        >
          {shown.view ? (
            // At least as tall as the loading box, so the people art's wait (or its Try again) fills it, not a strip.
            <div className="grid min-h-[60vh]">
              <PeopleArtGate needed={usesPeopleArt(shown.view.presentation.slides)} fill>
                <div className="px-5 pt-14 pb-6 sm:px-8 sm:pt-8 sm:pb-8" onClickCapture={onLinkClick}>
                  <PresentationDetails view={shown.view} inModal />
                </div>
              </PeopleArtGate>
            </div>
          ) : (
            <div className="flex h-[60vh] items-center justify-center">
              <Spinner size={32} />
            </div>
          )}
        </Modal>
      )}
      {isLeaving && <TopLoadingBar />}
    </PresentationModalContext>
  );
}
