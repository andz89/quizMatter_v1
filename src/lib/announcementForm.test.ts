import { test } from "node:test";
import assert from "node:assert/strict";
import { NEW_ANNOUNCEMENT, changeType, fromTimeInput, splitWords, toSaved, toTimeInput } from "./announcementForm";
import { announcementSchema } from "./announcements";

const photo = { kind: "photo" as const, src: "https://images.quizmatter.com/uploads/a.webp" };
// A form with something typed in every part.
const filled = {
  ...NEW_ANNOUNCEMENT,
  name: "Hello",
  modal_text: "Post text",
  modal_attachment: photo,
  modal_html: "<p>Html</p>",
  bar_html: "<p>Bar text</p>",
  modal_auto_close: 20,
  modal_show_after: 15,
};

test("toSaved: a top bar sends no modal content", () => {
  const sent = toSaved(changeType(filled, "bar"), "<p>Bar text</p>", "");
  assert.equal(sent.modal_text, "");
  assert.equal(sent.modal_attachment, null);
  assert.equal(sent.modal_html, "");
  assert.equal(sent.bar_html, "<p>Bar text</p>");
  assert.equal(sent.modal_auto_close, 0);
});

test("toSaved: an html modal sends no post, a post sends no html, neither sends the bar", () => {
  const html = toSaved({ ...filled, modal_format: "html" }, filled.bar_html, "");
  assert.equal(html.modal_text, "");
  assert.equal(html.modal_attachment, null);
  assert.equal(html.modal_html, "<p>Html</p>");
  assert.equal(html.bar_html, "");
  const post = toSaved(filled, filled.bar_html, "");
  assert.equal(post.modal_text, "Post text");
  assert.deepEqual(post.modal_attachment, photo);
  assert.equal(post.modal_html, "");
});

test("toSaved: only a corner box keeps closing itself", () => {
  assert.equal(toSaved(filled, "", "").modal_auto_close, 0);
  assert.equal(toSaved(changeType(filled, "corner"), "", "").modal_auto_close, 20);
});

test("toSaved: a modal and a corner box keep their wait, a top bar shows at once", () => {
  assert.equal(NEW_ANNOUNCEMENT.modal_show_after, 0);
  assert.equal(toSaved(filled, "", "").modal_show_after, 15);
  assert.equal(toSaved(changeType(filled, "corner"), "", "").modal_show_after, 15);
  assert.equal(toSaved(changeType(filled, "bar"), "<p>Bar</p>", "").modal_show_after, 0);
});

test("toSaved splits the field words and passes the schema", () => {
  const sent = toSaved(filled, "", " English, , Filipino ");
  assert.deepEqual(sent.field_words, ["English", "Filipino"]);
  assert.equal(announcementSchema.safeParse(sent).success, true);
});

test("changeType: a Large modal becomes a Medium corner box; switching back keeps what was typed", () => {
  const corner = changeType({ ...filled, modal_size: "large" }, "corner");
  assert.equal(corner.modal_display, "corner");
  assert.equal(corner.modal_size, "medium");
  assert.equal(corner.show_modal, true);
  assert.equal(corner.show_bar, false);
  assert.equal(changeType({ ...filled, modal_size: "small" }, "corner").modal_size, "small");
  const back = changeType(changeType(corner, "modal"), "corner");
  assert.equal(back.modal_auto_close, 20);
  assert.equal(back.modal_text, "Post text");
  const bar = changeType(corner, "bar");
  assert.equal(bar.show_bar, true);
  assert.equal(bar.show_modal, false);
  assert.equal(bar.modal_display, "center");
});

test("toTimeInput / fromTimeInput use Philippine time", () => {
  assert.equal(toTimeInput("2026-11-02T01:30:00.000Z"), "2026-11-02T09:30");
  assert.equal(fromTimeInput("2026-11-02T09:30"), "2026-11-02T01:30:00.000Z");
  assert.equal(toTimeInput(null), "");
  assert.equal(fromTimeInput(""), null);
});

test("splitWords drops empty words", () => {
  assert.deepEqual(splitWords("a, b ,,c"), ["a", "b", "c"]);
});
