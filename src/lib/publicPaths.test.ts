import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicPreviewPath } from "./publicPaths";

const ID = "0b7c2f4e-1d3a-4c5b-9e8f-123456789abc";

test("a presentation's page and its picture are open to logged-out visitors", () => {
  assert.equal(isPublicPreviewPath(`/presentation/${ID}`), true);
  assert.equal(isPublicPreviewPath(`/presentation/${ID.toUpperCase()}`), true);
  assert.equal(isPublicPreviewPath(`/presentation/${ID}/opengraph-image`), true);
  assert.equal(isPublicPreviewPath(`/presentation/${ID}/opengraph-image-1a2b3c`), true);
});

test("the site picture and robots.txt are open", () => {
  assert.equal(isPublicPreviewPath("/opengraph-image"), true);
  assert.equal(isPublicPreviewPath("/opengraph-image-1a2b3c"), true);
  assert.equal(isPublicPreviewPath("/robots.txt"), true);
});

test("everything else still needs a login", () => {
  for (const path of [
    `/presentation/${ID}/edit`,
    "/presentation/new",
    "/presentation/abc",
    `/presentation/${ID}/`,
    `/presentation/${ID}/opengraph-image/x`,
    `/presentation/${ID}x`,
    "/",
    "/admin",
    "/robots.txt/x",
  ]) {
    assert.equal(isPublicPreviewPath(path), false, path);
  }
});
