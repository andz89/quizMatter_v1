import { test } from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { readWordBytes, WORD_FILE_ERROR, WORD_FILE_TOO_BIG, WORD_TEXT_MAX_BYTES } from "./wordFile";
import { WORD_LINES_MAX } from "./wordText";

const docx = (body: string) =>
  zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8(`<w:document><w:body>${body}</w:body></w:document>`) });
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

test("reads the lines of a .docx", () => {
  assert.deepEqual(readWordBytes(docx(p("1. What gas?") + p("a. Oxygen"))), { lines: ["1. What gas?", "a. Oxygen"], more: false });
});

test("lists at most WORD_LINES_MAX lines and says there were more", () => {
  const result = readWordBytes(docx(Array.from({ length: WORD_LINES_MAX + 1 }, (_, i) => p(`Line ${i}`)).join("")));
  assert.ok("lines" in result);
  assert.equal(result.lines.length, WORD_LINES_MAX);
  assert.equal(result.more, true);
});

test("a file that isn't a Word file gives the error", () => {
  assert.deepEqual(readWordBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), { error: WORD_FILE_ERROR });
  assert.deepEqual(readWordBytes(zipSync({ "a.txt": strToU8("hi") })), { error: WORD_FILE_ERROR });
});

test("a text part too big once unzipped is refused before it's unzipped", () => {
  const huge = "<w:p><w:r><w:t>" + "a".repeat(WORD_TEXT_MAX_BYTES) + "</w:t></w:r></w:p>";
  assert.deepEqual(readWordBytes(docx(huge)), { error: WORD_FILE_TOO_BIG });
});

test("Word's automatic numbering comes from numbering.xml", () => {
  const numbering = `<w:numbering><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const listP = (t: string) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
  const bytes = zipSync({
    "word/document.xml": strToU8(`<w:document><w:body>${listP("First")}${listP("Second")}</w:body></w:document>`),
    "word/numbering.xml": strToU8(numbering),
  });
  assert.deepEqual(readWordBytes(bytes), { lines: ["1. First", "2. Second"], more: false });
});
