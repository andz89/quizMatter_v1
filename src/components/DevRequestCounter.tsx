"use client";

import { useEffect, useRef, useState } from "react";
import { ActivityIcon, Maximize2Icon, Minimize2Icon, MinusIcon, RotateCcwIcon } from "lucide-react";

// Only shows on these addresses, never on quizmatter.com.
const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

// The dev server's own live-reload requests, left out so they don't hide the app's.
const DEV_ONLY = ["/_next/webpack-hmr", "__nextjs", ".hot-update."];

const SUPABASE_HOST = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host;

// How many of the newest requests the list shows.
const LIST_SIZE = 15;

type Where = "site" | "photos" | "supabase" | "other";
// `ms`: how long it took. `bytes`: how much came over the network (0 when another site hides it).
type Request = { id: number; where: Where; label: string; url: string; kind: string; ms: number; bytes: number };

const WHERE_LABELS: Record<Where, string> = { site: "This site", photos: "Photos", supabase: "Supabase", other: "Other" };
// Next to each count, so it's clear what it means on the live site.
const WHERE_NOTES: Partial<Record<Where, string>> = {
  site: "Cloudflare counts these",
  photos: "images.quizmatter.com and /cdn-cgi/image",
};

/**
 * A small box in the top-right corner, on localhost only: how many requests the browser sent since the page loaded
 * and since the last click, split by where they went ("This site" is what Cloudflare's rate limit counts), and the
 * newest ones. Full screen shows every request in a table. It reads the browser's own list of requests (PerformanceObserver), so nothing in the app changes.
 */
