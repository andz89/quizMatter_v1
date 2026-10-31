import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { REFUSALS, SaveRefusedError, refusalFromCode, saveErrorMessage } from "./presentations";

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
