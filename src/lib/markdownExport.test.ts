import { test } from "node:test";
import assert from "node:assert/strict";
import { createBlankPresentation, createBlankSlide } from "./factories";
import { presentationToMarkdown } from "./markdownExport";
import { htmlToText, parseSlideNumbers, presentationFileName } from "./presentationOutline";
import type { Slide, SvgElement } from "./schema";

function element(fields: Partial<SvgElement>): SvgElement {
  return { id: "e", assetId: "x", x: 0, y: 0, width: 10, height: 10, color: "#000000", containerId: null, ...fields };
}

test("the details come first, with only the filled ones", () => {
  const presentation = createBlankPresentation({
    title: "Fractions",
    description: "Halves and quarters.",
    grades: ["Grade 3"],
    subject: "Mathematics",
    author: "Ms. Cruz",
    tags: ["fractions", "halves"],
    referenceLinks: ["https://example.com/book"],
  });
  presentation.slides = [];
  const markdown = presentationToMarkdown(presentation);
  assert.match(markdown, /^# Fractions\n\nHalves and quarters\.\n/);
  assert.match(markdown, /- \*\*Grades:\*\* Grade 3\n/);
  assert.match(markdown, /- \*\*Subject:\*\* Mathematics\n/);
  assert.match(markdown, /- \*\*Author:\*\* Ms\. Cruz\n/);
  assert.match(markdown, /- \*\*Tags:\*\* fractions, halves\n/);
  assert.match(markdown, /- https:\/\/example\.com\/book\n/);
  assert.doesNotMatch(markdown, /Term|Curriculum/);
});

test("a choice slide lists its options without marking one; the right one is in the answer key at the end", () => {
  const presentation = createBlankPresentation({ title: "Planets" });
  const markdown = presentationToMarkdown(presentation);
  assert.match(markdown, /---\n\n1\. Which planet is the largest in our solar system\?\n\n- A\. Jupiter\n- B\. Venus\n- C\. Mars\n- D\. Saturn\n/);
  assert.doesNotMatch(markdown, /\[x\]|\[ \]/);
  assert.match(markdown, /---\n\n## Answer key\n\n1\. A\. Jupiter\n$/);
});

test("questions start with their number like the editor counts them; other slides and hidden ones get none, and there are no slide labels", () => {
  const presentation = createBlankPresentation({ title: "Mix" });
  const title = createBlankSlide("title");
  const named = { ...createBlankSlide("true-false"), name: "Warm up", question: "The sun is a star." };
  named.correctOptionId = named.options[0].id;
  const hidden: Slide = { ...createBlankSlide("short-answer"), hidden: true, question: "Secret?" };
  const answered: Slide = { ...createBlankSlide("short-answer"), question: "2 + 2?", correctAnswer: "4" };
  presentation.slides = [title, named, hidden, answered];
  const markdown = presentationToMarkdown(presentation);
  assert.match(markdown, /---\n\nTitle\n\nAdd a description here\n/);
  assert.match(markdown, /---\n\n1\. The sun is a star\.\n\n- A\. True\n- B\. False\n/);
  assert.doesNotMatch(markdown, /C\. /);
  assert.match(markdown, /---\n\nSecret\?/);
  assert.doesNotMatch(markdown, /Slide \d|Q\d|Hidden|Warm up/);
  assert.match(markdown, /---\n\n2\. 2 \+ 2\?\n\n---/);
  // Only numbered questions go in the key, in order; the hidden one keeps its own answer under it (it has none here).
  assert.match(markdown, /## Answer key\n\n1\. A\. True\n2\. 4\n$/);
});

test("styled text, tables, diagrams, photos and embeds come out as text", () => {
  const presentation = createBlankPresentation({ title: "Things" });
  const blank = createBlankSlide("blank");
  blank.elements = [
    element({ id: "b", y: 200, table: { rows: [[{ html: "<p>Name</p>" }, { html: "<p>A | B</p>" }], [{ html: "<p>Ana</p>" }, { html: "" }]] } }),
    element({ id: "a", y: 10, text: { html: "<p><strong>Big</strong> idea &amp; more</p><p>Line two</p>" } }),
    element({ id: "c", y: 300, flowchart: { steps: [{ text: "Seed" }, { text: "Plant" }] } }),
    element({ id: "d", y: 400, image: { src: "https://photos.example/p.webp", width: 10, height: 10 } }),
  ];
  const video: Slide = { ...createBlankSlide("video"), embedUrl: "https://www.youtube.com/embed/abc" };
  presentation.slides = [blank, video];
  const markdown = presentationToMarkdown(presentation);
  assert.match(markdown, /Big idea & more\nLine two\n\n\| Name \| A \\\| B \|\n\| --- \| --- \|\n\| Ana \|  \|\n/);
  assert.match(markdown, /1\. Seed\n2\. Plant\n/);
  assert.match(markdown, /!\[Photo\]\(https:\/\/photos\.example\/p\.webp\)/);
  assert.match(markdown, /---\n\nVideo: https:\/\/www\.youtube\.com\/embed\/abc\n/);
});

test("htmlToText keeps each paragraph on its own line and decodes entities", () => {
  assert.equal(htmlToText("<p>a &lt; b</p><p>c<br>d</p>"), "a < b\nc\nd");
});

test("the file name is the title, made safe, plus its extension", () => {
  assert.equal(presentationFileName('Fractions: 1/2 & "more"?', ".txt"), "Fractions 1 2 & more.txt");
  assert.equal(presentationFileName("   ", ".docx"), "Presentation.docx");
  // Cut at 100 whole characters: never half an emoji, never a space before the extension.
  assert.equal(presentationFileName(`${"a".repeat(99)}🍎 Quiz`, ".txt"), `${"a".repeat(99)}🍎.txt`);
  assert.equal(presentationFileName(`${"a".repeat(99)} Quiz`, ".txt"), `${"a".repeat(99)}.txt`);
});

test("a custom slide starts with its numbers, and a question that starts with a picture gets its number on its own line", () => {
  const presentation = createBlankPresentation({ title: "Custom" });
  const custom: Slide = { ...createBlankSlide("custom"), itemCount: 3 };
  custom.elements = [element({ text: { html: "<p>Match the words.</p>" } })];
  const pictureFirst: Slide = { ...createBlankSlide("custom") };
  pictureFirst.elements = [element({ image: { src: "https://images.quizmatter.com/uploads/a.webp", width: 10, height: 10 } })];
  presentation.slides = [presentation.slides[0], custom, pictureFirst];
  const markdown = presentationToMarkdown(presentation);
  assert.match(markdown, /---\n\n2–4\. Match the words\.\n/);
  assert.match(markdown, /---\n\n5\.\n\n!\[Photo\]/);
});

test("a canvas answer goes in the key under its number, and a blank slide's Reveal stays with the slide", () => {
  const presentation = createBlankPresentation({ title: "Answers" });
  const canvas: Slide = { ...createBlankSlide("short-answer"), question: "Draw it.", answerType: "canvas" };
  canvas.elements = [
    element({ id: "a1", containerId: "answer", text: { html: "<p>A circle</p>" } }),
    element({ id: "a2", y: 50, containerId: "answer", image: { src: "https://images.quizmatter.com/uploads/c.webp", width: 10, height: 10 } }),
  ];
  const blank: Slide = { ...createBlankSlide("blank"), correctAnswer: "Talk about it" };
  const noAnswer: Slide = { ...createBlankSlide("short-answer"), question: "Anything?" };
  presentation.slides = [presentation.slides[0], canvas, blank, noAnswer];
  const markdown = presentationToMarkdown(presentation);
  assert.match(markdown, /---\n\n\*\*Reveal:\*\* Talk about it\n/);
  assert.match(markdown, /## Answer key\n\n1\. A\. Jupiter\n\n2\. A circle\n\n!\[Photo\]\(https:\/\/images\.quizmatter\.com\/uploads\/c\.webp\)\n$/);
  assert.doesNotMatch(markdown, /Draw it\.[\s\S]*A circle[\s\S]*Answer key/);
});

test("only the chosen slides, in order, and their questions are numbered again from 1", () => {
  const presentation = createBlankPresentation({ title: "Pick" });
  const q = (question: string, correctAnswer: string): Slide => ({ ...createBlankSlide("short-answer"), question, correctAnswer });
  presentation.slides = [q("One?", "1"), q("Two?", "2"), q("Three?", "3"), q("Four?", "4")];
  const markdown = presentationToMarkdown(presentation, [2, 4]);
  assert.doesNotMatch(markdown, /One\?|Three\?/);
  assert.match(markdown, /1\. Two\?[\s\S]*2\. Four\?/);
  assert.match(markdown, /## Answer key\n\n1\. 2\n2\. 4\n$/);
});

test("parseSlideNumbers reads 1-3, 5 style lists and says what's wrong", () => {
  assert.deepEqual(parseSlideNumbers("1-3, 5", 10), { numbers: [1, 2, 3, 5] });
  assert.deepEqual(parseSlideNumbers(" 5,2 , 2-3 ,", 10), { numbers: [2, 3, 5] });
  assert.deepEqual(parseSlideNumbers("4–2", 10), { numbers: [2, 3, 4] });
  assert.ok("error" in parseSlideNumbers("", 10));
  assert.ok("error" in parseSlideNumbers("1-x", 10));
  assert.ok("error" in parseSlideNumbers("0", 10));
  assert.match((parseSlideNumbers("11", 10) as { error: string }).error, /10 slides/);
});

test("pictures in the options go under their letter, and the answer key names the right letter with its picture", () => {
  const presentation = createBlankPresentation({ title: "Pictures" });
  const slide = { ...createBlankSlide("choice"), question: "Which is a frog?" };
  const photo = (id: string, containerId: string | null, x = 0, y = 0) =>
    element({ id, x, y, containerId, image: { src: `https://images.quizmatter.com/uploads/${id}.webp`, width: 10, height: 10 } });
  slide.elements = [
    // Placed relative to their boxes: the free one's y is bigger, the question box's smaller, but they read box by box.
    photo("free", null, 0, 5),
    ...slide.options.map((option, index) => photo(`o${index}`, option.id, 900 - index * 100, 900)),
    photo("q", "question", 0, 300),
  ];
  slide.correctOptionId = slide.options[2].id;
  presentation.slides = [slide];
  const markdown = presentationToMarkdown(presentation);
  const at = (id: string) => markdown.indexOf(`/${id}.webp`);
  assert.ok(at("q") < at("o0") && at("o3") < at("free"), "question box first, then the options, then the free picture");
  assert.match(markdown, /- A\.\n {2}!\[Photo\]\([^)]*o0\.webp\)\n- B\.\n {2}!\[Photo\]\([^)]*o1\.webp\)\n- C\.\n/);
  assert.match(markdown, /## Answer key\n\n1\. C\.\n\n!\[Photo\]\([^)]*o2\.webp\)\n$/);
});

test("a cropped photo says so in the text file", () => {
  const presentation = createBlankPresentation({ title: "Crop" });
  const blank = createBlankSlide("blank");
  blank.elements = [element({ crop: { x: 0, y: 0, width: 0.5, height: 1 }, image: { src: "https://images.quizmatter.com/uploads/k.webp", width: 10, height: 10 } })];
  presentation.slides = [blank];
  assert.match(presentationToMarkdown(presentation), /!\[Photo \(cropped on the slide\)\]\(https:\/\/images\.quizmatter\.com\/uploads\/k\.webp\)/);
});

test("a clock, calendar, bar graph or diagram never changed shows its starting look, like the slide", () => {
  const presentation = createBlankPresentation({ title: "Untouched" });
  const blank = createBlankSlide("blank");
  // New elements save no setting (the store's addElement), only their asset.
  blank.elements = ["flowchart", "cycle", "mind-map", "tree-diagram", "factor-tree", "bar-graph", "clock", "digital-clock", "calendar-page"].map(
    (assetId, i) => element({ id: assetId, assetId, y: i * 10 }),
  );
  presentation.slides = [blank];
  const markdown = presentationToMarkdown(presentation);
  assert.match(markdown, /1\. First\n2\. Next\n3\. Last/);
  assert.match(markdown, /1\. Egg\n2\. Caterpillar/);
  assert.match(markdown, /- Topic\n {2}- Idea 1/);
  assert.match(markdown, /- Animals\n {2}- Mammals\n {4}- Dog/);
  assert.match(markdown, /- 48\n {2}- 6\n {4}- 2/);
  assert.match(markdown, /- A: 4\n- B: 7\n- C: 2/);
  // The analog clock shows only its hands; the digital one always shows AM or PM.
  assert.match(markdown, /\nClock: 10:10\n\nClock: 10:10 AM\n/);
  assert.match(markdown, /Calendar: Thursday, January 1, 2026/);
});

test("a set clock: the digital one says PM, the analog one never does", () => {
  const presentation = createBlankPresentation({ title: "Clocks" });
  const blank = createBlankSlide("blank");
  blank.elements = [
    element({ id: "a", assetId: "clock", clockTime: { hours: 3, minutes: 5, pm: true } }),
    element({ id: "d", assetId: "digital-clock", y: 50, clockTime: { hours: 3, minutes: 5, pm: true } }),
  ];
  presentation.slides = [blank];
  assert.match(presentationToMarkdown(presentation), /Clock: 3:05\n\nClock: 3:05 PM\n/);
});

test("in the answer key, an answer with more than one part has a blank line before the next number", () => {
  const presentation = createBlankPresentation({ title: "Key" });
  const canvas: Slide = { ...createBlankSlide("short-answer"), question: "Show it.", answerType: "canvas" };
  canvas.elements = [element({ containerId: "answer", image: { src: "https://images.quizmatter.com/uploads/k.webp", width: 10, height: 10 } })];
  const last: Slide = { ...createBlankSlide("short-answer"), question: "Last?", correctAnswer: "Mars" };
  presentation.slides = [presentation.slides[0], canvas, last];
  assert.match(presentationToMarkdown(presentation), /## Answer key\n\n1\. A\. Jupiter\n\n2\.\n\n!\[Photo\]\([^)]*\)\n\n3\. Mars\n$/);
});
