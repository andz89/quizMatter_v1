import { test } from "node:test";
import assert from "node:assert/strict";
import { isOneWord, titleFilter, titleSearchMatches, titleTerms } from "./search";

// A short copy of GRADES (schema.ts can't be loaded here).
const GRADES = ["Kindergarten", "Grade 1", "Grade 4", "Grade 5", "Grade 10"];
const item = (title: string, grades: string[] = []) => ({ title, grades });
const matches = (title: string, search: string, grades: string[] = []) => titleSearchMatches(item(title, grades), search, GRADES);

test("a title with any one of the words matches, in any case, at the start of a word", () => {
  assert.equal(matches("Science exam", "Grade 4 exam"), true);
  assert.equal(matches("EXAMINATION day", "math exam"), true);
  assert.equal(matches("Science Exams", "math exam"), true);
  assert.equal(matches("Pre-exam review", "math exam"), true);
  assert.equal(matches("Fractions", "Grade 4 exam"), false);
  assert.equal(matches("Reexamine", "math exam"), false);
});

test("a term ending in a number must end there: grade 1 is not Grade 10", () => {
  assert.equal(matches("Grade 1 Math", "grade 1"), true);
  assert.equal(matches("Grade 1: Math", "grade 1"), true);
  assert.equal(matches("Grade 10 Math", "grade 1"), false);
  assert.equal(matches("Grade 12 Physics", "grade 1"), false);
  assert.equal(matches("Quiz Q1", "Quiz Q1"), true);
  assert.equal(matches("Quiz Q10", "Quiz Q1"), false);
});

test("a grade's name also finds presentations with that grade, whatever their title", () => {
  assert.equal(matches("Fractions", "grade 4", ["Grade 4"]), true);
  assert.equal(matches("Fractions", "grade 4", ["Grade 5"]), false);
  assert.equal(matches("Grade 4 review", "grade 4", ["Grade 5"]), true);
  assert.equal(matches("Fractions", "grade 1", ["Grade 10"]), false);
  assert.equal(titleFilter("grade 4", GRADES), 'title.imatch.\\ygrade 4\\y,grades.cs.{"Grade 4"}');
});

test("a 1- or 2-letter word is searched as a two-word phrase with its neighbor", () => {
  assert.deepEqual(titleTerms("Grade 4 exam"), ["Grade 4", "exam"]);
  assert.deepEqual(titleTerms("4 exam"), ["4 exam"]);
  assert.deepEqual(titleTerms("Quiz Q1"), ["Quiz Q1"]);
  assert.deepEqual(titleTerms("Grade 4 A"), ["Grade 4", "4 A"]);
  assert.deepEqual(titleTerms("a b"), ["a b"]);
  assert.equal(matches("Grade 4 Math", "Grade 4 exam"), true);
  assert.equal(matches("Grade 5 Math", "Grade 4 exam"), false);
  assert.equal(matches("Math 4", "Grade 4 exam"), false);
});

test("one word alone is not accepted, short or long", () => {
  assert.equal(isOneWord("4"), true);
  assert.equal(isOneWord(" Q1 "), true);
  assert.equal(isOneWord("exam"), true);
  assert.equal(isOneWord("Grade 4"), false);
  assert.equal(isOneWord(""), false);
  assert.deepEqual(titleTerms("exam"), []);
  assert.equal(titleFilter("exam", GRADES), null);
});

test("nothing typed matches everything", () => {
  assert.equal(matches("Fractions", ""), true);
  assert.equal(matches("Fractions", "   "), true);
  assert.equal(titleFilter("  ", GRADES), null);
});

test("the database filter has one imatch per term, joined as an or() list", () => {
  assert.equal(titleFilter("Grade  4 exam", GRADES), 'title.imatch.\\yGrade 4\\y,title.imatch.\\yexam,grades.cs.{"Grade 4"}');
  assert.equal(titleFilter("fractions exam", GRADES), "title.imatch.\\yfractions,title.imatch.\\yexam");
});

test("characters that mean something in an or() list or a regex can't break the filter", () => {
  assert.equal(
    titleFilter('math,science (test) "quiz" a\\b c.*d', GRADES),
    "title.imatch.\\ymath.science,title.imatch.\\ytest,title.imatch.\\yquiz,title.imatch.\\ya.b,title.imatch.\\yc..d",
  );
  assert.equal(matches("Math,science review", "math,science quiz"), true);
  assert.equal(matches("Test (math) review", "(test) review"), true);
});

test("punctuation at a word's start or end doesn't count as a word", () => {
  assert.equal(isOneWord("exam ,"), true);
  assert.equal(isOneWord("(( ))"), false);
  assert.deepEqual(titleTerms("(( ))"), []);
  assert.deepEqual(titleTerms("Grade 4, exam."), ["Grade 4", "exam"]);
});
