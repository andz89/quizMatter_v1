// Math for cropped elements. A cropped element's box is the part of the picture that shows; the whole
// picture is bigger and sits partly outside the box, hidden.
import type { SvgElement } from "./schema";
import type { Rect, Size } from "./geometry";

export type Crop = NonNullable<SvgElement["crop"]>;

/**
 * The whole picture, in px: its size, and where the shown part (the element's box) starts inside it, as
 * seen on screen. On a flipped element that's measured in the mirrored picture.
 */
export interface CropFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

type CroppableElement = Rect & Pick<SvgElement, "crop" | "rotation" | "flipX" | "flipY">;

export function getCropFrame(element: CroppableElement): CropFrame {
  const crop = element.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const width = element.width / crop.width;
  const height = element.height / crop.height;
  const left = crop.x * width;
  const top = crop.y * height;
  return {
    left: element.flipX ? width - left - element.width : left,
    top: element.flipY ? height - top - element.height : top,
    width,
    height,
  };
}

/**
 * The crop that shows `shown` (a rect inside the whole picture as seen on screen, in px, like
 * getCropFrame). Undefined = the whole picture shows.
 */
export function toCrop(shown: Rect, picture: Size, flip: Pick<SvgElement, "flipX" | "flipY">): Crop | undefined {
  const isWhole =
    shown.x < 0.5 && shown.y < 0.5 && shown.width > picture.width - 0.5 && shown.height > picture.height - 0.5;
  if (isWhole) return undefined;
  // The crop is saved on the picture itself, not the mirrored one, so flipping never changes it.
  const x = flip.flipX ? picture.width - shown.x - shown.width : shown.x;
  const y = flip.flipY ? picture.height - shown.y - shown.height : shown.y;
  return {
    x: x / picture.width,
    y: y / picture.height,
    width: shown.width / picture.width,
    height: shown.height / picture.height,
  };
}

/**
 * The element box that shows `shown` (a rect inside the whole picture, in px), with the picture staying
 * where it is on the slide. The box turns around its own center, so on a turned element the center
 * moves along the turned sides.
 */
export function boxForShownPart(element: CroppableElement, frame: CropFrame, shown: Rect): Rect {
  const rad = ((element.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const shiftX = shown.x + shown.width / 2 - (frame.left + element.width / 2);
  const shiftY = shown.y + shown.height / 2 - (frame.top + element.height / 2);
  const centerX = element.x + element.width / 2 + shiftX * cos - shiftY * sin;
  const centerY = element.y + element.height / 2 + shiftX * sin + shiftY * cos;
  return { x: centerX - shown.width / 2, y: centerY - shown.height / 2, width: shown.width, height: shown.height };
}
