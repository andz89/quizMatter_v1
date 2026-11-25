import { test } from "node:test";
import assert from "node:assert/strict";
import { Packer } from "docx";
import { unzipSync, strFromU8 } from "fflate";
import { createBlankPresentation, createBlankSlide } from "./factories";
import { photoKey, presentationToWord } from "./wordExport";
import type { Slide, SvgElement } from "./schema";

function element(fields: Partial<SvgElement>): SvgElement {
  return { id: "e", assetId: "x", x: 0, y: 0, width: 10, height: 10, color: "#000000", containerId: null, ...fields };
}

/** The Word file's main text (word/document.xml) and its links (word/_rels/document.xml.rels). */
async function wordParts(document: ReturnType<typeof presentationToWord>) {
  const files = unzipSync(new Uint8Array(await Packer.toBuffer(document)));
  const media = Object.keys(files).filter((name) => name.startsWith("word/media/"));
  return { xml: strFromU8(files["word/document.xml"]), rels: strFromU8(files["word/_rels/document.xml.rels"]), media };
}

test("a Word file has the title, details, every slide in order, and the answers in a key at the end", async () => {
  const presentation = createBlankPresentation({ title: "Planets & stars", subject: "Science" });
  const answered: Slide = { ...createBlankSlide("short-answer"), question: "2 + 2?", correctAnswer: "4" };
  presentation.slides.push(answered);
  const { xml } = await wordParts(presentationToWord(presentation));

  assert.match(xml, /Planets &amp; stars/);
  assert.match(xml, /Subject: <\/w:t>[\s\S]*?Science/);
  // Question 1's options, in order, none marked. No "Q1" labels.
  const q1 = xml.indexOf(">1. Which planet is the largest in our solar system?<");
  const q2 = xml.indexOf(">2. 2 + 2?<");
  assert.ok(q1 > 0 && q2 > q1, "question 1 comes before question 2");
  assert.doesNotMatch(xml, />Q\d/);
  assert.match(xml.slice(q1, q2), /A\. Jupiter[\s\S]*?B\. Venus/);
  assert.doesNotMatch(xml, /correct/);
  const key = xml.indexOf(">Answer key<");
  assert.ok(key > q2, "the answer key comes after the slides");
  assert.match(xml.slice(key), />1\. <\/w:t>[\s\S]*?>A\. Jupiter<[\s\S]*?>2\. <\/w:t>[\s\S]*?>4</);
});

test("tables become Word tables, and a photo that couldn't be loaded stays a clickable link", async () => {
  const presentation = createBlankPresentation({ title: "Things" });
  const blank = createBlankSlide("blank");
  blank.elements = [
    element({ id: "t", table: { rows: [[{ html: "<p>Name</p>" }, { html: "<p>Age</p>" }], [{ html: "<p>Ana</p>" }, { html: "<p>9</p>" }]] } }),
    element({ id: "p", y: 100, image: { src: "https://images.quizmatter.com/uploads/abc.webp", width: 10, height: 10 } }),
  ];
  presentation.slides = [blank];
  const { xml, rels } = await wordParts(presentationToWord(presentation));

  assert.match(xml, /<w:tbl>[\s\S]*?Name[\s\S]*?Age[\s\S]*?Ana[\s\S]*?9[\s\S]*?<\/w:tbl>/);
  assert.match(xml, /<w:hyperlink[^>]*>[\s\S]*?Photo \(link\)/);
  assert.match(rels, /Target="https:\/\/images\.quizmatter\.com\/uploads\/abc\.webp"/);
  assert.doesNotMatch(xml, /<w:drawing>/);
});

test("a loaded photo is the real picture, sized from its box on the slide and keeping its shape", async () => {
  const src = "https://images.quizmatter.com/uploads/abc.webp";
  const presentation = createBlankPresentation({ title: "Photo" });
  const blank = createBlankSlide("blank");
  blank.elements = [element({ id: "p", width: 640, image: { src, width: 800, height: 400 } })];
  presentation.slides = [blank];
  // Any bytes do: Word only gets them as the picture file.
  const photos = new Map([[photoKey({ kind: "photo", url: src, width: 640 }), { data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 800, height: 400 }]]);
  const { xml, media } = await wordParts(presentationToWord(presentation, { photos }));

  assert.match(xml, /<w:drawing>/);
  assert.equal(media.length, 1);
  assert.doesNotMatch(xml, /Photo \(link\)/);
  // Half the slide's width (640 of 1280) = 300 px of the page's 600, and half as tall: 300 × 150 px in EMUs (9,525 a px).
  assert.match(xml, /<wp:extent cx="2857500" cy="1428750"\/>/);
});

test("the same photo cropped or flipped another way needs its own file", () => {
  const url = "https://images.quizmatter.com/uploads/abc.webp";
  const plain = photoKey({ kind: "photo", url, width: 100 });
  assert.equal(plain, photoKey({ kind: "photo", url, width: 300 }), "only the size differs: one file");
  assert.notEqual(plain, photoKey({ kind: "photo", url, width: 100, crop: { x: 0, y: 0, width: 0.5, height: 1 } }));
  assert.notEqual(plain, photoKey({ kind: "photo", url, width: 100, flipX: true }));
});
