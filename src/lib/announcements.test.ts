import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODAL_SIZES,
  announcementSchema,
  isInternalLink,
  isSameVisit,
  manilaDay,
  myAnnouncementSchema,
  pageGroup,
  pickForPage,
  sandboxedHtml,
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
  education_levels: [],
  field_words: [],
  presentations_min: null,
  presentations_max: null,
  roles: [],
  modal_size: "large",
  modal_format: "post",
  modal_html: "",
  modal_height: 400,
  bar_format: "text",
  bar_height: 60,
};

const PHOTO = "https://images.quizmatter.com/uploads/";

test("announcementSchema takes an html bar up to 100,000 characters, a text bar up to 1,000", () => {
  const bar = { ...valid, show_modal: false, modal_text: "", show_bar: true, bar_format: "html", bar_html: `<b>Hi</b>${" ".repeat(2000)}`, bar_height: 80 };
  assert.equal(announcementSchema.safeParse(bar).success, true);
  for (const change of [
    { bar_format: "text" },
    { bar_html: "x".repeat(100_001) },
    { bar_height: 29 },
    { bar_height: 301 },
    { bar_format: "script" },
  ]) {
    assert.equal(announcementSchema.safeParse({ ...bar, ...change }).success, false, JSON.stringify(change).slice(0, 80));
  }
});

test("announcementSchema takes an html modal with its html and height", () => {
  const html = { ...valid, modal_format: "html", modal_text: "", modal_html: "<h1>Hi</h1><script>go()</script>", modal_height: 300 };
  assert.equal(announcementSchema.safeParse(html).success, true);
  assert.equal(announcementSchema.safeParse({ ...html, modal_html: "x".repeat(100_000) }).success, true);
  for (const change of [
    { modal_html: "  " },
    { modal_html: "x".repeat(100_001) },
    { modal_height: 99 },
    { modal_height: 1_001 },
    { modal_format: "script" },
  ]) {
    assert.equal(announcementSchema.safeParse({ ...html, ...change }).success, false, JSON.stringify(change).slice(0, 80));
  }
});

test("sandboxedHtml puts the lock list first, then the html", () => {
  const doc = sandboxedHtml("<p>Hi</p>");
  const lock = doc.indexOf('http-equiv="Content-Security-Policy"');
  assert.ok(lock > 0 && lock < doc.indexOf("<p>Hi</p>"));
  assert.match(doc, /default-src 'none'/);
  assert.match(doc, /img-src https:\/\/images\.quizmatter\.com /);
  assert.doesNotMatch(doc, /connect-src/);
  assert.match(doc, /<base target="_blank">/);
});

test("a my_announcements row without the html fields (saved before them) is a post", () => {
  const row = myAnnouncementSchema.parse({
    id: "a", show_modal: true, modal_text: "m", modal_attachment: null, modal_close_after: 0, show_bar: false,
    bar_html: "", bar_close_after: 0, repeat: "once", pages: ["all"], created_at: "2026-01-01T00:00:00Z",
  });
  assert.equal(row.modal_format, "post");
  assert.equal(row.modal_html, "");
  assert.equal(row.modal_height, 400);
  assert.equal(row.bar_format, "text");
  assert.equal(row.bar_height, 60);
});

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
    { show_bar: true, bar_html: "<p>Both</p>" },
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
    modal_format: "post",
    modal_html: "",
    modal_height: 400,
    bar_format: "text",
    bar_height: 60,
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

test("isInternalLink is true only for a path in the app", () => {
  assert.equal(isInternalLink("/saved"), true);
  assert.equal(isInternalLink("/teachers/ana?tab=1"), true);
  assert.equal(isInternalLink("//x.com"), false);
  assert.equal(isInternalLink("https://x.com"), false);
  // Browsers read a backslash as a slash, so these go to x.com.
  assert.equal(isInternalLink("/\\x.com"), false);
  assert.equal(isInternalLink("/\t/x.com"), false);
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
