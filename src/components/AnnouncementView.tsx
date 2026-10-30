"use client";

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { MegaphoneIcon, XIcon } from "lucide-react";
import { isInternalLink, toSafeAnnouncementHtml } from "@/lib/announcementText";
import type { AnnouncementPart } from "@/lib/announcements";
import { Modal } from "./Modal";

// How an announcement looks (root CLAUDE.md, "Announcements"): what teachers see (AnnouncementsWatch) and the
// admin's preview (Admin → Announcements).

/** Seconds left before the close button shows; counts down from `closeAfter` once it's on screen. */
function useCloseCountdown(closeAfter: number) {
  const [left, setLeft] = useState(closeAfter);
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  return left;
}

/**
 * The saved text, made safe first (toSafeAnnouncementHtml needs the browser's DOM, so it's filled in here, not in
 * JSX). Links into QuizMatter open in the same tab; other sites in a new tab.
 */
function AnnouncementText({ html, part, className }: { html: string; part: AnnouncementPart; className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useLayoutEffect(() => {
    if (!ref.current) return;
    // An empty paragraph (a blank line) gets a <br>, as the editor gives it, so it keeps one line of height.
    ref.current.innerHTML = toSafeAnnouncementHtml(html, part).replace(/<p([^>]*)><\/p>/g, "<p$1><br></p>");
    for (const link of ref.current.querySelectorAll("a")) {
      if (isInternalLink(link.getAttribute("href") ?? "")) {
        link.removeAttribute("target");
        link.removeAttribute("rel");
      } else {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
    }
  }, [html, part]);

  // An in-app link moves inside the app (no full page load), unless it's opened in a new tab (Ctrl, middle click).
  const handleClick = (e: MouseEvent) => {
    const href = (e.target as HTMLElement).closest("a")?.getAttribute("href");
    if (!href || !isInternalLink(href) || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    router.push(href);
  };

  return (
    <div
      ref={ref}
      onClick={handleClick}
      className={`break-words [&_a]:font-semibold [&_a]:text-accent [&_a]:underline [&_img]:my-2 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-dropdown ${className}`}
    />
  );
}

/** The modal part: the app's Modal, with "You can close this in N…" until its close button may show. */
export function AnnouncementModal({ html, closeAfter, onClose }: { html: string; closeAfter: number; onClose: () => void }) {
  const left = useCloseCountdown(closeAfter);
  const canClose = left <= 0;
  return (
    <Modal
      title="Announcement"
      onClose={onClose}
      canClose={canClose}
      footer={
        canClose ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            Close
          </button>
        ) : (
          <span className="py-2 text-sm text-text-secondary">You can close this in {left}…</span>
        )
      }
    >
      <AnnouncementText html={html} part="modal" className="text-sm text-text-primary" />
    </Modal>
  );
}

/**
 * The bar part: a violet strip at the top of the page, or (`isFloating`, for the editor, which fills the screen) a
 * card; the parent places floating cards at the bottom. ✕ shows after the countdown.
 */
export function AnnouncementBar({
  html,
  closeAfter,
  onClose,
  isFloating = false,
}: {
  html: string;
  closeAfter: number;
  onClose: () => void;
  isFloating?: boolean;
}) {
  const left = useCloseCountdown(closeAfter);
  return (
    <div
      className={`flex items-center gap-2 bg-accent-soft text-sm text-text-primary ${
        isFloating
          ? "w-[min(560px,calc(100vw-32px))] rounded-card border border-border-default px-4 py-3"
          : "justify-center px-4 py-2"
      }`}
    >
      <MegaphoneIcon size={16} className="shrink-0 text-accent" />
      <AnnouncementText html={html} part="bar" className={isFloating ? "min-w-0 flex-1" : "min-w-0"} />
      {left > 0 ? (
        <span title="You can close this soon" className="w-5 shrink-0 text-center text-[12px] text-text-secondary">
          {left}
        </span>
      ) : (
        <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 rounded-dropdown p-0.5 hover:bg-bg-surface">
          <XIcon size={16} />
        </button>
      )}
    </div>
  );
}
