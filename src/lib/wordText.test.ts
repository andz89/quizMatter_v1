import { test } from "node:test";
import assert from "node:assert/strict";
import { PICKED_LINES_MAX, droppedTextHtml, pickedSlideTexts, stripItemMark, wordLines } from "./wordText";

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

test("each paragraph is a line, empty ones are skipped", () => {
  const xml =
    `<w:body><w:p><w:r><w:t>What gas?</w:t></w:r></w:p><w:p/><w:p></w:p>` +
    `<w:p><w:r><w:t xml:space="preserve">a. </w:t><w:t>Oxygen</w:t></w:r></w:p></w:body>`;
  assert.deepEqual(wordLines(xml), ["What gas?", "a. Oxygen"]);
});

test("a line break splits a paragraph; a tab is a space; spaces collapse", () => {
  const xml = `<w:p><w:r><w:t>One</w:t><w:br/><w:t>Two</w:t><w:cr/><w:t xml:space="preserve">a  </w:t><w:tab/><w:t xml:space="preserve"> b</w:t></w:r></w:p>`;
  assert.deepEqual(wordLines(xml), ["One", "Two", "a b"]);
});

test("entities are decoded", () => {
  assert.deepEqual(wordLines(p("&amp; &lt; &gt; &quot; &apos; &#233; &#x41;")), [`& < > " ' é A`]);
});

test("a text box shows once and stays its own line", () => {
  const box = p("Box");
  const xml =
    `<w:p><w:r><w:t>Outer</w:t></w:r><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><w:txbxContent>${box}</w:txbxContent></w:drawing></mc:Choice>` +
    `<mc:Fallback><w:pict><w:txbxContent>${box}</w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`;
  const lines = wordLines(xml);
  assert.equal(lines.length, 2);
  assert.ok(lines.includes("Outer"));
  assert.ok(lines.includes("Box"));
});

test("settings and field codes add no text", () => {
  const xml = `<w:p><w:pPr><w:rPr><w:rFonts w:ascii="Arial"/></w:rPr></w:pPr><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:t>Hi</w:t></w:r></w:p>`;
  assert.deepEqual(wordLines(xml), ["Hi"]);
});

test("stripItemMark removes a leading number or letter", () => {
  assert.equal(stripItemMark("1. Dog"), "Dog");
  assert.equal(stripItemMark("12) Dog"), "Dog");
  assert.equal(stripItemMark("a. Dog"), "Dog");
  assert.equal(stripItemMark("B) Dog"), "Dog");
  assert.equal(stripItemMark("(c) Dog"), "Dog");
  assert.equal(stripItemMark("(3) Dog"), "Dog");
  assert.equal(stripItemMark("I. Intro"), "Intro");
});

test("stripItemMark keeps text that only looks like a mark", () => {
  assert.equal(stripItemMark("1.5 kg"), "1.5 kg");
  assert.equal(stripItemMark("A cat"), "A cat");
  assert.equal(stripItemMark("2.Dog"), "2.Dog");
});

test("droppedTextHtml keeps the box's paragraph settings and escapes the text", () => {
  assert.equal(droppedTextHtml(`<p style="text-align: center">Old <b>q</b></p>`, "a < b"), `<p style="text-align: center">a &lt; b</p>`);
  assert.equal(droppedTextHtml(undefined, "Dog & cat"), "<p>Dog &amp; cat</p>");
  assert.equal(droppedTextHtml("", "Dog"), "<p>Dog</p>");
});

test("pickedSlideTexts: first ticked is the question, the rest A–D in click order, marks removed", () => {
  const lines = ["1. What gas?", "a. Oxygen", "b. Carbon dioxide", "c. Nitrogen", "d. Helium"];
  assert.deepEqual(pickedSlideTexts(lines, [0, 2, 1]), { question: "What gas?", options: ["Carbon dioxide", "Oxygen", "", ""] });
  assert.deepEqual(pickedSlideTexts(lines, [0, 1, 2, 3, 4]), {
    question: "What gas?",
    options: ["Oxygen", "Carbon dioxide", "Nitrogen", "Helium"],
  });
  assert.deepEqual(pickedSlideTexts(lines, []), { question: "", options: ["", "", "", ""] });
  assert.equal(PICKED_LINES_MAX, 5);
});
