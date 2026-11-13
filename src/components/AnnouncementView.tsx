"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { ExternalLinkIcon, MegaphoneIcon, PlayIcon, XCircleIcon, XIcon } from "lucide-react";
import {
  MODAL_SIZES,
  SEALED_BOX_ESCAPE,
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

/** True while the tab is in the background (another tab, or the window is minimized). */
function useIsTabHidden() {
  const [isHidden, setIsHidden] = useState(false);
  useEffect(() => {
    const handleChange = () => setIsHidden(document.visibilityState === "hidden");
    handleChange();
    document.addEventListener("visibilitychange", handleChange);
    return () => document.removeEventListener("visibilitychange", handleChange);
  }, []);
  return isHidden;
}

/**
 * Seconds left before the close button shows; counts down from `closeAfter` once it's on screen, and only while the
 * tab is in front, so the wait really happens (a teacher who switches tabs doesn't come back to a ✕ already there).
 */
function useCloseCountdown(closeAfter: number) {
  const [left, setLeft] = useState(closeAfter);
  const isTabHidden = useIsTabHidden();
  useEffect(() => {
    if (left <= 0 || isTabHidden) return;
    const timer = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [left, isTabHidden]);
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

  // An in-app link moves inside the app (no full page load), unless the browser should do its own thing with it: a
  // new tab or window (Ctrl, Cmd, Shift, middle click) or a download (Alt).
  const handleClick = (e: MouseEvent) => {
    const href = (e.target as HTMLElement).closest("a")?.getAttribute("href");
    if (!href || !isInternalLink(href) || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
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
    return (
      <div className="bg-bg-page">
        {attachment.video ? (
          <FacebookVideo attachment={attachment} />
        ) : (
          // Facebook's post box is at least 350 px wide: in a narrower modal (Small, a phone) it scrolls sideways
          // instead of being cut off.
          <div className="flex overflow-x-auto">
            <iframe
              src={facebookEmbedUrl(attachment, width)}
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

/**
 * A Facebook video, 16:9 and as wide as its box. Facebook's player is asked for the box's real width (a modal is
 * narrower than its size on a phone), so it isn't cut off; it loads once that width is measured.
 */
function FacebookVideo({ attachment }: { attachment: Extract<ModalAttachment, { kind: "facebook" }> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  useEffect(() => {
    const box = ref.current!;
    const measure = () => setBoxWidth(Math.round(box.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="relative aspect-video w-full bg-text-primary">
      {boxWidth > 0 && (
        <iframe
          src={facebookEmbedUrl(attachment, boxWidth)}
          title="Facebook video"
          sandbox={FACEBOOK_SANDBOX}
          allow={FACEBOOK_ALLOW}
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 h-full w-full border-0"
        />
      )}
    </div>
  );
}

// The sealed box may run its own scripts, load from other sites and open links in a new tab: without
// allow-same-origin it is its own unknown site, so it can't reach QuizMatter's page, cookies, storage or the teacher's
// login; without allow-top-navigation, allow-forms and allow-modals it can't move this page, send forms or show alerts.
const SEALED_BOX_SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox";

/**
 * The admin's HTML in the sealed box (sandboxedHtml), `height` px tall; taller content scrolls inside. `onEscape`:
 * Escape pressed inside the box (its helper tells this page; only this box's own message counts).
 */
function SealedBox({
  html,
  height,
  className,
  onEscape,
}: {
  html: string;
  height: number | undefined;
  className: string;
  onEscape?: () => void;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!onEscape) return;
    const handleMessage = (e: MessageEvent) => {
      if (e.source === ref.current?.contentWindow && e.data === SEALED_BOX_ESCAPE) onEscape();
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onEscape]);

  return (
    <iframe
      ref={ref}
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
 * The circle in the top-right corner of a modal or corner box: the seconds `left` until it may be closed, then the
 * close button (✕ in a circle). Both are filled white inside their ring, so they show over a dark picture or HTML too.
 */
function CloseCircle({ left, onClose }: { left: number; onClose: () => void }) {
  return left <= 0 ? (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      title="Close"
      className="flex text-text-primary transition-colors hover:text-accent"
    >
      <XCircleIcon size={28} fill="var(--bg-surface)" />
    </button>
  ) : (
    <span
      title="You can close this soon"
      aria-label={`You can close this in ${left}`}
      className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-text-primary bg-bg-surface text-[11px] font-semibold text-text-primary"
    >
      {left}
    </span>
  );
}

/**
 * What a modal or corner box shows, `width` px wide: a post (the text with padding, links clickable, then the
 * attachment edge to edge) or (`format` "html") the admin's HTML in the sealed box at `height`. `onEscape`: Escape
 * pressed inside the sealed box (only the modal listens).
 */
function AnnouncementContent({
  text,
  attachment,
  format,
  html,
  height,
  width,
  onEscape,
}: {
  text: string;
  attachment: ModalAttachment | null;
  format: ModalFormat;
  html: string;
  height: number | undefined;
  width: number;
  onEscape?: () => void;
}) {
  if (format === "html") return <SealedBox html={html} height={height} className="w-full" onEscape={onEscape} />;
  return (
    <>
      {text.trim() !== "" && (
        // Right padding keeps the text clear of the corner circle.
        <p className="whitespace-pre-line break-words py-4 pl-5 pr-14 text-sm text-text-primary">
          <LinkifiedText text={text.trim()} />
        </p>
      )}
      {attachment && <AnnouncementAttachment attachment={attachment} width={width} />}
    </>
  );
}

/** The chosen size's width in px (MODAL_SIZES; Large when unknown). */
function sizeWidth(size: ModalSize): number {
  return MODAL_SIZES.find((s) => s.key === size)?.width ?? MODAL_SIZES[MODAL_SIZES.length - 1].width;
}

/**
 * The modal part: the app's Modal without its title row, at the chosen width (MODAL_SIZES; the height fits), showing
 * AnnouncementContent. No footer: the CloseCircle sits in the top-right corner (Modal's `corner`).
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
  const width = sizeWidth(size);
  return (
    <Modal
      title="Announcement"
      onClose={onClose}
      canClose={canClose}
      hideHeader
      width={width}
      noPadding
      corner={<CloseCircle left={left} onClose={onClose} />}
    >
      {/* Escape inside the sealed box closes it like Escape outside (Modal), once the close button shows. */}
      <AnnouncementContent
        text={text}
        attachment={attachment}
        format={format}
        html={html}
        height={height}
        width={width}
        onEscape={canClose ? onClose : undefined}
      />
    </Modal>
  );
}

/**
 * The corner box (spec docs/superpowers/specs/2026-11-02-announcement-corner-box-design.md): a card at the
 * bottom-right, the chosen width (Small / Medium; the screen's width less 16 px a side on a phone), that doesn't
 * block the page: no backdrop, no Escape. The same content and CloseCircle as the modal. With `autoClose` seconds, a
 * violet line at the bottom shrinks to nothing, then it closes itself like the close button; the line starts only
 * once the close button shows (so it never closes before a teacher could), and stops while the mouse is over the box
 * or the tab is in the background. It waits while a modal shows (pickForPage), and would
 * sit under a modal's backdrop anyway (z-50 < the modal's z-[60]).
 */
export function AnnouncementCornerBox({
  text,
  attachment,
  format = "post",
  html = "",
  height,
  closeAfter,
  autoClose,
  size,
  onClose,
}: {
  text: string;
  attachment: ModalAttachment | null;
  format?: ModalFormat;
  html?: string;
  height?: number;
  closeAfter: number;
  autoClose: number;
  size: ModalSize;
  onClose: () => void;
}) {
  const left = useCloseCountdown(closeAfter);
  const width = sizeWidth(size);
  // The line also stops while the tab is in the background, so it never runs out unseen (that counts as seen).
  const isTabHidden = useIsTabHidden();
  return (
    <div
      role="region"
      aria-label="Announcement"
      style={{ width: `min(${width}px, calc(100vw - 32px))` }}
      className="group/corner fixed bottom-4 right-4 z-50 flex max-h-[calc(100dvh-32px)] flex-col overflow-hidden rounded-card border border-border-default bg-bg-surface"
    >
      <div className="absolute right-3 top-3 z-10">
        <CloseCircle left={left} onClose={onClose} />
      </div>
      <div className="min-h-0 overflow-y-auto">
        <AnnouncementContent text={text} attachment={attachment} format={format} html={html} height={height} width={width} />
      </div>
      {autoClose > 0 && left <= 0 && (
        <div className="h-[3px] shrink-0 bg-accent-soft">
          <div
            onAnimationEnd={onClose}
            style={{ animationDuration: `${autoClose}s`, animationPlayState: isTabHidden ? "paused" : undefined }}
            className="h-full animate-shrink bg-accent group-hover/corner:[animation-play-state:paused]"
          />
        </div>
      )}
    </div>
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
