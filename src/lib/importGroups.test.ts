import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByName } from "./importGroups";

type El = { id: string; containerId: string | null; groupId?: string };

// Ids in a known order, so the tests can say which group id each name gets.
function counter() {
  let n = 0;
  return () => `g${++n}`;
}

test("items with the same group name share one new group id", () => {
  const elements: El[] = [
    { id: "ribbon", containerId: null },
    { id: "words", containerId: null },
    { id: "kid", containerId: null },
  ];
  const names = new Map([
    ["ribbon", "banner"],
    ["words", "banner"],
  ]);
  const result = groupByName(elements, names, counter());
  assert.deepEqual(result.elements, [
    { id: "ribbon", containerId: null, groupId: "g1" },
    { id: "words", containerId: null, groupId: "g1" },
    { id: "kid", containerId: null },
  ]);
  assert.deepEqual(result.lonely, []);
  assert.deepEqual(result.mixed, []);
});

test("each name gets its own group id", () => {
  const elements: El[] = [
    { id: "a1", containerId: null },
    { id: "b1", containerId: null },
    { id: "a2", containerId: null },
    { id: "b2", containerId: null },
  ];
  const names = new Map([
    ["a1", "a"],
    ["b1", "b"],
    ["a2", "a"],
    ["b2", "b"],
  ]);
  const ids = groupByName(elements, names, counter()).elements.map((el) => el.groupId);
  assert.deepEqual(ids, ["g1", "g2", "g1", "g2"]);
});

test("a name used only once makes no group and is reported", () => {
  const elements: El[] = [{ id: "seal", containerId: null }];
  const result = groupByName(elements, new Map([["seal", "badge"]]), counter());
  assert.deepEqual(result.elements, [{ id: "seal", containerId: null }]);
  assert.deepEqual(result.lonely, ["badge"]);
});

test("a group whose items sit in different boxes is reported and not made", () => {
  const elements: El[] = [
    { id: "apple", containerId: "A" },
    { id: "pear", containerId: "side" },
  ];
  const names = new Map([
    ["apple", "fruit"],
    ["pear", "fruit"],
  ]);
  const result = groupByName(elements, names, counter());
  assert.deepEqual(result.elements, elements);
  assert.deepEqual(result.mixed, ["fruit"]);
});

test("elements with no name are left as they are", () => {
  const elements: El[] = [{ id: "x", containerId: null }];
  const result = groupByName(elements, new Map(), counter());
  assert.equal(result.elements[0], elements[0]);
});
