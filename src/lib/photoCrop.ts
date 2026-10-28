// The math behind the profile photo's "Adjust your photo" box (src/app/account/ProfilePhotoCropper.tsx): a square
// box with a round frame, a photo that can be zoomed (1× to 3×) and dragged, and the square of the photo that ends
// up inside the box. No imports, so its test can load it.

/** How the photo sits in the box: its zoom, and how far its center is moved from the box's center (screen px). */
export type CropView = { zoom: number; x: number; y: number };

type Size = { width: number; height: number };

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

/** How much the photo is scaled on screen: at zoom 1 its short side fills the box. */
export function shownScale(image: Size, box: number, zoom: number) {
  return (box * zoom) / Math.min(image.width, image.height);
}

/** The view kept in bounds: zoom 1–3, and the photo always covering the whole box (never an empty edge). */
export function clampView(image: Size, box: number, view: CropView): CropView {
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom));
  const scale = shownScale(image, box, zoom);
  const maxX = (image.width * scale - box) / 2;
  const maxY = (image.height * scale - box) / 2;
  // This order gives 0, never -0, when the photo can't move that way.
  return { zoom, x: Math.max(-maxX, Math.min(maxX, view.x)), y: Math.max(-maxY, Math.min(maxY, view.y)) };
}

/** The square of the original photo (in its own px) that shows inside the box. */
export function cropSource(image: Size, box: number, view: CropView): { x: number; y: number; size: number } {
  const scale = shownScale(image, box, view.zoom);
  const size = box / scale;
  return { x: image.width / 2 - view.x / scale - size / 2, y: image.height / 2 - view.y / scale - size / 2, size };
}
