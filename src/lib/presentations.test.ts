import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { createBlankPresentation, createBlankSlide } from "./factories";
import { REFUSALS, SaveRefusedError, refusalFromCode, saveErrorMessage, saveRefusal, savePresentationToDb } from "./presentations";
import { TOO_MANY_SLIDES_MESSAGE } from "./schema";

test("every refusal code the app knows becomes its message", () => {
  for (const [code, message] of Object.entries(REFUSALS)) {
    const refusal = refusalFromCode(code);
    assert.ok(refusal instanceof SaveRefusedError, code);
    assert.equal(refusal.message, message);
  }
});

test("only QM409 is a conflict and only QMOLD asks for a reload of newer app code", () => {
  for (const code of Object.keys(REFUSALS)) {
    assert.equal(refusalFromCode(code)!.isConflict, code === "QM409", code);
    assert.equal(refusalFromCode(code)!.isOutdated, code === "QMOLD", code);
  }
});

test("an unknown code is not a refusal", () => {
  assert.equal(refusalFromCode("42501"), null);
  assert.equal(refusalFromCode(""), null);
  // A click limit pause is its own thing (saveErrorMessage), not one of REFUSALS.
  assert.equal(refusalFromCode("QMBLK"), null);
});

test("saveErrorMessage says why a save failed", () => {
  assert.equal(saveErrorMessage(refusalFromCode("QMMAX"), "make a copy"), REFUSALS.QMMAX);
  const zodError = z.string().max(3, "Too long.").safeParse("abcd").error;
  assert.equal(saveErrorMessage(zodError, "save"), "Couldn't save: Too long.");
  assert.match(saveErrorMessage({ code: "QMBLK", details: String(Date.now() + 60_000) }, "save"), /paused/);
  assert.equal(saveErrorMessage(new TypeError("Failed to fetch"), "save"), "Couldn't save. Please check your internet and try again.");
});

test("saveRefusal turns the database's limits into messages, and leaves other errors alone", () => {
  assert.equal(saveRefusal({ code: "QMMAX", message: "" })?.message, REFUSALS.QMMAX);
  assert.equal(saveRefusal({ code: "22023", message: "A presentation needs 1 to 100 slides." })?.message, TOO_MANY_SLIDES_MESSAGE);
  // A slide over the database's 2 MB (zod has no limit for a whole slide).
  const tooBig = saveRefusal({
    code: "23514",
    message: 'new row for relation "slides" violates check constraint "slides_data_is_small_object"',
  });
  assert.ok(tooBig instanceof SaveRefusedError);
  assert.match(tooBig.message, /too big/);
  // Only bugs: the raw error is kept.
  assert.equal(saveRefusal({ code: "22023", message: "A slide id is used twice." }), null);
  assert.equal(saveRefusal({ code: "23514", message: 'violates check constraint "presentations_details_size"' }), null);
});

// A presentation of three valid slides (two questions, then a blank one).
function threeSlides() {
  const presentation = createBlankPresentation({ title: "Saved" });
  presentation.slides = [createBlankSlide("choice"), createBlankSlide("choice"), createBlankSlide("blank")];
  return presentation;
}

test("a slide with too much text is refused before sending, naming its place in the list and the box", async () => {
  const presentation = threeSlides();
  const savedSlides = [...presentation.slides];
  // The 3rd slide changed (it's the 2nd one sent): its question is longer than the schema takes.
  presentation.slides = [savedSlides[0], { ...savedSlides[1], name: "x" }, { ...savedSlides[2], question: "x".repeat(5_001) }];

  await assert.rejects(savePresentationToDb(presentation, { baseUpdatedAt: 1, savedSlides }), (error) => {
    assert.ok(error instanceof SaveRefusedError);
    assert.equal(error.message, "The 3rd slide has too much text in its question. Shorten it, then click Save.");
    return true;
  });
});

test("too much text in a text box names the text box", async () => {
  const presentation = threeSlides();
  const [first] = presentation.slides;
  const [box] = createBlankSlide("title").elements;
  presentation.slides[0] = { ...first, elements: [{ ...box, text: { html: "x".repeat(50_001) } }] };

  await assert.rejects(savePresentationToDb(presentation), {
    message: "The 1st slide has too much text in a text box or table. Shorten it, then click Save.",
  });
});
