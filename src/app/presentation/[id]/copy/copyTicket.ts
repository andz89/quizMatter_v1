"use client";

import { useEffect, useEffectEvent } from "react";
import { createId } from "@/lib/id";

/**
 * Make a copy's two tabs talk through the browser's localStorage (shared by this site's tabs only, never another
 * site's). The button leaves a one-time ticket naming the copy's new id; the copy page saves only with it, under that
 * same id, so another site's link to /copy makes nothing and a reload never makes a second copy. When the copy can't
 * be made, the copy page leaves a result the first tab reads (a `storage` event), so it greys out its button (the
 * daily pause) or loads the presentation again (private or under review).
 */

const TICKET = "qm:copy-ticket:";
const RESULT = "qm:copy-result";
// A ticket nobody used (its tab was closed) is cleared when the next one is made.
const TICKET_MS = 60 * 60 * 1000;

export type CopyResult = { presentationId: string; kind: "private" | "locked" | "paused"; pausedUntil?: number };

/** The button: a ticket for a new copy of `presentationId`, and the copy page's address with it. */
export function copyPageHref(presentationId: string): string {
  const copyId = createId();
  const now = Date.now();
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(TICKET)) continue;
      const at = Number(JSON.parse(localStorage.getItem(key) ?? "{}").at);
      if (!(now - at < TICKET_MS)) localStorage.removeItem(key);
    }
    localStorage.setItem(TICKET + copyId, JSON.stringify({ presentationId, at: now }));
  } catch {
    // Storage is off (a private window's rules): the copy page then says the link didn't come from the button.
  }
  return `/presentation/${presentationId}/copy?as=${copyId}`;
}

/** The copy page: whether this tab holds the ticket for copying `presentationId` as `copyId`. */
export function hasCopyTicket(copyId: string, presentationId: string): boolean {
  try {
    const ticket = JSON.parse(localStorage.getItem(TICKET + copyId) ?? "null");
    return ticket?.presentationId === presentationId;
  } catch {
    return false;
  }
}

/** The copy page: the ticket is used up (the copy exists). */
export function removeCopyTicket(copyId: string) {
  try {
    localStorage.removeItem(TICKET + copyId);
  } catch {
    // Nothing to clear.
  }
}

/** The copy page: tells the first tab why there's no copy. */
export function sendCopyResult(result: CopyResult) {
  try {
    // A new value each time, so the same result twice still fires the other tab's `storage` event.
    localStorage.setItem(RESULT, JSON.stringify({ ...result, at: Date.now() }));
  } catch {
    // The first tab just isn't told.
  }
}

/** The first tab: runs `onResult` when a copy page reports on `presentationId`. */
export function useCopyResults(presentationId: string, onResult: (result: CopyResult) => void) {
  const handle = useEffectEvent(onResult);
  useEffect(() => {
    const listener = (event: StorageEvent) => {
      if (event.key !== RESULT || !event.newValue) return;
      try {
        const result = JSON.parse(event.newValue) as CopyResult;
        if (result.presentationId === presentationId) handle(result);
      } catch {
        // Not ours.
      }
    };
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  }, [presentationId]);
}
