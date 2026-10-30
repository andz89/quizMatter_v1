import { test } from "node:test";
import assert from "node:assert/strict";
import type { JSONContent } from "@tiptap/core";
import { ANNOUNCEMENT_MODAL_EXTENSIONS, cleanAnnouncementDoc, isInternalLink } from "./announcementText";
import { PHOTO_URL_PREFIX } from "./constants";

const image = (src: string): JSONContent => ({ type: "image", attrs: { src } });
const linked = (href: string): JSONContent => ({
  type: "text",
  text: "click",
  marks: [{ type: "bold" }, { type: "link", attrs: { href } }],
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content: [{ type: "paragraph", content }] });

test("cleanAnnouncementDoc keeps our photos and drops images from other sites", () => {
  const ours = `${PHOTO_URL_PREFIX}abc.webp`;
  const clean = cleanAnnouncementDoc({ type: "doc", content: [image(ours), image("https://evil.example/x.png")] });
  assert.deepEqual(clean.content, [image(ours)]);
});

test("cleanAnnouncementDoc drops unsafe links but keeps their text", () => {
  for (const href of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "//evil.example", "data:text/html,<b>x</b>"]) {
    const text = cleanAnnouncementDoc(doc(linked(href))).content![0].content![0];
    assert.equal(text.text, "click", href);
    assert.deepEqual(text.marks, [{ type: "bold" }], href);
  }
});

test("cleanAnnouncementDoc keeps https and in-app links", () => {
  for (const href of ["https://deped.gov.ph", "http://deped.gov.ph", "/saved"]) {
    const text = cleanAnnouncementDoc(doc(linked(href))).content![0].content![0];
    assert.deepEqual(text.marks, linked(href).marks, href);
  }
});

test("isInternalLink is true only for a path in the app", () => {
  assert.equal(isInternalLink("/saved"), true);
  assert.equal(isInternalLink("//x.com"), false);
  assert.equal(isInternalLink("https://x.com"), false);
});

test("modal pictures can be resized, keeping their shape", () => {
  const image = ANNOUNCEMENT_MODAL_EXTENSIONS.find((extension) => extension.name === "image");
  assert.deepEqual(image?.options.resize, {
    enabled: true,
    directions: ["top-left", "top-right", "bottom-left", "bottom-right"],
    minWidth: 40,
    minHeight: 40,
    alwaysPreserveAspectRatio: true,
  });
});

test("cleanAnnouncementDoc keeps a resized picture's size", () => {
  const resized: JSONContent = { type: "image", attrs: { src: `${PHOTO_URL_PREFIX}abc.webp`, width: 320, height: 180 } };
  assert.deepEqual(cleanAnnouncementDoc({ type: "doc", content: [resized] }).content, [resized]);
});
