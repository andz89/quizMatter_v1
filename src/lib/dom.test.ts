import { test } from "node:test";
import assert from "node:assert/strict";
import { isTextFieldOrDialog } from "./dom";

// A plain stand-in for a page element (Node has no DOM).
function fakeElement(tagName: string, options: { isContentEditable?: boolean; inDialog?: boolean } = {}) {
  return {
    tagName,
    isContentEditable: options.isContentEditable ?? false,
    closest: (selector: string) => (options.inDialog && selector === '[role="dialog"]' ? {} : null),
  } as unknown as EventTarget;
}

test("an input is a text field", () => {
  assert.equal(isTextFieldOrDialog(fakeElement("INPUT")), true);
});

test("rich text is a text field", () => {
  assert.equal(isTextFieldOrDialog(fakeElement("DIV", { isContentEditable: true })), true);
});

test("anything inside a dialog counts", () => {
  assert.equal(isTextFieldOrDialog(fakeElement("DIV", { inDialog: true })), true);
});

test("a plain element is not a text field or dialog", () => {
  assert.equal(isTextFieldOrDialog(fakeElement("DIV")), false);
});

test("no target is not a text field or dialog", () => {
  assert.equal(isTextFieldOrDialog(null), false);
});
