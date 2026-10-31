import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODAL_SIZES,
  announcementSchema,
  isSameVisit,
  manilaDay,
  myAnnouncementSchema,
  pageGroup,
  pickForPage,
  type MyAnnouncement,
} from "./announcements";

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
  modal_text: "Hi",
  modal_attachment: null,
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
  modal_size: "large",
};

const PHOTO = "https://images.quizmatter.com/uploads/";

test("announcementSchema accepts a valid input", () => {
  assert.equal(announcementSchema.safeParse(valid).success, true);
});

test("announcementSchema takes a picture, a YouTube card or a Facebook post, with or without text", () => {
  for (const change of [
    { modal_text: "", modal_attachment: { kind: "photo", src: `${PHOTO}a.webp`, width: 800, height: 600 } },
    { modal_attachment: { kind: "photo", src: `${PHOTO}a.webp` } },
    {
      modal_attachment: {
        kind: "youtube",
        video_id: "dQw4w9WgXcQ",
        title: "A song",
        src: `${PHOTO}t.jpg`,
        width: 1280,
        height: 720,
      },
    },
    { modal_attachment: { kind: "facebook", href: "https://www.facebook.com/DepEd/posts/1", video: false } },
    { modal_attachment: { kind: "facebook", href: "https://fb.watch/abcDEF123/", video: true } },
  ]) {
    assert.equal(announcementSchema.safeParse({ ...valid, ...change }).success, true, JSON.stringify(change));
  }
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
    { modal_text: "x".repeat(5001) },
    { modal_text: "  ", modal_attachment: null },
    { modal_attachment: { kind: "photo", src: "https://evil.example/a.png" } },
    { modal_attachment: { kind: "photo", src: `${PHOTO}a.webp`, width: 0 } },
    { modal_attachment: { kind: "photo", src: `${PHOTO}a.webp`, onerror: "alert(1)" } },
    { modal_attachment: { kind: "youtube", video_id: "bad id", title: "x", src: `${PHOTO}t.jpg` } },
    { modal_attachment: { kind: "youtube", video_id: "dQw4w9WgXcQ", title: "t".repeat(201), src: `${PHOTO}t.jpg` } },
    { modal_attachment: { kind: "youtube", video_id: "dQw4w9WgXcQ", title: "x", src: "https://i.ytimg.com/vi/x/hq.jpg" } },
    { modal_attachment: { kind: "iframe", src: `${PHOTO}a.webp` } },
    { modal_attachment: { kind: "facebook", href: "https://evil.example/facebook.com/posts/1", video: false } },
    { modal_attachment: { kind: "facebook", href: "https://www.facebook.com/DepEd", video: false } },
    { modal_attachment: { kind: "facebook", href: "https://www.facebook.com/DepEd/posts/1" } },
    { modal_attachment: { kind: "facebook", href: "https://www.facebook.com/watch/?v=1", video: true, src: `${PHOTO}a.webp` } },
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
    modal_text: "m",
    modal_attachment: null,
    modal_close_after: 0,
    show_bar: true,
    bar_html: "b",
    bar_close_after: 0,
    repeat: "once",
    pages: ["all"],
    created_at: createdAt,
    modal_size: "large",
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

test("isSameVisit: same account and same Philippine day only", () => {
  const saved = { day: "2026-10-30", userId: "teacher-a" };
  assert.equal(isSameVisit(saved, { day: "2026-10-30", userId: "teacher-a" }), true);
  // Another teacher logged in on the same tab (a shared computer) never gets the first one's list.
  assert.equal(isSameVisit(saved, { day: "2026-10-30", userId: "teacher-b" }), false);
  // After midnight a "once a day" one may show again.
  assert.equal(isSameVisit(saved, { day: "2026-10-31", userId: "teacher-a" }), false);
  assert.equal(isSameVisit(null, { day: "2026-10-30", userId: "teacher-a" }), false);
});

test("announcementSchema takes the three modal sizes only", () => {
  for (const modal_size of ["small", "medium", "large"]) {
    assert.equal(announcementSchema.safeParse({ ...valid, modal_size }).success, true, modal_size);
  }
  assert.equal(announcementSchema.safeParse({ ...valid, modal_size: "huge" }).success, false);
  // Only the width is set; the height always fits the text.
  assert.deepEqual(
    MODAL_SIZES.map((size) => ({ ...size, label: undefined })),
    [
      { key: "small", width: 300, label: undefined },
      { key: "medium", width: 500, label: undefined },
      { key: "large", width: 672, label: undefined },
    ],
  );
});

test("a my_announcements row without a size (saved before sizes) is large", () => {
  const { modal_size, ...old } = row("a", "2026-01-01T00:00:00Z");
  void modal_size;
  assert.equal(myAnnouncementSchema.parse(old).modal_size, "large");
});
