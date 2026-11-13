import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODAL_SIZES,
  SEALED_BOX_ESCAPE,
  TYPE_WORDS,
  announcementSchema,
  announcementStatus,
  announcementType,
  cutVideoTitle,
  isInternalLink,
  isSameVisit,
  manilaDay,
  myAnnouncementSchema,
  pageGroup,
  isWaiting,
  pickForPage,
  reopenAt,
  sandboxedHtml,
  stillClosed,
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
  modal_display: "center",
  modal_auto_close: 0,
  modal_show_after: 0,
  repeat_minutes: 0,
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

test("sandboxedHtml has no lock list: outside pictures, fonts and code may load", () => {
  assert.doesNotMatch(sandboxedHtml("<p>Hi</p>"), /Content-Security-Policy/);
});

test("sandboxedHtml puts the helper script (Escape, # links) before the html", () => {
  const doc = sandboxedHtml("<p>Hi</p>");
  const helper = doc.indexOf(SEALED_BOX_ESCAPE);
  assert.ok(helper > 0 && helper < doc.indexOf("<p>Hi</p>"));
  assert.match(doc, /a\[href\^="#"\]/);
  assert.match(doc, /<base target="_blank">/);
});

test("announcementSchema says which box height is wrong", () => {
  const message = (change: object) => announcementSchema.safeParse({ ...valid, ...change }).error?.issues[0].message;
  assert.equal(message({ modal_height: 0 }), "The box height must be 100–1,000 px.");
  assert.equal(message({ bar_height: 0 }), "The bar height must be 30–300 px.");
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
    { modal_attachment: { kind: "facebook", href: "https://www.facebook.com/reel/123", video: true } },
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
    { modal_attachment: { kind: "facebook", href: "https://fb.watch/abcDEF123/", video: true } },
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
    modal_display: "center",
    modal_auto_close: 0,
    modal_show_after: 0,
    repeat_minutes: 0,
    ...change,
  };
}

test("pickForPage fits pages", () => {
  assert.equal(pickForPage([row("a", "2026-01-01T00:00:00Z")], "saved", new Set(), 0).modals.length, 1);
  assert.equal(pickForPage([row("a", "2026-01-01T00:00:00Z", { pages: ["editor"] })], "saved", new Set(), 0).modals.length, 0);
});

test("pickForPage skips closed parts", () => {
  const out = pickForPage([row("a", "2026-01-01T00:00:00Z")], "saved", new Set(["a:modal"]), 0);
  assert.equal(out.modals.length, 0);
  assert.equal(out.bars.length, 1);
});

