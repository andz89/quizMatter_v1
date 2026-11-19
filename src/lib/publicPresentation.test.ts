import { test } from "node:test";
import assert from "node:assert/strict";
import { publicDescription, toPublicPresentation, type PublicPresentation } from "./publicPresentation";

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

test("with no description, it says what it is", () => {
  assert.equal(publicDescription(sample), "Fractions by Pp Teacher on QuizMatter: 3 slides.");
  assert.equal(publicDescription({ ...sample, slideCount: 1 }), "Fractions by Pp Teacher on QuizMatter: 1 slide.");
  assert.equal(publicDescription({ ...sample, authorName: "" }), "Fractions on QuizMatter: 3 slides.");
});
