import { test } from "node:test";
import assert from "node:assert/strict";
import { PICKED_LINES_MAX, droppedTextHtml, parseNumbering, pickedSlideTexts, stripItemMark, suggestItems, wordLines } from "./wordText";

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

const m = (text: string) => `<m:r><m:t>${text}</m:t></m:r>`;
const mathLine = (math: string) => wordLines(`<w:p><m:oMath>${math}</m:oMath></w:p>`)[0];

test("equations are read: powers, small numbers below, fractions, roots, brackets, sums", () => {
  assert.equal(
    wordLines(`<w:p><w:r><w:t xml:space="preserve">Solve </w:t></w:r><m:oMath><m:sSup><m:e>${m("x")}</m:e><m:sup>${m("2")}</m:sup></m:sSup>${m("+2=6")}</m:oMath></w:p>`)[0],
    "Solve x²+2=6",
  );
  assert.equal(mathLine(`<m:sSup><m:e>${m("x")}</m:e><m:sup>${m("ab")}</m:sup></m:sSup>`), "x^(ab)");
  assert.equal(mathLine(`${m("H")}<m:sSub><m:e></m:e><m:sub>${m("2")}</m:sub></m:sSub>${m("O")}`), "H₂O");
  assert.equal(mathLine(`<m:f><m:num>${m("1")}</m:num><m:den>${m("2")}</m:den></m:f>`), "1/2");
  assert.equal(mathLine(`<m:f><m:num>${m("x+1")}</m:num><m:den>${m("2")}</m:den></m:f>`), "(x+1)/2");
  assert.equal(mathLine(`<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${m("9")}</m:e></m:rad>`), "√9");
  assert.equal(mathLine(`<m:rad><m:deg>${m("3")}</m:deg><m:e>${m("8")}</m:e></m:rad>`), "³√8");
  assert.equal(mathLine(`<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr><m:e>${m("a")}</m:e></m:d>`), "[a]");
  assert.equal(mathLine(`<m:d><m:e>${m("a+b")}</m:e></m:d>`), "(a+b)");
  assert.equal(
    mathLine(`<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub>${m("i=1")}</m:sub><m:sup>${m("n")}</m:sup><m:e>${m("i")}</m:e></m:nary>`),
    "∑ᵢ₌₁ⁿi",
  );
  assert.equal(mathLine(`<m:nary><m:sub>${m("0")}</m:sub><m:sup>${m("1")}</m:sup><m:e>${m("x")}</m:e></m:nary>`), "∫₀¹x");
});

test("hyphens and symbols are read", () => {
  assert.equal(wordLines(`<w:p><w:r><w:t>well</w:t><w:noBreakHyphen/><w:t>known</w:t><w:softHyphen/></w:r></w:p>`)[0], "well-known");
  assert.equal(
    wordLines(`<w:p><w:r><w:sym w:font="Symbol" w:char="F061"/><w:t xml:space="preserve"> </w:t><w:sym w:font="Symbol" w:char="F0B4"/><w:t xml:space="preserve"> </w:t><w:sym w:font="Symbol" w:char="F044"/></w:r></w:p>`)[0],
    "α × Δ",
  );
  assert.equal(wordLines(`<w:p><w:r><w:sym w:font="Wingdings" w:char="F0FC"/><w:t>Done</w:t></w:r></w:p>`)[0], "Done");
  assert.equal(wordLines(`<w:p><w:r><w:sym w:font="Arial" w:char="00E9"/></w:r></w:p>`)[0], "é");
});

test("stripItemMark removes Roman numerals too", () => {
  assert.equal(stripItemMark("II. Intro"), "Intro");
  assert.equal(stripItemMark("iv) Dog"), "Dog");
  assert.equal(stripItemMark("(xii) Dog"), "Dog");
  assert.equal(stripItemMark("Mr. Smith"), "Mr. Smith");
});

test("suggestItems: a numbered line (or ____ 1.) and the next lines up to 4, stopping at the next question", () => {
  const lines = [
    "Directions: Choose the best answer.",
    "1. What gas do plants take in?",
    "a. Oxygen",
    "b. Carbon dioxide",
    "c. Nitrogen",
    "d. Helium",
    "____ 2. The sun is a star.",
    "a. True",
    "b. False",
    "3) Only one choice",
    "a. Lonely",
    "4. Five lines follow",
    "a", "b", "c", "d", "e",
  ];
  assert.deepEqual(suggestItems(lines), [
    { question: 1, options: [2, 3, 4, 5] },
    { question: 6, options: [7, 8] },
    { question: 11, options: [12, 13, 14, 15] },
  ]);
  assert.deepEqual(suggestItems(["a. no question", "b. here"]), []);
});

