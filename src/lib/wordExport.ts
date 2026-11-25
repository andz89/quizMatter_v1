import {
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type FileChild,
} from "docx";
import type { Presentation } from "./schema";
import { CANVAS_WIDTH } from "./constants";
import { presentationFileName, presentationOutline, saveFile, type OutlineBlock } from "./presentationOutline";

/**
 * "Download → Word": the presentation's outline (`presentationOutline.ts`) as a real Word file (.docx), made in the
 * browser with the `docx` package. Only the chosen slides (`positions`, missing = all), in order; the questions'
 * answers are in an "Answer key" at the end, on its own page. Photos are the real pictures (`photos`, loaded by
 * `downloadPresentationWord`); one missing there is a clickable "Photo (link)". Embed slides are links. Loaded only
 * when the teacher downloads Word (`DownloadButton`), so `docx` never slows a page.
 */
export function presentationToWord(
  presentation: Presentation,
  { positions, photos = new Map() }: { positions?: readonly number[]; photos?: ReadonlyMap<string, WordPhoto> } = {},
): Document {
  const outline = presentationOutline(presentation, positions);
  const lists = { count: 0, photos };
  const children: FileChild[] = [new Paragraph({ text: outline.title, heading: HeadingLevel.TITLE })];
  if (outline.description) children.push(...lines(outline.description));
  for (const { label, value } of outline.details) children.push(labeled(label, value));
  if (outline.references.length > 0) {
    children.push(labeled("References", ""));
    for (const reference of outline.references) {
      children.push(new Paragraph({ children: [/^https?:\/\//.test(reference) ? link(reference, reference) : new TextRun(reference)], bullet: { level: 0 } }));
    }
  }

  for (const slide of outline.slides) {
    // An empty line between slides, since they have no labels.
    children.push(new Paragraph(""));
    for (const block of slide.blocks) children.push(...blockToWord(block, lists));
    if (slide.answer.length > 0) children.push(...answerToWord(new TextRun({ text: `${slide.answerLabel}: `, bold: true }), slide.answer, lists));
  }

  if (outline.answerKey.length > 0) {
    children.push(new Paragraph({ text: "Answer key", heading: HeadingLevel.HEADING_2, pageBreakBefore: true }));
    for (const { number, answer } of outline.answerKey) children.push(...answerToWord(new TextRun(`${number}. `), answer, lists));
  }

  return new Document({
    title: outline.title,
    // Numbered lists (flowchart and cycle steps): each list starts again at 1 (its own `instance`).
    numbering: {
      config: [{ reference: NUMBERED, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: "left" }] }],
    },
    sections: [{ children }],
  });
}

const NUMBERED = "numbered";

type WordContext = { count: number; photos: ReadonlyMap<string, WordPhoto> };

/** A label with its answer: a first line of text sits on the label's line, anything after it goes under. */
function answerToWord(label: TextRun, [first, ...rest]: OutlineBlock[], lists: WordContext): FileChild[] {
  const inline = first.kind === "text" && !first.text.includes("\n");
  return [
    new Paragraph({ children: [label, ...(inline ? [new TextRun(first.text)] : [])] }),
    ...(inline ? rest : [first, ...rest]).flatMap((block) => blockToWord(block, lists)),
  ];
}

/** Which photo file a photo block needs: the same picture cropped or flipped another way is another file. */
export function photoKey(block: Extract<OutlineBlock, { kind: "photo" }>): string {
  return JSON.stringify([block.url, block.crop ?? null, Boolean(block.flipX), Boolean(block.flipY)]);
}

/** Every photo block, also those inside options. */
function photoBlocks(blocks: OutlineBlock[]): Extract<OutlineBlock, { kind: "photo" }>[] {
  return blocks.flatMap((block) =>
    block.kind === "photo" ? [block] : block.kind === "options" ? photoBlocks(block.options.flatMap((option) => option.blocks)) : [],
  );
}

/** A photo ready for Word: JPEG bytes and their size in px. */
export interface WordPhoto {
  data: Uint8Array;
  width: number;
  height: number;
}

// The page's writing width in Word px (96 to the inch; 6.25 in). A photo as wide as the slide fills it.
const PAGE_WIDTH = 600;
const PHOTO_MIN_WIDTH = 120;
const PHOTO_MAX_HEIGHT = 700;

function blockToWord(block: OutlineBlock, lists: WordContext): FileChild[] {
  switch (block.kind) {
    case "text":
      return lines(block.text);
    case "options":
      // An option's pictures go under its letter.
      return block.options.flatMap(({ letter, text, blocks }) => [
        new Paragraph(`${letter}.${text ? ` ${text}` : ""}`),
        ...blocks.flatMap((part) => blockToWord(part, lists)),
      ]);
    case "link":
      return [new Paragraph({ children: [new TextRun(`${block.label}: `), link(block.url, block.url)] })];
    case "photo": {
      const photo = lists.photos.get(photoKey(block));
      if (!photo) return [new Paragraph({ children: [link("Photo (link)", block.url)] })];
      // As wide on the page as on the slide, keeping the picture's shape, never too small or too tall.
      let width = Math.min(PAGE_WIDTH, Math.max(PHOTO_MIN_WIDTH, (block.width / CANVAS_WIDTH) * PAGE_WIDTH));
      let height = (width * photo.height) / photo.width;
      if (height > PHOTO_MAX_HEIGHT) [width, height] = [(width * PHOTO_MAX_HEIGHT) / height, PHOTO_MAX_HEIGHT];
      return [
        new Paragraph({
          children: [new ImageRun({ type: "jpg", data: photo.data, transformation: { width: Math.round(width), height: Math.round(height) } })],
        }),
      ];
    }
    case "table":
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: block.rows.map(
            (cells, row) =>
              new TableRow({
                tableHeader: row === 0,
                children: cells.map((cell) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: cell, bold: row === 0 })] })] })),
              }),
          ),
        }),
        // Word needs a paragraph between two tables, or it joins them.
        new Paragraph(""),
      ];
    case "list": {
      const instance = ++lists.count;
      return block.items.map(({ text, depth }) =>
        block.ordered
          ? new Paragraph({ text, numbering: { reference: NUMBERED, level: 0, instance } })
          : new Paragraph({ text, bullet: { level: Math.min(depth, 8) } }),
      );
    }
  }
}

