"use client";

import { useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { toast } from "sonner";
import {
  BoldIcon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  MoveHorizontalIcon,
  TextAlignCenterIcon,
  TextAlignEndIcon,
  TextAlignStartIcon,
  UnderlineIcon,
} from "lucide-react";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { ANNOUNCEMENT_BAR_EXTENSIONS, ANNOUNCEMENT_MODAL_EXTENSIONS, isAllowedLink } from "@/lib/announcementText";
import { fullWidthSize, type AnnouncementPart } from "@/lib/announcements";
import { DEFAULT_TEXT_COLOR, PHOTO_TYPES } from "@/lib/constants";
import { uploadAnnouncementPhoto } from "@/lib/photos";

type Align = "left" | "center" | "right";

/**
 * The text box for an announcement's modal or bar: bold, italic, underline, color, align and links; pictures in the
 * modal only. Sends its HTML up on every change ("" when empty). The saved text is made safe again where it's shown.
 */
export function AnnouncementTextEditor({
  part,
  value,
  width,
  onChange,
}: {
  part: AnnouncementPart;
  value: string;
  // The box's width in px (the modal's chosen size), so a picture's size here is its size for teachers.
  width?: number;
  onChange: (html: string) => void;
}) {
  const editor = useEditor({
    extensions: part === "modal" ? ANNOUNCEMENT_MODAL_EXTENSIONS : ANNOUNCEMENT_BAR_EXTENSIONS,
    content: value,
    // Next.js renders this on the server first; the editor can only be built in the browser.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        // The modal's box is like the real modal: no padding and, from `width`, its width.
        class: `outline-none text-sm text-text-primary ${part === "modal" ? "min-h-40" : "min-h-12 px-3 py-2"}`,
      },
    },
    onUpdate: ({ editor }) => onChange(editor.isEmpty ? "" : editor.getHTML()),
  });

  return (
    <div
      className={`rounded-input border border-border-default bg-bg-surface focus-within:border-text-secondary ${
        // box-content: the border sits outside `width`, so the text area is exactly the modal's width.
        part === "modal" ? "announcement-editor box-content" : ""
      }`}
      style={width ? { maxWidth: width } : undefined}
    >
      {editor && <Toolbar editor={editor} part={part} />}
      <EditorContent
        editor={editor}
        className="[&_a]:font-semibold [&_a]:text-accent [&_a]:underline [&_img]:h-auto [&_img]:max-w-full"
      />
    </div>
  );
}

