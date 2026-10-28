"use client";

import { useRef, useState, type PointerEvent } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { clampView, cropSource, shownScale, type CropView } from "@/lib/photoCrop";
import { makeProfilePhoto, uploadProfilePhoto } from "@/lib/profilePhotos";

// The box's size on screen (px): fits a 320 px wide phone inside the popup.
const BOX = 240;

/**
 * "Adjust your photo": the picked photo in a square box with a round frame. Drag it to move it and use the Zoom
 * slider (1× to 3×); it always covers the whole frame (photoCrop.ts). Save photo cuts out what's in the box and
 * uploads it as the editor's profile photo. The caller made `photo` from the picked file and cleans it up on close.
 */
export function ProfilePhotoCropper({
  photo,
  onClose,
  onSaved,
}: {
  photo: { bitmap: ImageBitmap; url: string };
  onClose: () => void;
  onSaved: (saved: { src: string; leftToday: number }) => void;
}) {
  const image = { width: photo.bitmap.width, height: photo.bitmap.height };
  const [view, setView] = useState<CropView>({ zoom: 1, x: 0, y: 0 });
  const [isSaving, setIsSaving] = useState(false);
  // Where a drag started: the pointer and the photo's place then.
  const drag = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);
  const scale = shownScale(image, BOX, view.zoom);

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (isSaving) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointerX: e.clientX, pointerY: e.clientY, x: view.x, y: view.y };
  };

  const moveDrag = (e: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    const x = start.x + e.clientX - start.pointerX;
    const y = start.y + e.clientY - start.pointerY;
    setView((old) => clampView(image, BOX, { zoom: old.zoom, x, y }));
  };

  const save = async () => {
    setIsSaving(true);
    try {
      const blob = await makeProfilePhoto(photo.bitmap, cropSource(image, BOX, view));
      const saved = await uploadProfilePhoto(blob);
      toast.success("Profile photo saved.");
      onSaved(saved);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save the photo. Please try again.");
      setIsSaving(false);
    }
  };

  return (
    <Modal
      title="Adjust your photo"
      onClose={onClose}
      isBusy={isSaving}
      isNarrow
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-button border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-page disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={isSaving}
            className="flex items-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {isSaving && <Spinner size={14} />}
            Save photo
          </button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-3">
        <div
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          style={{ width: BOX, height: BOX }}
          className="relative cursor-grab touch-none overflow-hidden rounded-button bg-bg-page select-none active:cursor-grabbing"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the picked file. */}
          <img
            src={photo.url}
            alt=""
            draggable={false}
            className="pointer-events-none absolute top-1/2 left-1/2 max-w-none"
            style={{
              width: image.width * scale,
              height: image.height * scale,
              transform: `translate(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px))`,
            }}
          />
          {/* The round frame; outside it is darkened. */}
          <div className="pointer-events-none absolute inset-0 rounded-full border-2 border-white ring-[9999px] ring-black/50" />
        </div>
        <p className="text-xs text-text-secondary">Drag the photo to move it.</p>
        <label className="flex w-full max-w-[240px] items-center gap-3 text-sm font-semibold text-text-primary">
          Zoom
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={view.zoom}
            disabled={isSaving}
            onChange={(e) => {
              const zoom = Number(e.target.value);
              // Zooms around the middle of the frame: the spot there stays there.
              setView((old) => clampView(image, BOX, { zoom, x: (old.x * zoom) / old.zoom, y: (old.y * zoom) / old.zoom }));
            }}
            className="flex-1 accent-accent"
          />
        </label>
      </div>
    </Modal>
  );
}