export function DevRequestCounter() {
  const [isLocal, setIsLocal] = useState(false);
  // Starts minimized; open it when needed.
  const [isOpen, setIsOpen] = useState(false);
  // Fills the screen, with every request in a table.
  const [isFull, setIsFull] = useState(false);
  const [requests, setRequests] = useState<Request[]>([]);
  // Where "since last click" starts: the number of requests seen before the click.
  const [clickStart, setClickStart] = useState(0);
  // Where it was dragged to (px from the top-left); null = the top-right corner.
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLElement>(null);
  const countRef = useRef(0);
  // While dragging: where in the box it was grabbed, and the box's size (to keep it on screen).
  const dragRef = useRef<{ startX: number; startY: number; grabX: number; grabY: number; width: number; height: number } | null>(null);
  // The small pill is a button: a drag shouldn't also count as a click that opens it.
  const wasDraggedRef = useRef(false);

  useEffect(() => {
    // Reading the address after the page loaded keeps the server and browser drawings the same.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- runs once, on load
    setIsLocal(LOCAL_HOSTS.includes(location.hostname));
  }, []);

  useEffect(() => {
    if (!isLocal) return;
    // The browser keeps 250 by default; a busy page can pass that.
    performance.setResourceTimingBufferSize(5000);

    const observer = new PerformanceObserver((list) => {
      const added = list
        .getEntries()
        .map((entry) => toRequest(entry as PerformanceResourceTiming))
        .filter((request): request is Omit<Request, "id"> => request !== null)
        .map((request) => ({ ...request, id: countRef.current++ }));
      if (added.length > 0) setRequests((old) => [...old, ...added]);
    });
    // `buffered`: also the requests made before this box appeared.
    observer.observe({ type: "resource", buffered: true });

    // Any click in the app (not on this box) starts "since last click" again.
    const onPointerDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setClickStart(countRef.current);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [isLocal]);

  if (!isLocal) return null;

  const startDrag = (e: React.PointerEvent<HTMLElement>) => {
    // The Reset and Make small buttons in the top bar still work as buttons (the pill itself is one, and drags).
    const button = (e.target as HTMLElement).closest("button");
    if (button && button !== e.currentTarget) return;
    const box = boxRef.current!.getBoundingClientRect();
    dragRef.current = { startX: e.clientX, startY: e.clientY, grabX: e.clientX - box.left, grabY: e.clientY - box.top, width: box.width, height: box.height };
    wasDraggedRef.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const drag = (e: React.PointerEvent<HTMLElement>) => {
    const grab = dragRef.current;
    // A wobble of a few px during a click isn't a drag.
    if (!grab || (!wasDraggedRef.current && Math.hypot(e.clientX - grab.startX, e.clientY - grab.startY) < 3)) return;
    wasDraggedRef.current = true;
    setPosition({
      x: Math.min(Math.max(e.clientX - grab.grabX, 0), window.innerWidth - grab.width),
      y: Math.min(Math.max(e.clientY - grab.grabY, 0), window.innerHeight - grab.height),
    });
  };
  const dragHandlers = { onPointerDown: startDrag, onPointerMove: drag, onPointerUp: () => (dragRef.current = null) };
  const place = position ? "fixed" : "fixed top-[65px] right-4";
  const placeStyle = position ? { left: position.x, top: position.y } : undefined;

  const sinceClick = requests.filter((request) => request.id >= clickStart).length;
  const reset = () => {
    setRequests([]);
    setClickStart(countRef.current);
  };

  if (!isOpen) {
    return (
      <button
        ref={(el) => {
          boxRef.current = el;
        }}
        type="button"
        {...dragHandlers}
        onClick={() => !wasDraggedRef.current && setIsOpen(true)}
        style={placeStyle}
        className={`${place} z-50 flex cursor-grab touch-none items-center gap-2 rounded-dropdown border border-border-default bg-bg-surface px-3 py-1.5 text-[13px] font-semibold text-text-primary`}
      >
        <ActivityIcon size={14} className="text-accent" />
        Requests: {requests.length} · {sinceClick}
      </button>
    );
  }

  const counts = (Object.keys(WHERE_LABELS) as Where[]).map((where) => (
    <div key={where} className="flex items-center gap-2">
      <dt className="mr-auto">
        {WHERE_LABELS[where]}
        {WHERE_NOTES[where] && <span className="text-text-secondary"> ({WHERE_NOTES[where]})</span>}
      </dt>
      <dd className="font-semibold">{requests.filter((request) => request.where === where).length}</dd>
    </div>
  ));
  const resetButton = (
    <button type="button" onClick={reset} title="Reset" className={iconButtonClass}>
      <RotateCcwIcon size={14} />
    </button>
  );

  if (isFull) {
    return (
      <div
        ref={(el) => {
          boxRef.current = el;
        }}
        className="fixed inset-4 z-50 flex flex-col gap-4 rounded-card border border-border-default bg-bg-surface px-5 py-4 text-text-primary"
      >
        <div className="flex items-center gap-2">
          <ActivityIcon size={16} className="text-accent" />
          <span className="mr-auto text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">Requests (localhost)</span>
          {resetButton}
          <button type="button" onClick={() => setIsFull(false)} title="Exit full screen" className={iconButtonClass}>
            <Minimize2Icon size={14} />
          </button>
        </div>

        <div className="flex flex-wrap gap-6">
          <dl className="grid w-80 grid-cols-2 gap-2">
            <Count label="Since last click" value={sinceClick} />
            <Count label="Since page load" value={requests.length} />
          </dl>
          <dl className="flex min-w-64 flex-col gap-1 text-[13px]">{counts}</dl>
        </div>

        {/* Every request, newest first. */}
        <div className="min-h-0 flex-1 overflow-auto rounded-dropdown border border-border-default">
          <table className="w-full text-left text-[12px]">
            <thead className="sticky top-0 bg-bg-page text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Where</th>
                <th className="px-3 py-2">Address</th>
                <th className="px-3 py-2 text-right">Time</th>
                <th className="px-3 py-2 text-right">Size</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {requests.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-text-secondary">
                    None yet.
                  </td>
                </tr>
              )}
              {[...requests].reverse().map((request) => (
                <tr key={request.id} className={request.id >= clickStart ? "bg-accent-soft" : ""}>
                  <td className="px-3 py-1.5 text-text-secondary">{request.id + 1}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">{request.kind}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">{WHERE_LABELS[request.where]}</td>
                  <td className="px-3 py-1.5 break-all">{request.url}</td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">{Math.round(request.ms)} ms</td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">
                    {request.bytes ? `${(request.bytes / 1024).toFixed(1)} KB` : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[12px] text-text-secondary">Violet rows came after your last click.</p>
      </div>
    );
  }

  return (
    <div
      ref={(el) => {
        boxRef.current = el;
      }}
      style={placeStyle}
      className={`${place} z-50 w-80 max-w-[calc(100vw-2rem)] rounded-card border border-border-default bg-bg-surface px-4 py-3 text-text-primary`}
    >
      {/* The top bar is the handle for dragging the box anywhere on the page. */}
      <div {...dragHandlers} className="flex cursor-grab touch-none items-center gap-2">
        <ActivityIcon size={16} className="text-accent" />
        <span className="mr-auto text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">Requests (localhost)</span>
        {resetButton}
        <button type="button" onClick={() => setIsFull(true)} title="Full screen" className={iconButtonClass}>
          <Maximize2Icon size={14} />
        </button>
        <button type="button" onClick={() => setIsOpen(false)} title="Make small" className={iconButtonClass}>
          <MinusIcon size={14} />
        </button>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-2">
        <Count label="Since last click" value={sinceClick} />
        <Count label="Since page load" value={requests.length} />
      </dl>

      <dl className="mt-3 flex flex-col gap-1 text-[13px]">{counts}</dl>

      <p className="mt-3 text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">Newest</p>
      <ul className="mt-1 flex max-h-40 flex-col gap-0.5 overflow-y-auto text-[12px]">
        {requests.length === 0 && <li className="text-text-secondary">None yet.</li>}
        {requests
          .slice(-LIST_SIZE)
          .reverse()
          .map((request) => (
            <li key={request.id} className="flex gap-2">
              <span className="w-20 shrink-0 text-text-secondary">{request.kind}</span>
              <span className="truncate" title={request.label}>
                {request.label}
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}

/** One request from the browser's list, or null for one to leave out (dev server, or answered from the cache). */
function toRequest(entry: PerformanceResourceTiming): Omit<Request, "id"> | null {
  const url = new URL(entry.name);
  if (DEV_ONLY.some((part) => entry.name.includes(part))) return null;
  const isSite = url.origin === location.origin;
  // Answered from the browser's cache: it never left the computer, so Cloudflare didn't see it. (Only knowable for
  // this site's requests; other sites hide their sizes.)
  if (isSite && entry.transferSize === 0 && entry.decodedBodySize > 0) return null;

  // Slide photos: the full ones (images.quizmatter.com) and Cloudflare's small copies (/cdn-cgi/image/…).
  const isPhoto = url.hostname.endsWith("quizmatter.com") || url.pathname.startsWith("/cdn-cgi/image/");
  const where: Where = isPhoto ? "photos" : isSite ? "site" : url.host === SUPABASE_HOST ? "supabase" : "other";
  return {
    where,
    kind: kindOf(entry, url, where),
    label: where === "site" ? url.pathname + url.search : url.host + url.pathname,
    url: entry.name,
    ms: entry.duration,
    bytes: entry.transferSize,
  };
}

/** A guess at what the request was, from its address and what started it. */
function kindOf(entry: PerformanceResourceTiming, url: URL, where: Where): string {
  if (where === "photos") return url.pathname.startsWith("/cdn-cgi/image/") ? "small photo" : "photo";
  if (where === "supabase") return url.pathname.startsWith("/storage/") ? "photo" : url.pathname.startsWith("/auth/") ? "login" : "database";
  if (where === "site" && url.searchParams.has("_rsc")) return "page data";
  if (where === "site" && url.pathname.startsWith("/api/")) return "api";
  // A same-site fetch without _rsc is a Server Action (e.g. a bookmark save).
  if (where === "site" && (entry.initiatorType === "fetch" || entry.initiatorType === "xmlhttprequest")) return "action";
  if (entry.initiatorType === "img" || entry.initiatorType === "image") return "image";
  if (entry.initiatorType === "script") return "script";
  if (entry.initiatorType === "css" || entry.initiatorType === "link") return "style/font";
  return entry.initiatorType || "other";
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-dropdown bg-bg-page px-3 py-2">
      <dt className="text-[11px] text-text-secondary">{label}</dt>
      <dd className="font-heading text-xl font-extrabold">{value}</dd>
    </div>
  );
}

const iconButtonClass =
  "flex h-6 w-6 items-center justify-center rounded-dropdown text-text-primary transition-colors hover:bg-bg-page";
