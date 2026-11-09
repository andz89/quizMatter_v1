import assert from "node:assert/strict";
import { test } from "node:test";
import { fitTableRows, tableStartSize } from "./importTable";

// One line per 100 px of width for every 10 characters, 20 px tall: easy numbers to check by hand.
const measure = (text: string, width: number) =>
  text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil((line.length * 10) / width)), 0) * 20;

const table = (rows: string[][], extra = {}) => ({ rows: rows.map((cells) => cells.map((html) => ({ html }))), fontSize: 20, ...extra });
const at = (width: number, height: number) => ({ x: 0, y: 0, width, height });

test("a new table is as tall as its text needs", () => {
  // 2 rows of 1 line: (20 + 8 padding) each, plus 3 lines of 2 px.
  assert.deepEqual(tableStartSize(table([["<p>a</p>", "<p>b</p>"], ["<p>c</p>", "<p>d</p>"]]), { width: 1000, height: 500 }, measure), { width: 600, height: 62 });
});

test("a table with many columns starts wider, but stays inside its box", () => {
  const wide = table([Array.from({ length: 8 }, () => "<p>a</p>")]);
  assert.equal(tableStartSize(wide, { width: 1000, height: 500 }, measure).width, 800);
  assert.equal(tableStartSize(wide, { width: 700, height: 500 }, measure).width, 700);
});

test("a new table is never taller than its box", () => {
  const tall = table(Array.from({ length: 10 }, () => ["<p>a</p>"]));
  assert.equal(tableStartSize(tall, { width: 1000, height: 100 }, measure).height, 100);
});

test("a row with more lines gets more of the table", () => {
  const long = "<p>" + "x".repeat(100) + "</p>";
  const fitted = fitTableRows({ ...at(204, 200), table: table([["<p>a</p>"], [long]]) }, measure);
  assert.deepEqual(fitted.table.rowSizes, [28, 128]);
  assert.deepEqual(fitted.cutOff, []);
});

test("rows that need the same room keep no saved sizes", () => {
  const fitted = fitTableRows({ ...at(200, 200), table: table([["<p>a</p>"], ["<p>b</p>"]]) }, measure);
  assert.equal(fitted.table.rowSizes, undefined);
});

test("the row sizes Claude chose are kept", () => {
  const fitted = fitTableRows({ ...at(200, 200), table: table([["<p>a</p>"], ["<p>b</p>"]], { rowSizes: [1, 3] }) }, measure);
  assert.deepEqual(fitted.table.rowSizes, [1, 3]);
});

test("rows too short for their text are named", () => {
  const long = "<p>" + "x".repeat(100) + "</p>";
  // Rows share the room by what they need, so in a table far too short every row is cut off.
  assert.deepEqual(fitTableRows({ ...at(204, 60), table: table([["<p>a</p>"], [long]]) }, measure).cutOff, [0, 1]);
  // 2 rows of 1 line fit in 100 px, but the size Claude chose leaves the second one only a sliver.
  assert.deepEqual(fitTableRows({ ...at(204, 100), table: table([["<p>a</p>"], ["<p>b</p>"]], { rowSizes: [20, 1] }) }, measure).cutOff, [1]);
});

test("paragraphs count as lines, and an escaped letter as one letter", () => {
  const twoLines = table([["<p>a</p><p>b</p>"]]);
  // 2 lines of 20 + 8 padding + 2 lines of 2 px.
  assert.equal(tableStartSize(twoLines, { width: 1000, height: 500 }, measure).height, 52);
  const seen: string[] = [];
  tableStartSize(table([['<p style="text-align: center"><strong>a &amp; b</strong></p>']]), { width: 1000, height: 500 }, (text) => {
    seen.push(text);
    return 20;
  });
  assert.deepEqual(seen, ["a x b"]);
});