function Toolbar({ editor, part }: { editor: Editor; part: AnnouncementPart }) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      link: editor.isActive("link"),
      image: editor.isActive("image"),
      href: (editor.getAttributes("link").href as string | undefined) ?? "",
      align: (["left", "center", "right"] as Align[]).find((a) => editor.isActive({ textAlign: a })) ?? "left",
      color: (editor.getAttributes("textStyle").color as string | undefined) ?? DEFAULT_TEXT_COLOR,
    }),
  });
  const [linkHref, setLinkHref] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const chain = () => editor.chain().focus();

  // The selected picture fills the modal from edge to edge. A picture never resized has no saved size yet, so its
  // own size is read from the page.
  const makeFullWidth = () => {
    const { width, height } = editor.getAttributes("image") as { width?: number | null; height?: number | null };
    const dom = editor.view.nodeDOM(editor.state.selection.from);
    const img = dom instanceof HTMLImageElement ? dom : dom instanceof HTMLElement ? dom.querySelector("img") : null;
    const own = { width: width || img?.naturalWidth, height: height || img?.naturalHeight };
    if (!own.width || !own.height) return;
    chain().updateAttributes("image", fullWidthSize(own.width, own.height)).run();
  };

  const addPicture = async (file: File | undefined) => {
    if (!file) return;
    setIsUploading(true);
    try {
      const src = await uploadAnnouncementPhoto(file);
      chain().setImage({ src }).run();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border-default p-1">
      <ToolButton title="Bold" active={state.bold} onClick={() => chain().toggleBold().run()}>
        <BoldIcon size={16} />
      </ToolButton>
      <ToolButton title="Italic" active={state.italic} onClick={() => chain().toggleItalic().run()}>
        <ItalicIcon size={16} />
      </ToolButton>
      <ToolButton title="Underline" active={state.underline} onClick={() => chain().toggleUnderline().run()}>
        <UnderlineIcon size={16} />
      </ToolButton>
      <label title="Text color" className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-dropdown hover:bg-bg-page">
        <input
          type="color"
          value={state.color}
          onChange={(e) => chain().setColor(e.target.value).run()}
          className="h-5 w-5 cursor-pointer rounded-dropdown border-0 bg-transparent p-0"
        />
      </label>
      <span aria-hidden className="mx-1 h-5 w-px bg-border-default" />
      <ToolButton title="Align left" active={state.align === "left"} onClick={() => chain().setTextAlign("left").run()}>
        <TextAlignStartIcon size={16} />
      </ToolButton>
      <ToolButton title="Center" active={state.align === "center"} onClick={() => chain().setTextAlign("center").run()}>
        <TextAlignCenterIcon size={16} />
      </ToolButton>
      <ToolButton title="Align right" active={state.align === "right"} onClick={() => chain().setTextAlign("right").run()}>
        <TextAlignEndIcon size={16} />
      </ToolButton>
      <span aria-hidden className="mx-1 h-5 w-px bg-border-default" />
      <ToolButton title="Link" active={state.link} onClick={() => setLinkHref(state.href)}>
        <LinkIcon size={16} />
      </ToolButton>
      {part === "modal" && (
        <>
          <ToolButton title="Add a picture or GIF" active={false} disabled={isUploading} onClick={() => fileInput.current?.click()}>
            {isUploading ? <Spinner size={14} /> : <ImageIcon size={16} />}
          </ToolButton>
          <ToolButton
            title={state.image ? "Full width" : "Full width (select a picture first)"}
            active={false}
            disabled={!state.image}
            onClick={makeFullWidth}
          >
            <MoveHorizontalIcon size={16} />
          </ToolButton>
          <input
            ref={fileInput}
            type="file"
            accept={[...PHOTO_TYPES, "image/gif"].join(",")}
            className="hidden"
            onChange={(e) => {
              void addPicture(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </>
      )}

      {linkHref !== null && (
        <LinkBox
          initial={linkHref}
          hasLink={state.link}
          onSave={(href) => {
            chain().extendMarkRange("link").setLink({ href }).run();
            setLinkHref(null);
          }}
          onRemove={() => {
            chain().extendMarkRange("link").unsetLink().run();
            setLinkHref(null);
          }}
          onClose={() => setLinkHref(null)}
        />
      )}
    </div>
  );
}

/** Asks for the link's address: a site (https://…) or a page in QuizMatter (/saved). */
function LinkBox({
  initial,
  hasLink,
  onSave,
  onRemove,
  onClose,
}: {
  initial: string;
  hasLink: boolean;
  onSave: (href: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [href, setHref] = useState(initial);
  const [error, setError] = useState("");
  const save = () => {
    const value = href.trim();
    if (!isAllowedLink(value)) return setError("Start with https:// for a site, or / for a page in QuizMatter (e.g. /saved).");
    onSave(value);
  };

  return (
    <Modal
      title="Link"
      isNarrow
      onClose={onClose}
      footer={
        <>
          {hasLink && (
            <button
              type="button"
              onClick={onRemove}
              className="rounded-button border border-border-default px-4 py-2 text-sm font-semibold text-text-primary hover:bg-bg-page"
            >
              Remove link
            </button>
          )}
          <button
            type="button"
            onClick={save}
            className="rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            Save
          </button>
        </>
      }
    >
      <p className="mb-2 text-sm text-text-secondary">Select the words first, then add their link.</p>
      <input
        autoFocus
        value={href}
        onChange={(e) => {
          setHref(e.target.value);
          setError("");
        }}
        onKeyDown={(e) => e.key === "Enter" && save()}
        placeholder="https://… or /saved"
        className="w-full rounded-input border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary"
      />
      {error && <p className="mt-2 text-sm text-danger-strong">{error}</p>}
    </Modal>
  );
}

function ToolButton({
  title,
  active,
  disabled = false,
  onClick,
  children,
}: {
  title: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-dropdown text-sm disabled:opacity-60 ${
        active ? "bg-accent text-white" : "text-text-primary hover:bg-bg-page"
      }`}
    >
      {children}
    </button>
  );
}
