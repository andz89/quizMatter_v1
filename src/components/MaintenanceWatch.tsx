"use client";

import { useEffect } from "react";
import { MAINTENANCE_CODE, MAINTENANCE_EVENT, MAINTENANCE_HEADER } from "@/lib/maintenance";

// The maintenance page itself, and login (it logs anyone but the super admin out itself, see mayLogInNow there).
const STAYS = ["/maintenance", "/login"];

/**
 * Sends a tab that was already open to /maintenance when maintenance starts. Every request of the page goes through
 * the browser's fetch (server actions, in-app page loads, Supabase calls), so this wraps it once and looks at the
 * answers: the proxy's 503 with the maintenance header, or the database guard's 503 with code QMMNT (Supabase is
 * another site, so its headers can't be read, only the body). Before leaving it sends MAINTENANCE_EVENT, so the editor
 * keeps unsaved work in the browser (it comes back when the presentation opens again). In the root layout once.
 */
export function MaintenanceWatch() {
  useEffect(() => {
    const originalFetch = window.fetch;
    let isLeaving = false;

    const isMaintenance = async (response: Response) => {
      if (response.status !== 503) return false;
      if (response.headers.has(MAINTENANCE_HEADER)) return true;
      try {
        const body = await response.clone().json();
        return body?.code === MAINTENANCE_CODE;
      } catch {
        return false;
      }
    };

    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (!isLeaving && !STAYS.includes(location.pathname) && (await isMaintenance(response))) {
        isLeaving = true;
        window.dispatchEvent(new Event(MAINTENANCE_EVENT));
        // A full page load on purpose: it leaves the editor's state behind (its unsaved work is kept first).
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/maintenance");
      }
      return response;
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
