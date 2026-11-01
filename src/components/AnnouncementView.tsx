"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { ExternalLinkIcon, MegaphoneIcon, PlayIcon, XIcon } from "lucide-react";
import {
  MODAL_SIZES,
  isInternalLink,
  sandboxedHtml,
  type BarFormat,
  type ModalAttachment,
  type ModalFormat,
  type ModalSize,
} from "@/lib/announcements";
import { facebookEmbedUrl, facebookPostWidth } from "@/lib/facebook";
import { youTubeWatchUrl } from "@/lib/youtube";
import { LinkifiedText } from "./LinkifiedText";
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
 * The bar's saved text, made safe first (toSafeAnnouncementHtml needs the browser's DOM, so it's filled in here, not
 * in JSX). Its code (Tiptap) is loaded only once a bar shows, so a teacher's page doesn't carry it for a modal or for
 * nothing. Links into QuizMatter open in the same tab; other sites in a new tab.
 */
function BarText({ html, className }: { html: string; className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    let isCurrent = true;
    void import("@/lib/announcementText").then(({ toSafeAnnouncementHtml }) => {
      if (!isCurrent || !ref.current) return;
      // Blank lines at the very start or end are left out (e.g. the one after a picture), so nothing adds space
      // there. A blank line in between gets a <br>, as the editor gives it, so it keeps one line of height.
      ref.current.innerHTML = toSafeAnnouncementHtml(html)
        .replace(/^(<p[^>]*><\/p>)+|(<p[^>]*><\/p>)+$/g, "")
        .replace(/<p([^>]*)><\/p>/g, "<p$1><br></p>");
      for (const link of ref.current.querySelectorAll("a")) {
        if (isInternalLink(link.getAttribute("href") ?? "")) {
          link.removeAttribute("target");
          link.removeAttribute("rel");
        } else {
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        }
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [html]);

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
      className={`break-words [&_a]:font-semibold [&_a]:text-accent [&_a]:underline ${className}`}
    />
  );
}

// Facebook's frames may run Facebook's player and open Facebook in a new tab; nothing else.
const FACEBOOK_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation";
const FACEBOOK_ALLOW = "autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share";
// Facebook's post box can't tell the page its height, so it gets a fixed one; a longer post scrolls inside.
const FACEBOOK_POST_HEIGHT = 500;

/**
 * The modal's attachment, as wide as the modal (`width`, no padding): our picture; a YouTube card (its thumbnail, our
 * own copy, in a 16:9 box with a play icon, then the title) that opens YouTube in a new tab; or a Facebook post /
 * video in Facebook's own frame (it loads from Facebook: see the Privacy Policy).
 */
export function AnnouncementAttachment({ attachment, width }: { attachment: ModalAttachment; width: number }) {
  if (attachment.kind === "facebook") {
    const src = facebookEmbedUrl(attachment, width);
    return (
      <div className="bg-bg-page">
        {attachment.video ? (
          <div className="relative aspect-video w-full bg-text-primary">
            <iframe
              src={src}
              title="Facebook video"
              sandbox={FACEBOOK_SANDBOX}
              allow={FACEBOOK_ALLOW}
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              className="absolute inset-0 h-full w-full border-0"
            />
          </div>
        ) : (
          // Facebook's post box is at least 350 px wide: in a narrower modal (Small, a phone) it scrolls sideways
          // instead of being cut off.
          <div className="flex overflow-x-auto">
            <iframe
              src={src}
              title="Facebook post"
              sandbox={FACEBOOK_SANDBOX}
              allow={FACEBOOK_ALLOW}
              referrerPolicy="strict-origin-when-cross-origin"
              style={{ width: facebookPostWidth(width), height: FACEBOOK_POST_HEIGHT }}
              className="mx-auto shrink-0 border-0"
            />
          </div>
        )}
        {/* School networks and blockers often stop Facebook's frame (an empty box); this still reaches the post. */}
        <a
          href={attachment.href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-5 py-3 text-sm font-semibold text-accent hover:underline"
        >
          <ExternalLinkIcon size={16} />
          Open on Facebook
        </a>
      </div>
    );
  }
  if (attachment.kind === "photo") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- our own R2 photo, already sized when it was uploaded.
      <img src={attachment.src} alt="" width={attachment.width} height={attachment.height} className="block h-auto w-full" />
    );
  }
  return (
    <a
      href={youTubeWatchUrl(attachment.video_id)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Watch on YouTube: ${attachment.title}`}
      className="group block bg-bg-page"
    >
      <span className="relative block aspect-video w-full overflow-hidden bg-text-primary">
        {/* eslint-disable-next-line @next/next/no-img-element -- our own R2 copy of the thumbnail. */}
        <img src={attachment.src} alt="" className="h-full w-full object-cover" />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-text-primary/70 text-white transition-colors group-hover:bg-accent">
            <PlayIcon size={26} fill="currentColor" className="ml-1" />
          </span>
        </span>
      </span>
      <span className="block px-5 py-3">
        <span className="block text-[11px] font-bold uppercase tracking-[0.05em] text-text-header">YouTube</span>
        <span className="mt-0.5 line-clamp-2 block text-sm font-semibold text-text-primary">
          {attachment.title || "Watch on YouTube"}
        </span>
      </span>
    </a>
  );
}

// The sealed box may run its own scripts and open links in a new tab, and nothing else: without allow-same-origin it
// is its own unknown site, so it can't reach QuizMatter's page, cookies, storage or the teacher's login; without
// allow-top-navigation, allow-forms and allow-modals it can't move this page, send forms or show alerts.
const SEALED_BOX_SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox";

/** The admin's HTML in the sealed box (sandboxedHtml), `height` px tall; taller content scrolls inside. */
function SealedBox({ html, height, className }: { html: string; height: number | undefined; className: string }) {
  return (
    <iframe
      srcDoc={sandboxedHtml(html)}
      sandbox={SEALED_BOX_SANDBOX}
      title="Announcement"
      referrerPolicy="no-referrer"
      style={{ height }}
      className={`block border-0 ${className}`}
    />
  );
}

/**
 * The modal part. A post: the app's Modal without its title row, at the chosen width (MODAL_SIZES; the height fits),
 * with the text (padding, links clickable) and then the attachment (edge to edge). An HTML modal (`format` "html"):
 * the admin's HTML in the sealed box (sandboxedHtml), edge to edge at the chosen `height`. "You can close this in N…"
 * until its close button may show.
 */
export function AnnouncementModal({
  text,
  attachment,
  format = "post",
  html = "",
  height,
  closeAfter,
  size,
  onClose,
}: {
  text: string;
  attachment: ModalAttachment | null;
  format?: ModalFormat;
  html?: string;
  height?: number;
  closeAfter: number;
  size: ModalSize;
  onClose: () => void;
}) {
  const left = useCloseCountdown(closeAfter);
  const canClose = left <= 0;
  const width = MODAL_SIZES.find((s) => s.key === size)?.width ?? MODAL_SIZES[MODAL_SIZES.length - 1].width;
  return (
    <Modal
      title="Announcement"
      onClose={onClose}
      canClose={canClose}
      hideHeader
      width={width}
      noPadding
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
      {format === "html" ? (
        <SealedBox html={html} height={height} className="w-full" />
      ) : (
        <>
          {text.trim() !== "" && (
            <p className="whitespace-pre-line break-words px-5 py-4 text-sm text-text-primary">
              <LinkifiedText text={text.trim()} />
            </p>
          )}
          {attachment && <AnnouncementAttachment attachment={attachment} width={width} />}
        </>
      )}
    </Modal>
  );
}

/**
 * The bar part: a violet strip at the top of the page, or (`isFloating`, for the editor, which fills the screen) a
 * card; the parent places floating cards at the bottom. ✕ shows after the countdown. A text bar shows the megaphone
 * and its cleaned text; an html bar (`format` "html") the admin's HTML in the sealed box, `height` px tall. The
 * countdown and ✕ stay outside the box, so the HTML can't cover them.
 */
export function AnnouncementBar({
  html,
  format = "text",
  height,
  closeAfter,
  onClose,
  isFloating = false,
}: {
  html: string;
  format?: BarFormat;
  height?: number;
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
      {format === "html" ? (
        <SealedBox html={html} height={height} className="min-w-0 flex-1" />
      ) : (
        <>
          <MegaphoneIcon size={16} className="shrink-0 text-accent" />
          <BarText html={html} className={isFloating ? "min-w-0 flex-1" : "min-w-0"} />
        </>
      )}
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
