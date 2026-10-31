import { test } from "node:test";
import assert from "node:assert/strict";
import { readEmbedLink, type EmbedKind } from "./embed";

const srcOf = (kind: EmbedKind, pasted: string) => {
  const result = readEmbedLink(kind, pasted);
  return "error" in result ? null : result.src;
};

test("every kind of YouTube link becomes the same player address", () => {
  const player = "https://www.youtube.com/embed/dQw4w9WgXcQ";
  for (const link of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s",
    "youtube.com/watch?v=dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
    '<iframe width="560" src="https://www.youtube.com/embed/dQw4w9WgXcQ" frameborder="0"></iframe>',
  ]) {
    assert.equal(srcOf("video", link), player, link);
  }
});

test("a video link from another site, or a wrong YouTube id, is refused", () => {
  for (const link of [
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.example.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ%22onload",
    "not a link",
  ]) {
    assert.equal(srcOf("video", link), null, link);
  }
});

test("Vimeo links keep the private hash", () => {
  assert.equal(srcOf("video", "https://vimeo.com/76979871"), "https://player.vimeo.com/video/76979871");
  assert.equal(srcOf("video", "https://vimeo.com/76979871/abc123"), "https://player.vimeo.com/video/76979871?h=abc123");
  assert.equal(srcOf("video", "https://player.vimeo.com/video/76979871?h=abc123"), "https://player.vimeo.com/video/76979871?h=abc123");
});

test("Canva share links work; edit and short links say what to do instead", () => {
  assert.equal(srcOf("embed-slides", "https://www.canva.com/design/DAF1abc/xyz789/view"), "https://www.canva.com/design/DAF1abc/xyz789/view?embed");
  assert.match((readEmbedLink("embed-slides", "https://www.canva.com/design/DAF1abc/edit") as { error: string }).error, /edit link/);
  assert.match((readEmbedLink("video", "https://canva.link/abc") as { error: string }).error, /canva\.link/);
});

test("Google Slides links, with or without a signed-in account part, and published ones", () => {
  const embed = "https://docs.google.com/presentation/d/1AbC-dEf_9/embed?start=false&loop=false";
  assert.equal(srcOf("embed-slides", "https://docs.google.com/presentation/d/1AbC-dEf_9/edit#slide=id.p"), embed);
  assert.equal(srcOf("embed-slides", "https://docs.google.com/presentation/u/1/d/1AbC-dEf_9/edit"), embed);
  assert.equal(
    srcOf("embed-slides", "https://docs.google.com/presentation/d/e/2PACX-1vR/pub?start=false"),
    "https://docs.google.com/presentation/d/e/2PACX-1vR/embed?start=false&loop=false",
  );
  assert.equal(srcOf("embed-slides", "https://docs.google.com/document/d/1AbC/edit"), null);
  assert.equal(srcOf("embed-slides", "https://example.com/presentation/d/1AbC/edit"), null);
});

test("pictures: only https links, and Drive share links become Drive's picture address", () => {
  assert.equal(srcOf("image", "https://example.com/cat.png"), "https://example.com/cat.png");
  assert.equal(srcOf("image", "http://example.com/cat.png"), null);
  assert.equal(srcOf("image", "javascript:alert(1)"), null);
  assert.equal(srcOf("image", "data:image/png;base64,AAAA"), null);
  assert.equal(srcOf("image", "https://drive.google.com/file/d/1AbC_d-9/view?usp=sharing"), "https://drive.google.com/thumbnail?id=1AbC_d-9&sz=w2000");
  assert.equal(srcOf("image", "https://drive.google.com/open?id=bad%22id"), null);
});

test("a saved address passes the same check again, unchanged", () => {
  for (const [kind, link] of [
    ["video", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["video", "https://vimeo.com/76979871/abc123"],
    ["embed-slides", "https://www.canva.com/design/DAF1abc/xyz789/view"],
    ["embed-slides", "https://docs.google.com/presentation/d/1AbC-dEf_9/edit"],
    ["image", "https://drive.google.com/file/d/1AbC_d-9/view"],
  ] as const) {
    const src = srcOf(kind, link)!;
    assert.equal(srcOf(kind, src), src, link);
  }
});
