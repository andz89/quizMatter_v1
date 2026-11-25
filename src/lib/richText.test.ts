import { test } from "node:test";
import assert from "node:assert/strict";
import { markupToHtml, stripMarkup, textToHtml, tidySavedHtml } from "@/lib/richText";

test("textToHtml keeps typed spaces, one line per paragraph", () => {
  assert.equal(textToHtml("Name:     Score:\n   Indented"), "<p>Name:     Score:</p><p>   Indented</p>");
});

test("textToHtml turns Windows line ends and tabs into line breaks and spaces (text is read back keeping spaces)", () => {
  assert.equal(textToHtml("One\r\nTwo\rThree"), "<p>One</p><p>Two</p><p>Three</p>");
  assert.equal(textToHtml("Answer:\tParis"), "<p>Answer: Paris</p>");
  assert.equal(markupToHtml("**Answer:**\tParis\r\nNext"), "<p><strong>Answer:</strong> Paris</p><p>Next</p>");
});

test("stripMarkup tidies the same way, so a Claude import's plain text matches its HTML", () => {
  assert.equal(stripMarkup("**One**\r\nTwo\tThree"), "One\nTwo Three");
});

test("tidySavedHtml cleans tabs and line ends that older imports saved, and keeps typed spaces", () => {
  // The old textToHtml split only at "\n", so "One\r\nTwo" was saved with a "\r" at the line's end.
  assert.equal(tidySavedHtml("<p>One\r</p><p>Two</p>"), "<p>One</p><p>Two</p>");
  assert.equal(tidySavedHtml("<p>Answer:\tParis</p>"), "<p>Answer: Paris</p>");
  assert.equal(tidySavedHtml("<p>Two\rThree</p>\n<p>x</p>"), "<p>Two Three</p><p>x</p>");
  assert.equal(tidySavedHtml("<p>Name:     Score:</p><p>   Indented</p>"), "<p>Name:     Score:</p><p>   Indented</p>");
});