test("stripItemMark removes a blank before the number", () => {
  assert.equal(stripItemMark("____ 2. The sun is a star."), "The sun is a star.");
  assert.equal(stripItemMark("_____2) The sun"), "The sun");
  assert.equal(stripItemMark("____ is the capital"), "____ is the capital");
});

test("two choices on one row (a tab or a wide gap before the next letter) become two lines", () => {
  const xml =
    `<w:p><w:r><w:t>A. Acute angle</w:t><w:tab/><w:tab/><w:t>C. Obtuse angle</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t xml:space="preserve">B. Right angle      D. Straight angle</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t>Name</w:t><w:tab/><w:t>Date</w:t></w:r></w:p>`;
  assert.deepEqual(wordLines(xml), ["A. Acute angle", "C. Obtuse angle", "B. Right angle", "D. Straight angle", "Name Date"]);
});

test("suggestItems puts lettered choices in A–D order (two columns read A, C, B, D)", () => {
  const lines = ["1. What kind of angle?", "A. Acute angle", "C. Obtuse angle", "B. Right angle", "D. Straight angle"];
  assert.deepEqual(suggestItems(lines), [{ question: 0, options: [1, 3, 2, 4] }]);
  // Without a letter on each, the order stays as read.
  assert.deepEqual(suggestItems(["1. Q", "Dog", "Cat"]), [{ question: 0, options: [1, 2] }]);
});

test("long runs of spaces and tabs read at once (no freeze)", { timeout: 2000 }, () => {
  const run = " ".repeat(5000);
  const tabs = "</w:t><w:tab/><w:t>".repeat(2000);
  assert.deepEqual(wordLines(`<w:p><w:r><w:t xml:space="preserve">Score:${run}x</w:t></w:r></w:p>`), ["Score: x"]);
  assert.deepEqual(wordLines(`<w:p><w:r><w:t>Name:${tabs}Date</w:t></w:r></w:p>`), ["Name: Date"]);
  assert.deepEqual(wordLines(`<w:p><w:r><w:t xml:space="preserve">A. One${run}C. Three</w:t></w:r></w:p>`), ["A. One", "C. Three"]);
});

// Word's own numbering (the list buttons): the numbers live in numbering.xml, not in the text.
const NUMBERING = `<w:numbering>
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperLetter"/><w:lvlText w:val="%1."/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="2">
    <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="3">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="(%1)"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
  <w:num w:numId="3"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>
  <w:num w:numId="4"><w:abstractNumId w:val="2"/></w:num>
  <w:num w:numId="5"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/></w:lvlOverride></w:num>
  <w:num w:numId="6"><w:abstractNumId w:val="3"/></w:num>
</w:numbering>`;
const np = (numId: string, ilvl: string, text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

test("Word's automatic numbering is written in front of the text", () => {
  const numbering = parseNumbering(NUMBERING);
  const xml =
    np("1", "0", "What is 2+2?") + np("1", "1", "Three") + np("1", "1", "Four") +
    np("1", "0", "What is 3+3?") + np("1", "1", "Six") +
    np("2", "0", "Red") + np("2", "0", "Blue") + np("3", "0", "Green") +
    np("4", "0", "A bullet") + np("0", "0", "No list") + np("5", "0", "Fifth") + np("6", "0", "Roman") +
    `<w:p><w:r><w:t>Plain</w:t></w:r></w:p>`;
  assert.deepEqual(wordLines(xml, numbering), [
    "1. What is 2+2?", "a) Three", "b) Four",
    "2. What is 3+3?", "a) Six",
    "A. Red", "B. Blue", "A. Green",
    "A bullet", "No list", "5. Fifth", "(I) Roman",
    "Plain",
  ]);
  // Without numbering.xml the text is read as before.
  assert.deepEqual(wordLines(np("1", "0", "Hi")), ["Hi"]);
});

test("an old numbering kept by tracked changes isn't counted", () => {
  const numbering = parseNumbering(NUMBERING);
  const xml =
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>` +
    `<w:pPrChange><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr></w:pPrChange></w:pPr>` +
    `<w:r><w:t>Q</w:t></w:r></w:p>`;
  assert.deepEqual(wordLines(xml, numbering), ["1. Q"]);
});

test("suggestions find questions numbered by Word's list button", () => {
  const lines = wordLines(np("1", "0", "What is 2+2?") + np("1", "1", "Three") + np("1", "1", "Four"), parseNumbering(NUMBERING));
  assert.deepEqual(suggestItems(lines), [{ question: 0, options: [1, 2] }]);
});
