"use client";

import { useRef, useState, type ClipboardEvent } from "react";
import { toast } from "sonner";
import { ImageIcon, XIcon } from "lucide-react";
import { AnnouncementAttachment } from "@/components/AnnouncementView";
import { Spinner } from "@/components/Spinner";
import { ANNOUNCEMENT_LIMITS, type ModalAttachment } from "@/lib/announcements";
import { PHOTO_TYPES } from "@/lib/constants";
import { fetchYouTubeCard, uploadAnnouncementPhoto } from "@/lib/photos";
import { findFacebookLink } from "@/lib/facebook";
import { findYouTubeVideoId, youTubeWatchUrl } from "@/lib/youtube";

/**
 * The modal's text box, like a post (spec docs/superpowers/specs/2026-10-31-announcement-post-design.md): plain text,
 * then one attachment: a picture / GIF, a YouTube card (paste a YouTube link) or a Facebook post / video (paste its
 * link). It's as wide as the modal
 * (`width`) with the modal's own padding, so what you see here is what teachers see.
 */
export function ModalPostEditor({
  text,
  attachment,
  width,
  onText,
  onAttachment,
}: {
  text: string;
  attachment: ModalAttachment | null;
  width: number;
  onText: (text: string) => void;
  onAttachment: (attachment: ModalAttachment | null) => void;
}) {
  const [busy, setBusy] = useState<"photo" | "video" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const attach = async (kind: "photo" | "video", make: () => Promise<ModalAttachment>) => {
    setBusy(kind);
    try {
      onAttachment(await make());
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // A pasted YouTube or Facebook link (the pasted words stay in the text) becomes the attachment, while there's none
  // yet: a YouTube card (made by the server), or the Facebook post / video itself (only its link is kept).
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (attachment || busy) return;
    const pasted = e.clipboardData.getData("text");
    const videoId = findYouTubeVideoId(pasted);
    if (videoId) return void attach("video", () => fetchYouTubeCard(youTubeWatchUrl(videoId)));
    const facebook = findFacebookLink(pasted);
    if (facebook) onAttachment({ kind: "facebook", ...facebook });
  };

  return (
    <div className="flex flex-col gap-2">
      {/* box-content: the border sits outside `width`, so the inside is exactly the modal's width. */}
      <div
        className="box-content overflow-hidden rounded-card border border-border-default bg-bg-surface focus-within:border-text-secondary"
        style={{ maxWidth: width }}
      >
        <textarea
          value={text}
          maxLength={ANNOUNCEMENT_LIMITS.modalText}
          rows={4}
          onChange={(e) => onText(e.target.value)}
          onPaste={handlePaste}
          placeholder="Write your announcement… Paste a YouTube or Facebook link to add the video or post."
          aria-label="The modal's text"
          className="block w-full resize-y bg-transparent px-5 py-4 text-sm text-text-primary outline-none placeholder:text-text-secondary"
        />
        {busy && (
          <p className="flex items-center gap-2 border-t border-border-default px-5 py-3 text-sm text-text-secondary">
            <Spinner size={14} />
            {busy === "video" ? "Adding the video…" : "Uploading the picture…"}
          </p>
        )}
        {attachment && (
          <div className="relative">
            <AnnouncementAttachment attachment={attachment} width={width} />
            <button
              type="button"
              onClick={() => onAttachment(null)}
              title="Remove"
              aria-label="Remove the picture or video"
              className="absolute top-2 right-2 rounded-dropdown border border-border-default bg-bg-surface p-1 text-text-primary hover:bg-bg-page"
            >
              <XIcon size={16} />
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[12px] text-text-secondary">
        {!attachment && (
          <>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-dropdown border border-border-default bg-bg-surface px-3 py-1.5 text-[13px] font-semibold text-text-primary transition-colors hover:bg-bg-page disabled:opacity-60"
            >
              <ImageIcon size={14} />
              Picture or GIF
            </button>
            <span>or paste a YouTube or Facebook link in the text. One picture, video or post per announcement.</span>
          </>
        )}
        <span className="ml-auto">
          {text.length}/{ANNOUNCEMENT_LIMITS.modalText}
        </span>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept={[...PHOTO_TYPES, "image/gif"].join(",")}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void attach("photo", () => uploadAnnouncementPhoto(file));
        }}
      />
    </div>
  );
}
