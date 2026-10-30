import { test } from "node:test";
import assert from "node:assert/strict";
import { announcementSchema, manilaDay, pageGroup, pickForPage, type MyAnnouncement } from "./announcements";

test("pageGroup maps paths to groups", () => {
  assert.equal(pageGroup("/"), "my_presentations");
  assert.equal(pageGroup("/presentations"), "my_presentations");
  assert.equal(pageGroup("/quizmatter"), "quizmatter");
  assert.equal(pageGroup("/teachers"), "other_teachers");
  assert.equal(pageGroup("/teachers/ria-santos"), "teacher_profiles");
  assert.equal(pageGroup("/presentation/abc"), "presentation_view");
  assert.equal(pageGroup("/presentation/abc/edit"), "editor");
  assert.equal(pageGroup("/presentation/new"), "editor");
  assert.equal(pageGroup("/account"), "account");
  for (const path of ["/admin", "/login", "/privacy", "/maintenance", "/presentation/abc/edit/x"]) {
    assert.equal(pageGroup(path), null, path);
  }
});

const valid = {
  id: null,
  name: "Hello",
  is_on: true,
  starts_at: null,
  ends_at: null,
  show_modal: true,
  modal_html: "<p>Hi</p>",
  modal_close_after: 0,
  show_bar: false,
  bar_html: "",
  bar_close_after: 0,
  repeat: "once",
  pages: ["all"],
  genders: [],
  age_min: null,
  age_max: null,
  provinces: [],
  town_words: [],
  education_levels: [],
  field_words: [],
  presentations_min: null,
  presentations_max: null,
  roles: [],
};

test("announcementSchema accepts a valid input", () => {
  assert.equal(announcementSchema.safeParse(valid).success, true);
});

test("announcementSchema refuses bad input", () => {
  const bad: Record<string, unknown>[] = [
    { name: "" },
    { name: "x".repeat(101) },
    { modal_close_after: 61 },
    { age_min: 17 },
    { age_min: 40, age_max: 30 },
    { field_words: Array.from({ length: 21 }, (_, i) => `w${i}`) },
    { field_words: ["x".repeat(61)] },
    { show_modal: false, show_bar: false },
    { show_bar: true, bar_html: "" },
    { starts_at: "2026-11-02T00:00:00Z", ends_at: "2026-11-01T00:00:00Z" },
    { pages: [] },
  ];
  for (const change of bad) {
    assert.equal(announcementSchema.safeParse({ ...valid, ...change }).success, false, JSON.stringify(change));
  }
});

function row(id: string, createdAt: string, change: Partial<MyAnnouncement> = {}): MyAnnouncement {
  return {
    id,
    show_modal: true,
    modal_html: "m",
    modal_close_after: 0,
    show_bar: true,
    bar_html: "b",
    bar_close_after: 0,
    repeat: "once",
    pages: ["all"],
    created_at: createdAt,
    ...change,
  };
}

test("pickForPage fits pages", () => {
  assert.equal(pickForPage([row("a", "2026-01-01T00:00:00Z")], "saved", new Set()).modals.length, 1);
  assert.equal(pickForPage([row("a", "2026-01-01T00:00:00Z", { pages: ["editor"] })], "saved", new Set()).modals.length, 0);
});

test("pickForPage skips closed parts", () => {
  const out = pickForPage([row("a", "2026-01-01T00:00:00Z")], "saved", new Set(["a:modal"]));
  assert.equal(out.modals.length, 0);
  assert.equal(out.bars.length, 1);
});

test("pickForPage: 2 newest bars, modals newest first", () => {
  const list = [row("a", "2026-01-01T00:00:00Z"), row("c", "2026-03-01T00:00:00Z"), row("b", "2026-02-01T00:00:00Z")];
  const out = pickForPage(list, "saved", new Set());
  assert.deepEqual(out.bars.map((r) => r.id), ["c", "b"]);
  assert.deepEqual(out.modals.map((r) => r.id), ["c", "b", "a"]);
});

test("manilaDay uses Philippine time", () => {
  assert.equal(manilaDay(new Date("2026-10-30T16:30:00Z")), "2026-10-31");
  assert.equal(manilaDay(new Date("2026-10-30T15:59:00Z")), "2026-10-30");
});
