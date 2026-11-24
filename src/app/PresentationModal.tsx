"use client";

import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { XIcon } from "lucide-react";
import { Modal } from "@/components/Modal";
import { PeopleArtGate } from "@/components/PeopleArtGate";
import { Spinner } from "@/components/Spinner";
import { usesPeopleArt } from "@/lib/peopleArt";
import { useEditorStore } from "@/lib/store";
import { openPresentation } from "./presentation/[id]/actions";
import type { PresentationViewData } from "./presentation/[id]/loadView";
import { PresentationDetails } from "./presentation/[id]/PresentationDetails";
import { OpenPresentationContext } from "./openPresentation";

/**
 * The modal a card of someone else's presentation opens (spec: docs/superpowers/specs/2026-11-25-presentation-
 * modal-design.md), in the root layout. The address never changes, so a reload just reloads the page behind it.
 * Opening adds one history entry (same address), so Back closes it. It closes by itself when the page changes (a
 * link inside it, Make a copy). A Save or Like inside it refreshes the page behind when it closes, so the cards there
 * show it.
 */
export function PresentationModalProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isPresenting = useEditorStore((s) => s.isPresenting);
  // `view` null = still loading.
  const [shown, setShown] = useState<{ id: string; view: PresentationViewData | null } | null>(null);
  // Only the newest open counts (a second click while the first still loads).
  const requestRef = useRef(0);
  // The history entry Back takes away is still there.
  const hasEntryRef = useRef(false);
  // Something was saved or liked inside: the page behind is refreshed on close.
  const changedRef = useRef(false);

  const hide = () => {
    requestRef.current++;
    setShown(null);
  };
  const refreshIfChanged = () => {
    if (changedRef.current) router.refresh();
    changedRef.current = false;
  };

  // Our own Back (✕ / Escape) is on its way: the refresh waits for it to finish.
  const refreshAfterBackRef = useRef(false);

  // The browser's Back closes it; ours (from close) only needs its refresh. Added once (re-adding it on every render
  // could miss a Back), reading the newest state when Back happens.
  const onPopState = useEffectEvent(() => {
    if (refreshAfterBackRef.current) {
      refreshAfterBackRef.current = false;
      router.refresh();
    }
    if (!hasEntryRef.current) return;
    hasEntryRef.current = false;
    hide();
    refreshIfChanged();
  });
  useEffect(() => {
    const handlePopState = () => onPopState();
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Another page opened (a link inside the modal): it's gone, and its history entry stays behind that page.
  const lastPathRef = useRef(pathname);
  useEffect(() => {
    if (lastPathRef.current === pathname) return;
    lastPathRef.current = pathname;
    hasEntryRef.current = false;
    changedRef.current = false;
    requestRef.current++;
    setShown(null);
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
    // A box opened from it (Report) is on top: Escape closes only that one.
    if (document.querySelectorAll('[role="dialog"]').length > 1) return;
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

  return (
    <OpenPresentationContext value={open}>
      {children}
      {shown && (
        <Modal
          // A new presentation starts at the top of the box.
          key={shown.id}
          title={shown.view?.presentation.title || "Presentation"}
          onClose={close}
          // Escape while presenting belongs to the presentation.
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
            <PeopleArtGate needed={usesPeopleArt(shown.view.presentation.slides)} fill>
              <div className="px-5 pt-14 pb-6 sm:px-8 sm:pt-8 sm:pb-8">
                <PresentationDetails view={shown.view} inModal onChange={() => (changedRef.current = true)} />
              </div>
            </PeopleArtGate>
          ) : (
            <div className="flex h-[60vh] items-center justify-center">
              <Spinner size={32} />
            </div>
          )}
        </Modal>
      )}
    </OpenPresentationContext>
  );
}
