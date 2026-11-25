import { test } from "node:test";
import assert from "node:assert/strict";
import { hexToHsv, hsvToHex, parseHex, readRecentColors, withRecent } from "./colors";

test("parseHex reads short and long hex, with or without #", () => {
  assert.equal(parseHex("#abc"), "#AABBCC");
  assert.equal(parseHex("abc"), "#AABBCC");
  assert.equal(parseHex("1e8e4f"), "#1E8E4F");
  assert.equal(parseHex("  #1E8E4F "), "#1E8E4F");
});

test("parseHex refuses anything else", () => {
  for (const text of ["#12", "zzz", "", "#12345", "#1234567", "rgb(1,2,3)", "#GGGGGG"]) assert.equal(parseHex(text), null, text);
});

test("hex → hsv → hex gives the same color", () => {
  for (const color of ["#6B3DF5", "#000000", "#FFFFFF", "#E03131", "#1E8E4F", "#808080"]) {
    assert.equal(hsvToHex(hexToHsv(color)), color);
  }
});

test("hsvToHex", () => {
  assert.equal(hsvToHex({ h: 0, s: 1, v: 1 }), "#FF0000");
  assert.equal(hsvToHex({ h: 120, s: 1, v: 1 }), "#00FF00");
  assert.equal(hsvToHex({ h: 240, s: 1, v: 0.5 }), "#000080");
  assert.equal(hsvToHex({ h: 360, s: 1, v: 1 }), "#FF0000");
  assert.equal(hsvToHex({ h: 200, s: 0, v: 1 }), "#FFFFFF");
});

test("withRecent puts the color first, once, and keeps at most max", () => {
  assert.deepEqual(withRecent(["#AAAAAA", "#BBBBBB"], "#BBBBBB"), ["#BBBBBB", "#AAAAAA"]);
  assert.deepEqual(withRecent(["#AAAAAA", "#BBBBBB"], "#CCCCCC", 2), ["#CCCCCC", "#AAAAAA"]);
});

test("readRecentColors keeps only real colors", () => {
  assert.deepEqual(readRecentColors(null), []);
  assert.deepEqual(readRecentColors("junk"), []);
  assert.deepEqual(readRecentColors('{"a":1}'), []);
  assert.deepEqual(readRecentColors('["#abc", 5, "nope", "#123456"]'), ["#AABBCC", "#123456"]);
});
