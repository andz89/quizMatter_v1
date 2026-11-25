import { test } from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import { AllSelection, EditorState, TextSelection, type Selection } from "@tiptap/pm/state";
import type { Node as PmNode } from "@tiptap/pm/model";
import { TEXT_EXTENSIONS } from "./richText";
import { applyTextCase, changeCase, type TextCase } from "./textCase";

const run = (text: string, kind: TextCase) => changeCase(text, kind).join("");

test("upper and lower change every letter", () => {
  assert.equal(run("hello WORLD 12", "upper"), "HELLO WORLD 12");
  assert.equal(run("hello WORLD 12", "lower"), "hello world 12");
});

test("sentence case: first letter and after . ! ? followed by a space", () => {
  assert.equal(run("hELLO. how ARE you? fine! ok", "sentence"), "Hello. How are you? Fine! Ok");
  assert.equal(run("  (what) is it", "sentence"), "  (What) is it");
  assert.equal(run("1. WHAT is it", "sentence"), "1. What is it");
});

test("sentence case: a line break mid-sentence is not a new sentence", () => {
  assert.equal(run("THE CAT\nSAT", "sentence"), "The cat\nsat");
});

test("sentence case keeps I, I'm and I'll", () => {
  assert.equal(run("WHAT DO I NEED? I THINK I'M SURE I’LL KNOW.", "sentence"), "What do I need? I think I'm sure I’ll know.");
  assert.equal(run("IN IT", "sentence"), "In it");
  assert.equal(run("PAANO I-CLICK ITO", "sentence"), "Paano i-click ito");
});

test("web addresses, emails and file names stay as typed in sentence and title case", () => {
  const text = "visit www.DepEd.gov.ph or email Juan.Cruz@gmail.com, see notes.docx";
  assert.equal(run(text, "sentence"), "Visit www.DepEd.gov.ph or email Juan.Cruz@gmail.com, see notes.docx");
  assert.equal(run(text, "title"), "Visit www.DepEd.gov.ph Or Email Juan.Cruz@gmail.com, See notes.docx");
  assert.equal(run("go to https://quizmatter.com now", "title"), "Go To https://quizmatter.com Now");
  assert.equal(run("www.deped.gov.ph", "upper"), "WWW.DEPED.GOV.PH");
});

test("title case: apostrophes inside words, opening quotes before them", () => {
  assert.equal(run("don't STOP the bus", "title"), "Don't Stop The Bus");
  assert.equal(run("it’s MARY-ANN", "title"), "It’s Mary-Ann");
  assert.equal(run("say 'hello world' now", "title"), "Say 'Hello World' Now");
  assert.equal(run("3rd place", "title"), "3rd Place");
});

test("separate accent marks stay inside their word", () => {
  assert.equal(run("cafés and niños", "title"), "Cafés And Niños");
  assert.equal(run("CAFÉS. NIÑOS", "sentence"), "Cafés. Niños");
});

test("Greek capital sigma at a word's end lowercases to the final form", () => {
  assert.equal(run("ΟΔΟΣ ΣΟΦΙΑ", "lower"), "οδος σοφια");
  assert.equal(run("ΟΔΟΣ", "title"), "Οδος");
});

test("one output per input character, even when a letter grows", () => {
  const out = changeCase("straße", "upper");
  assert.equal(out.length, 6);
  assert.equal(out.join(""), "STRASSE");
});

// applyTextCase on real editor text: a bold piece in the middle and a line break.
const schema = getSchema(TEXT_EXTENSIONS);
const bold = schema.marks.bold.create();
const doc = schema.node("doc", null, [
  schema.node("paragraph", null, [schema.text("hello. "), schema.text("wor", [bold]), schema.text("ld straße end")]),
  schema.node("paragraph", null, [schema.text("SECOND line"), schema.node("hardBreak"), schema.text("AFTER")]),
]);
// Each paragraph as its pieces, bold ones starred, a line break as <br>.
const pieces = (d: PmNode) =>
  d.children.map((p) => {
    const out: string[] = [];
    p.forEach((n) => out.push(n.isText ? `${n.text}${n.marks.length ? "*" : ""}` : "<br>"));
    return out.join("|");
  });
const apply = (kind: TextCase, select: (d: PmNode) => Selection) => {
  let state = EditorState.create({ doc });
  state = state.apply(state.tr.setSelection(select(state.doc)));
  const tr = state.tr;
  assert.equal(applyTextCase(tr, kind), true);
  const next = state.apply(tr);
  return { pieces: pieces(next.doc), selected: next.doc.textBetween(next.selection.from, next.selection.to, "/", "#") };
};

test("applyTextCase: all the text, keeping bold and the line break", () => {
  const { pieces: out } = apply("sentence", (d) => new AllSelection(d));
  assert.deepEqual(out, ["Hello. |Wor*|ld straße end", "Second line|<br>|after"]);
});

test("applyTextCase: a selection in the middle changes only it, judged by the whole sentence", () => {
  // "orld s": across the bold edge, mid-sentence, so Sentence case leaves it lower.
  const sentence = apply("sentence", (d) => TextSelection.create(d, 9, 15));
  assert.deepEqual(sentence.pieces, ["hello. |wor*|ld straße end", "SECOND line|<br>|AFTER"]);
  const upper = apply("upper", (d) => TextSelection.create(d, 9, 15));
  assert.deepEqual(upper.pieces, ["hello. |wOR*|LD Straße end", "SECOND line|<br>|AFTER"]);
  assert.equal(upper.selected, "ORLD S");
});

test("applyTextCase: a letter that grows keeps the selection on the changed words", () => {
  const { pieces: out, selected } = apply("upper", (d) => TextSelection.create(d, 11, 21));
  assert.deepEqual(out, ["hello. |wor*|LD STRASSE end", "SECOND line|<br>|AFTER"]);
  assert.equal(selected, "LD STRASSE ");
});

test("applyTextCase: across paragraphs, and the whole text when nothing is selected", () => {
  const across = apply("lower", (d) => TextSelection.create(d, 16, d.child(0).nodeSize + 7));
  assert.deepEqual(across.pieces, ["hello. |wor*|ld straße end", "second line|<br>|AFTER"]);
  const empty = apply("lower", (d) => TextSelection.create(d, 3));
  assert.deepEqual(empty.pieces, ["hello. |wor*|ld straße end", "second line|<br>|after"]);
});