/** Each line of a text as its own paragraph. */
function lines(text: string): Paragraph[] {
  return text.split("\n").map((line) => new Paragraph({ text: line }));
}

/** "Label: value", with the label in bold. */
function labeled(label: string, value: string): Paragraph {
  return new Paragraph({ children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(value)] });
}

function link(text: string, url: string): ExternalHyperlink {
  return new ExternalHyperlink({ link: url, children: [new TextRun({ text, style: "Hyperlink" })] });
}

/**
 * Saves the presentation as a Word file on the teacher's computer (browser only). Each photo is read once, straight
 * from our photo storage (never through our server; the R2 bucket's CORS rule lets the app read it), and turned
 * into a JPEG, since Word can't show WebP, cropped and flipped as the slide shows it. A few at a time
 * (`PHOTOS_AT_ONCE`), so a phone isn't asked to hold dozens of big pictures at once. Returns how many photos couldn't
 * be read (those stay links).
 */
export async function downloadPresentationWord(presentation: Presentation, positions?: readonly number[]): Promise<{ missingPhotos: number }> {
  const outline = presentationOutline(presentation, positions);
  const blocks = [...outline.slides.flatMap((slide) => [...slide.blocks, ...slide.answer]), ...outline.answerKey.flatMap((entry) => entry.answer)];
  const wanted = new Map(photoBlocks(blocks).map((block) => [photoKey(block), block]));
  const queue = [...wanted];
  const photos = new Map<string, WordPhoto>();
  await Promise.all(
    Array.from({ length: Math.min(PHOTOS_AT_ONCE, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const photo = await loadPhoto(next[1]);
        if (photo) photos.set(next[0], photo);
      }
    }),
  );
  const blob = await Packer.toBlob(presentationToWord(presentation, { positions, photos }));
  saveFile(blob, presentationFileName(presentation.title, ".docx"));
  return { missingPhotos: wanted.size - photos.size };
}

const PHOTOS_AT_ONCE = 4;

// The longest side a photo keeps in the file, so a big presentation's file stays small.
const PHOTO_MAX_SIDE = 1600;

/** One photo as a JPEG (see-through parts on white), cropped and flipped like its block, or null when it can't be read. */
async function loadPhoto({ url, crop, flipX, flipY }: Extract<OutlineBlock, { kind: "photo" }>): Promise<WordPhoto | null> {
  try {
    // The browser's saved copy is used first. One saved before the bucket's CORS rule (shown by a plain <img>) has no
    // permission and fails, so it's asked for again once, skipping that copy.
    const response = await fetch(url, { mode: "cors" }).catch(() => fetch(url, { mode: "cors", cache: "reload" }));
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    // The part the slide shows (crop is in parts of the whole picture; missing = all of it).
    const part = crop ?? { x: 0, y: 0, width: 1, height: 1 };
    const [sx, sy, sw, sh] = [part.x * bitmap.width, part.y * bitmap.height, part.width * bitmap.width, part.height * bitmap.height];
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(sw, sh));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return null;
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    // Mirrored around the middle, like the slide's flipX / flipY.
    context.translate(flipX ? canvas.width : 0, flipY ? canvas.height : 0);
    context.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    const size = { width: canvas.width, height: canvas.height };
    // Frees the canvas's memory now, not whenever the browser gets to it.
    canvas.width = canvas.height = 0;
    return jpeg ? { data: new Uint8Array(await jpeg.arrayBuffer()), ...size } : null;
  } catch {
    return null;
  }
}