test("pickForPage: 2 newest bars, modals newest first", () => {
  const list = [row("a", "2026-01-01T00:00:00Z"), row("c", "2026-03-01T00:00:00Z"), row("b", "2026-02-01T00:00:00Z")];
  const out = pickForPage(list, "saved", new Set(), 0);
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

test("announcementSchema takes a corner box, Small or Medium, closing itself after 5–600 seconds", () => {
  const box = { ...valid, modal_display: "corner", modal_size: "small", modal_auto_close: 30 };
  const parsed = announcementSchema.parse(box);
  assert.equal(parsed.modal_display, "corner");
  assert.equal(parsed.modal_auto_close, 30);
  for (const change of [{ modal_size: "medium" }, { modal_auto_close: 0 }, { modal_auto_close: 5 }, { modal_auto_close: 600 }]) {
    assert.equal(announcementSchema.safeParse({ ...box, ...change }).success, true, JSON.stringify(change));
  }
});

test("announcementSchema refuses a bad corner box", () => {
  const box = { ...valid, modal_display: "corner", modal_size: "small", modal_auto_close: 30 };
  const message = (change: object) => announcementSchema.safeParse({ ...box, ...change }).error?.issues[0].message;
  assert.equal(message({ modal_size: "large" }), "A corner box is Small or Medium.");
  assert.equal(message({ modal_auto_close: 4 }), "It closes itself after 5–600 seconds, or never.");
  assert.equal(message({ modal_auto_close: 601 }), "It closes itself after 5–600 seconds, or never.");
  assert.equal(announcementSchema.safeParse({ ...box, modal_display: "side" }).success, false);
  assert.equal(
    announcementSchema.safeParse({ ...valid, modal_auto_close: 10 }).error?.issues[0].message,
    "Only a corner box closes itself.",
  );
});

test("a my_announcements row without the corner fields is a centered modal", () => {
  const { modal_display, modal_auto_close, ...older } = row("a", "2026-01-01T00:00:00Z");
  void modal_display;
  void modal_auto_close;
  const parsed = myAnnouncementSchema.parse(older);
  assert.equal(parsed.modal_display, "center");
  assert.equal(parsed.modal_auto_close, 0);
});

test("pickForPage puts corner boxes in boxes, not modals", () => {
  const list = [
    row("center", "2026-01-01T00:00:00Z", { show_bar: false }),
    row("corner", "2026-02-01T00:00:00Z", { show_bar: false, modal_display: "corner", modal_size: "small" }),
  ];
  assert.deepEqual(pickForPage(list, "saved", new Set(), 0).modals.map((r) => r.id), ["center"]);
  const boxOnly = [list[1]];
  assert.deepEqual(pickForPage(boxOnly, "saved", new Set(), 0).modals, []);
  assert.deepEqual(pickForPage(boxOnly, "saved", new Set(), 0).boxes.map((r) => r.id), ["corner"]);
  assert.deepEqual(pickForPage(boxOnly, "saved", new Set(["corner:modal"]), 0).boxes, []);
});

test("announcementType: a top bar, a corner box or a modal, with its word", () => {
  assert.equal(announcementType({ show_bar: true, modal_display: "center" }), "bar");
  assert.equal(announcementType({ show_bar: false, modal_display: "corner" }), "corner");
  assert.equal(announcementType({ show_bar: false, modal_display: "center" }), "modal");
  assert.equal(TYPE_WORDS.corner, "corner box");
});

test("pickForPage holds a corner box back while a modal shows (its timer must not run unseen)", () => {
  const list = [
    row("center", "2026-01-01T00:00:00Z", { show_bar: false }),
    row("corner", "2026-02-01T00:00:00Z", { show_bar: false, modal_display: "corner", modal_size: "small" }),
  ];
  assert.deepEqual(pickForPage(list, "saved", new Set(), 0).boxes, []);
  assert.deepEqual(pickForPage(list, "saved", new Set(["center:modal"]), 0).boxes.map((r) => r.id), ["corner"]);
});

test("announcementStatus: live, scheduled, ended, off (ended wins)", () => {
  const now = new Date("2026-11-02T00:00:00Z");
  const status = (is_on: boolean, starts_at: string | null, ends_at: string | null) =>
    announcementStatus({ is_on, starts_at, ends_at }, now);
  assert.equal(status(true, null, null), "live");
  assert.equal(status(true, "2026-11-03T00:00:00Z", null), "scheduled");
  assert.equal(status(true, null, "2026-11-01T23:00:00Z"), "ended");
  assert.equal(status(false, null, "2026-11-01T23:00:00Z"), "ended");
  assert.equal(status(false, null, null), "off");
  assert.equal(status(true, null, "2026-11-02T00:00:00Z"), "ended");
});

test("announcementSchema: a modal or corner box shows after 0–600 seconds, a top bar at once", () => {
  const box = { ...valid, modal_display: "corner", modal_size: "small" };
  for (const ok of [{ ...valid, modal_show_after: 600 }, { ...box, modal_show_after: 20 }, { ...valid, modal_show_after: 0 }]) {
    assert.equal(announcementSchema.safeParse(ok).success, true, JSON.stringify(ok.modal_show_after));
  }
  const message = (change: object) => announcementSchema.safeParse({ ...valid, ...change }).error?.issues[0].message;
  for (const bad of [-1, 601, 1.5]) assert.equal(message({ modal_show_after: bad }), "It shows after 0–600 seconds.");
  const bar = { show_modal: false, modal_text: "", show_bar: true, bar_html: "<p>Hi</p>" };
  assert.equal(message({ ...bar, modal_show_after: 10 }), "A top bar shows at once.");
});

test("a my_announcements row without modal_show_after (saved before it) shows at once", () => {
  const { modal_show_after, ...older } = row("a", "2026-01-01T00:00:00Z");
  void modal_show_after;
  assert.equal(myAnnouncementSchema.parse(older).modal_show_after, 0);
});

test("pickForPage holds a modal or corner box back until the tab's clock reaches its wait", () => {
  const modal = row("modal", "2026-01-01T00:00:00Z", { show_bar: false, modal_show_after: 20 });
  const box = row("box", "2026-02-01T00:00:00Z", { show_bar: false, modal_display: "corner", modal_size: "small", modal_show_after: 10 });
  assert.deepEqual(pickForPage([modal], "saved", new Set(), 19).modals, []);
  assert.deepEqual(pickForPage([modal], "saved", new Set(), 20).modals.map((r) => r.id), ["modal"]);
  // A modal still waiting doesn't hold the corner box back; once it shows, the box waits for it.
  assert.deepEqual(pickForPage([modal, box], "saved", new Set(), 9).boxes, []);
  assert.deepEqual(pickForPage([modal, box], "saved", new Set(), 10).boxes.map((r) => r.id), ["box"]);
  assert.deepEqual(pickForPage([modal, box], "saved", new Set(), 20).boxes, []);
});

test("isWaiting: true while an open modal or corner box hasn't reached its wait, on any page", () => {
  const modal = row("modal", "2026-01-01T00:00:00Z", { show_bar: false, pages: ["editor"], modal_show_after: 20 });
  assert.equal(isWaiting([modal], new Set(), 19), true);
  assert.equal(isWaiting([modal], new Set(), 20), false);
  assert.equal(isWaiting([modal], new Set(["modal:modal"]), 0), false);
  assert.equal(isWaiting([row("a", "2026-01-01T00:00:00Z")], new Set(), 0), false);
  assert.equal(isWaiting([{ ...modal, show_modal: false }], new Set(), 0), false);
});

test("announcementSchema takes 'every N minutes' with 1–1,440 whole minutes", () => {
  for (const minutes of [11, 1, 1440]) {
    assert.equal(announcementSchema.safeParse({ ...valid, repeat: "interval", repeat_minutes: minutes }).success, true, String(minutes));
  }
});

test("announcementSchema refuses bad minutes", () => {
  const message = (change: object) => announcementSchema.safeParse({ ...valid, ...change }).error?.issues[0].message;
  for (const bad of [0, 1441, 1.5]) assert.equal(message({ repeat: "interval", repeat_minutes: bad }), "Pick 1–1,440 minutes.");
  assert.equal(message({ repeat: "once", repeat_minutes: 15 }), "Minutes go only with 'Again every N minutes'.");
});

test("a my_announcements row without repeat_minutes is 0", () => {
  const { repeat_minutes, ...older } = row("a", "2026-01-01T00:00:00Z");
  void repeat_minutes;
  assert.equal(myAnnouncementSchema.parse(older).repeat_minutes, 0);
  assert.equal(myAnnouncementSchema.parse({ ...older, repeat: "interval", repeat_minutes: 11 }).repeat, "interval");
});

const T = Date.parse("2026-11-03T02:00:00Z");

test("reopenAt: closed time + N minutes, only for 'every N minutes'", () => {
  const every11 = row("a", "2026-01-01T00:00:00Z", { repeat: "interval", repeat_minutes: 11 });
  assert.equal(reopenAt([every11], "a:modal", { "a:modal": T }), T + 660_000);
  assert.equal(reopenAt([row("b", "2026-01-01T00:00:00Z")], "b:modal", { "b:modal": T }), null);
  assert.equal(reopenAt([every11], "a:modal", {}), null);
});

test("stillClosed: an 'every N minutes' part comes back once N minutes have passed, however long ago", () => {
  const list = [
    row("a", "2026-01-01T00:00:00Z", { repeat: "interval", repeat_minutes: 11 }),
    row("b", "2026-01-01T00:00:00Z", { repeat: "once" }),
  ];
  const closed = ["a:modal", "b:modal", "a:bar"];
  const closedAt = { "a:modal": T, "b:modal": T };
  assert.deepEqual([...stillClosed(list, closed, closedAt, T + 659_999)].sort(), ["a:bar", "a:modal", "b:modal"]);
  assert.deepEqual([...stillClosed(list, closed, closedAt, T + 660_000)].sort(), ["a:bar", "b:modal"]);
  // Hours later (a tab in the background): back at once, and a "once" one stays closed.
  assert.deepEqual([...stillClosed(list, closed, closedAt, T + 10 * 3_600_000)].sort(), ["a:bar", "b:modal"]);
});

test("cutVideoTitle cuts a long YouTube title by whole characters, so the card still saves", () => {
  const long = "a".repeat(199) + "😀😀";
  const cut = cutVideoTitle(long);
  assert.equal(cut, "a".repeat(199));
  assert.ok(cut.length <= 200);
  const card = { kind: "youtube", video_id: "dQw4w9WgXcQ", src: "https://images.quizmatter.com/uploads/a.jpg" };
  assert.ok(myAnnouncementSchema.shape.modal_attachment.parse({ ...card, title: cut }));
  // A family emoji (several characters joined) is kept whole or left out whole.
  const family = "👨‍👩‍👧";
  assert.equal(cutVideoTitle("b".repeat(195) + family), "b".repeat(195));
  assert.equal(cutVideoTitle("  Short title  "), "Short title");
  assert.equal(cutVideoTitle("x".repeat(200)), "x".repeat(200));
});
