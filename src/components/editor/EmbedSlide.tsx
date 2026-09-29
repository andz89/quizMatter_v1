"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useEditorStore } from "@/lib/store";
import { embedLinkSchema, type Slide } from "@/lib/schema";
import { MAX_EMBED_URL_LENGTH, readEmbedLink, type Embed, type EmbedKind } from "@/lib/embed";
import { ImageIcon, PencilIcon, PlayIcon, PresentationIcon } from "lucide-react";

// The words each kind of embed slide uses.
const KIND_TEXT: Record<EmbedKind, { title: string; placeholder: string; hint: string; add: string; empty: string }> = {
  video: {
    title: "Embed a video",
    placeholder: "Paste a YouTube, Vimeo or Canva link",
    hint: "Canva: Share → Embed, then copy the link.",
    add: "Add video",
    empty: "No video yet",
  },
  "embed-slides": {
    title: "Embed slides",
    placeholder: "Paste a Google Slides or Canva link",
    hint: "Google Slides: share with “Anyone with the link”. Canva: Share → Embed.",
    add: "Add slides",
    empty: "No slides yet",
  },
  image: {
    title: "Embed an image",
    placeholder: "Paste a picture link (https://…)",
    hint: "Google Drive pictures: share with “Anyone with the link”.",
    add: "Add image",
    empty: "No image yet",
  },
};

function getEmbed(kind: EmbedKind, url: string | undefined): Embed | null {
  if (!url) return null;
  const result = readEmbedLink(kind, url);
  return "error" in result ? null : result;
}

/** The rounded box the embed sits in, filling the slide's content area. Dark behind players, clear behind pictures. */
function EmbedFrame({ dark, children }: { dark: boolean; children: ReactNode }) {
  return (
    <div className={`relative min-h-0 flex-1 overflow-hidden rounded-card ${dark ? "bg-[#111111]" : ""}`}>{children}</div>
  );
}

/** The live video player or slide deck viewer. */
function EmbedPlayer({ src }: { src: string }) {
  return (
    <iframe
      src={src}
      title="Embedded content"
      className="absolute inset-0 h-full w-full"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
      allowFullScreen
      // YouTube refuses to play embedded videos when the page's address isn't sent.
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}

/** The picture, whole (not stretched or cut), with a message when its link doesn't load. */
function EmbedPicture({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="absolute inset-0 flex items-center justify-center rounded-card border border-dashed border-border-default text-2xl text-text-secondary">
        This picture couldn&apos;t be loaded.
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a picture from another site, not one of ours to optimize.
    <img src={src} alt="" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-contain" />
  );
}

/** What the slide shows once it has a link: the picture, or the live player/viewer. */
function EmbedContent({ kind, embed }: { kind: EmbedKind; embed: Embed }) {
  return kind === "image" ? <EmbedPicture key={embed.src} src={embed.src} /> : <EmbedPlayer src={embed.src} />;
}

/**
 * An embed slide outside the editor. `live` = the real player or deck (present mode). Otherwise a light
 * preview (the video's cover picture, or a box saying where the deck is from), so small previews
 * don't each load a player. Pictures always show as they are.
 */
export function EmbedSlideView({ slide, kind, live }: { slide: Slide; kind: EmbedKind; live: boolean }) {
  const embed = getEmbed(kind, slide.embedUrl);
  if (embed && (live || kind === "image")) {
    return (
      <EmbedFrame dark={kind !== "image"}>
        <EmbedContent kind={kind} embed={embed} />
      </EmbedFrame>
    );
  }
  return (
    <EmbedFrame dark={kind === "video"}>
      {embed?.thumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- a picture from YouTube, not one of ours to optimize.
        <img src={embed.thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-card ${
          kind === "video" ? "text-white" : "border border-border-default bg-bg-page text-text-primary"
        }`}
      >
        <span
          className={`flex h-28 w-28 items-center justify-center rounded-full ${kind === "video" ? "bg-black/50" : "bg-bg-surface"}`}
        >
          <EmbedKindIcon kind={kind} size={56} />
        </span>
        {/* The cover picture already shows what it is. */}
        {!embed?.thumbnailUrl && (
          <span className="text-3xl opacity-70">{embed ? embed.sourceName : KIND_TEXT[kind].empty}</span>
        )}
      </div>
    </EmbedFrame>
  );
}

/** An embed slide in the editor: a box to paste the link, then the embed with an edit-link button. */
export function EmbedSlideEditor({ slide, kind }: { slide: Slide; kind: EmbedKind }) {
  const setEmbedUrl = useEditorStore((s) => s.setEmbedUrl);
  const [isEditing, setIsEditing] = useState(false);
  const embed = getEmbed(kind, slide.embedUrl);

  if (embed && !isEditing) {
    return (
      <EmbedFrame dark={kind !== "image"}>
        <EmbedContent kind={kind} embed={embed} />
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          title="Edit link"
          className="absolute right-4 top-4 flex h-14 w-14 items-center justify-center rounded-button border border-border-default bg-bg-surface text-text-primary hover:bg-bg-page"
        >
          <PencilIcon size={26} />
        </button>
      </EmbedFrame>
    );
  }

  return (
    <EmbedLinkForm
      kind={kind}
      initialUrl={slide.embedUrl ?? ""}
      onSave={(url) => {
        setEmbedUrl(slide.id, url);
        setIsEditing(false);
      }}
      onCancel={embed ? () => setIsEditing(false) : undefined}
    />
  );
}

interface EmbedLinkFormProps {
  kind: EmbedKind;
  initialUrl: string;
  onSave: (url: string) => void;
  // Missing = nothing to go back to (no link yet).
  onCancel?: () => void;
}

/** The link box and button, in the middle of the slide. The link is checked with zod before it's kept. */
function EmbedLinkForm({ kind, initialUrl, onSave, onCancel }: EmbedLinkFormProps) {
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const text = KIND_TEXT[kind];

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = embedLinkSchema(kind).safeParse(url);
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }
    onSave(result.data);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 rounded-card border border-dashed border-border-default">
      <span className="flex h-24 w-24 items-center justify-center rounded-full bg-bg-page text-text-primary">
        <EmbedKindIcon kind={kind} size={44} />
      </span>
      <span className="text-3xl font-semibold text-text-primary">{text.title}</span>
      <form onSubmit={handleSubmit} className="flex items-center gap-3">
        <input
          autoFocus={!!onCancel}
          value={url}
          maxLength={MAX_EMBED_URL_LENGTH}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel?.();
          }}
          placeholder={text.placeholder}
          className="h-16 w-[640px] rounded-input border border-border-default bg-bg-surface px-5 text-2xl text-text-primary outline-none placeholder:text-text-secondary focus:border-accent"
        />
        <button
          type="submit"
          className="h-16 whitespace-nowrap rounded-button bg-accent btn-press px-8 text-2xl font-semibold text-white hover:bg-accent-hover"
        >
          {onCancel ? "Save" : text.add}
        </button>
      </form>
      {/* The error takes the hint's place, so the box doesn't jump when a message shows. */}
      <p className={`-mt-2 text-xl ${error ? "text-danger-strong" : "text-text-secondary"}`}>{error ?? text.hint}</p>
      {onCancel && (
        <button type="button" onClick={onCancel} className="text-xl text-text-secondary hover:text-text-primary">
          Cancel
        </button>
      )}
    </div>
  );
}

function EmbedKindIcon({ kind, size }: { kind: EmbedKind; size: number }) {
  if (kind === "video") return <PlayIcon size={size} fill="currentColor" />;
  if (kind === "embed-slides") return <PresentationIcon size={size} />;
  return <ImageIcon size={size} />;
}
