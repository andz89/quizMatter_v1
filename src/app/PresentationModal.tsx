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
import { PresentationModalContext, usePresentationChanges } from "./openPresentation";

// A presentation's own address: those links open in the modal (useOpenOnClick), not as a page.
const PRESENTATION_PATH = /^\/presentation\/[^/]+$/;

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
 * cards behind at once (announcePresentationChange) and refreshes the page behind when it closes.
 */
export function PresentationModalProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isPresenting = useEditorStore((s) => s.isPresenting);
  // `view` null = still loading.
  const [shown, setShown] = useState<{ id: string; view: PresentationViewData | null } | null>(null);
  // A box opened from inside it (Report) is on top.
  const [isNestedOpen, setNestedOpen] = useState(false);
  // Going to another page from inside it: the top line shows until that page opens.
  const [isLeaving, setIsLeaving] = useState(false);
  // Only the newest open counts (a second click while the first still loads).
  const requestRef = useRef(0);
  // The history entry Back takes away is still there.
  const hasEntryRef = useRef(false);
  // Something was saved or liked while it showed: the page behind is refreshed on close.
  const changedRef = useRef(false);
  // Our own Back (✕ / Escape) is on its way: the refresh waits for it to finish.
  const refreshAfterBackRef = useRef(false);
  // Our own Back from `leave` is on its way: that page opens once it's done.
  const leaveToRef = useRef<string | null>(null);

  usePresentationChanges(() => {
    if (shown) changedRef.current = true;
  });

  const hide = () => {
    requestRef.current++;
    setShown(null);
    setNestedOpen(false);
  };
  const refreshIfChanged = () => {
    if (changedRef.current) router.refresh();
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
    if (refreshAfterBackRef.current) {
      refreshAfterBackRef.current = false;
      router.refresh();
    }
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
    stopPresenting();
    setIsLeaving(false);
    hide();
  }, [pathname]);

  const open = async (id: string) => {
    const request = ++requestRef.current;
    if (!hasEntryRef.current) {
      window.history.pushState(null, "", window.location.href);
      hasEntryRef.current = true;
    }
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
      close();
      return;
    }
    setShown({ id, view });
  };

  const close = () => {
    hide();
    if (!hasEntryRef.current) {
      refreshIfChanged();
      return;
    }
    // Takes our history entry away; the popstate above then refreshes if needed.
    hasEntryRef.current = false;
    refreshAfterBackRef.current = changedRef.current;
    changedRef.current = false;
    window.history.back();
  };

  const leave = (href: string) => {
    const target = new URL(href, window.location.href);
    // The page it's already on: just close it.
    if (target.pathname === window.location.pathname && target.search === window.location.search) {
      close();
      return;
    }
    setIsLeaving(true);
    if (!hasEntryRef.current) {
      router.push(href);
      return;
    }
    // The modal stays (with its spinners) until the new page opens; the pathname effect then hides it.
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

  return (
    <PresentationModalContext value={{ open, isOpen: shown !== null, leave, setNestedOpen }}>
      {children}
      {shown && (
        <Modal
          // A new presentation starts at the top of the box.
          key={shown.id}
          title={shown.view?.presentation.title || "Presentation"}
          onClose={close}
          // Escape while presenting belongs to the presentation; while Report is on top, to that box.
          canClose={!isPresenting && !isNestedOpen}
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
            <PeopleArtGate needed={usesPeopleArt(shown.view.presentation.slides)} fill>
              <div className="px-5 pt-14 pb-6 sm:px-8 sm:pt-8 sm:pb-8" onClickCapture={onLinkClick}>
                <PresentationDetails view={shown.view} inModal />
              </div>
            </PeopleArtGate>
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
