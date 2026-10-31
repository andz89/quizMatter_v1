"use client";

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { MegaphoneIcon, PlayIcon, XIcon } from "lucide-react";
import { isInternalLink, toSafeAnnouncementHtml } from "@/lib/announcementText";
import { MODAL_SIZES, type ModalAttachment, type ModalSize } from "@/lib/announcements";
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
 * in JSX). Links into QuizMatter open in the same tab; other sites in a new tab.
 */
function BarText({ html, className }: { html: string; className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useLayoutEffect(() => {
    if (!ref.current) return;
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
    if (attachment.video) {
      return (
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
      );
    }
    return (
      <div className="flex justify-center bg-bg-page">
        <iframe
          src={src}
          title="Facebook post"
          sandbox={FACEBOOK_SANDBOX}
          allow={FACEBOOK_ALLOW}
          referrerPolicy="strict-origin-when-cross-origin"
          style={{ width: facebookPostWidth(width), height: FACEBOOK_POST_HEIGHT }}
          className="max-w-full border-0"
        />
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
 * The modal part, like a post: the app's Modal without its title row, at the chosen width (MODAL_SIZES; the height
 * fits), with the text (padding, links clickable) and then the attachment (edge to edge). "You can close this in N…"
 * until its close button may show.
 */
export function AnnouncementModal({
  text,
  attachment,
  closeAfter,
  size,
  onClose,
}: {
  text: string;
  attachment: ModalAttachment | null;
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
      {text.trim() !== "" && (
        <p className="whitespace-pre-line break-words px-5 py-4 text-sm text-text-primary">
          <LinkifiedText text={text.trim()} />
        </p>
      )}
      {attachment && <AnnouncementAttachment attachment={attachment} width={width} />}
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
      <BarText html={html} className={isFloating ? "min-w-0 flex-1" : "min-w-0"} />
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
