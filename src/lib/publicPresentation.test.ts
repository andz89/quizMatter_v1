import { test } from "node:test";
import assert from "node:assert/strict";
import { publicDescription, toPublicCard, toPublicLessons, toPublicPresentation, type PublicPresentation } from "./publicPresentation";

const row = {
  title: "Fractions",
  description: "Halves and quarters",
  subject: "Math",
  grades: ["4", "5"],
  from_admin: false,
  author_name: "Pp Teacher",
  slide_count: 2,
  first_slide: {
    id: "a2",
    type: "blank",
    question: "First shown",
    layout: "grid",
    options: ["a", "b", "c", "d"].map((id) => ({ id, text: "" })),
    correctOptionId: null,
    elements: [],
    questionHeight: 100,
  },
};

const sample: PublicPresentation = {
  id: "p1",
  title: "Fractions",
  description: "",
  subject: "Math",
  grades: [],
  fromAdmin: false,
  authorName: "Pp Teacher",
  slideCount: 3,
  firstSlide: null,
};

test("no row means not public", () => {
  assert.equal(toPublicPresentation("p1", null), null);
  assert.equal(toPublicPresentation("p1", undefined), null);
});

test("a row becomes the preview, with its first slide checked", () => {
  const preview = toPublicPresentation("p1", row);
  assert.ok(preview);
  assert.equal(preview.id, "p1");
  assert.equal(preview.title, "Fractions");
  assert.equal(preview.authorName, "Pp Teacher");
  assert.equal(preview.fromAdmin, false);
  assert.deepEqual(preview.grades, ["4", "5"]);
  assert.equal(preview.slideCount, 2);
  assert.equal(preview.firstSlide?.id, "a2");
});

test("a broken first slide shows as no slide, the rest still fills in", () => {
  const preview = toPublicPresentation("p1", { ...row, first_slide: { nonsense: 1 } });
  assert.ok(preview);
  assert.equal(preview.firstSlide, null);
  assert.equal(preview.title, "Fractions");
});

test("the description is the presentation's own, cut to 160 characters", () => {
  assert.equal(publicDescription({ ...sample, description: "Fractions for Grade 4" }), "Fractions for Grade 4");
  const long = publicDescription({ ...sample, description: "a".repeat(300) });
  assert.ok(long.length <= 160);
  assert.ok(long.endsWith("…"));
});

test("a long description is cut by whole characters, never in the middle of an emoji", () => {
  const cut = publicDescription({ ...sample, description: "a".repeat(158) + "😀".repeat(5) });
  assert.equal(cut, "a".repeat(158) + "😀…");
});

test("the card is the preview without the slide", () => {
  const card = toPublicCard("p1", { ...row, first_slide: undefined });
  assert.ok(card);
  assert.equal(card.title, "Fractions");
  assert.equal(card.slideCount, 2);
  assert.ok(!("firstSlide" in card));
  assert.equal(toPublicCard("p1", null), null);
});

test("with no description, it says what it is", () => {
  assert.equal(publicDescription(sample), "Fractions by Pp Teacher on QuizMatter: 3 slides.");
  assert.equal(publicDescription({ ...sample, slideCount: 1 }), "Fractions by Pp Teacher on QuizMatter: 1 slide.");
  assert.equal(publicDescription({ ...sample, authorName: "" }), "Fractions on QuizMatter: 3 slides.");
});

test("lesson rows become cards: camelCase, time in ms, a broken slide as no slide", () => {
  const lessons = toPublicLessons([
    { id: "l2", title: "Newer", subject: "Science", grades: [], updated_at: "2026-11-19T00:00:00Z", first_slide: row.first_slide },
    { id: "l1", title: "Older", subject: "Math", grades: ["Grade 1"], updated_at: "2026-11-18T00:00:00Z", first_slide: { nonsense: 1 } },
  ]);
  assert.equal(lessons.length, 2);
  assert.equal(lessons[0].id, "l2");
  assert.equal(lessons[0].updatedAt, Date.parse("2026-11-19T00:00:00Z"));
  assert.equal(lessons[0].firstSlide?.id, "a2");
  assert.deepEqual(lessons[1].grades, ["Grade 1"]);
  assert.equal(lessons[1].firstSlide, null);
});

test("no lesson rows means no cards", () => {
  assert.deepEqual(toPublicLessons(null), []);
  assert.deepEqual(toPublicLessons(undefined), []);
});
