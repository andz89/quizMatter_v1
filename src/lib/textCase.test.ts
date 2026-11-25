import { test } from "node:test";
import assert from "node:assert/strict";
import { changeCase } from "./textCase";

const run = (text: string, kind: Parameters<typeof changeCase>[1]) => changeCase(text, kind).join("");

test("upper and lower change every letter", () => {
  assert.equal(run("hello WORLD 12", "upper"), "HELLO WORLD 12");
  assert.equal(run("hello WORLD 12", "lower"), "hello world 12");
});

test("sentence case: first letter and after . ! ?", () => {
  assert.equal(run("hELLO. how ARE you? fine!ok", "sentence"), "Hello. How are you? Fine!Ok");
  assert.equal(run("  (what) is it", "sentence"), "  (What) is it");
});

test("sentence case: a line break mid-sentence is not a new sentence", () => {
  assert.equal(run("THE CAT\nSAT", "sentence"), "The cat\nsat");
});

test("title case keeps apostrophes inside words", () => {
  assert.equal(run("don't STOP the bus", "title"), "Don't Stop The Bus");
  assert.equal(run("it’s MARY-ANN", "title"), "It’s Mary-Ann");
  assert.equal(run("3rd place", "title"), "3rd Place");
});

test("one output per input character, even when a letter grows", () => {
  const out = changeCase("straße", "upper");
  assert.equal(out.length, 6);
  assert.equal(out.join(""), "STRASSE");
});
