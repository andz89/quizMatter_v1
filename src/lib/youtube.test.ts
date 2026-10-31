import { test } from "node:test";
import assert from "node:assert/strict";
import { findYouTubeVideoId, youTubeVideoId, youTubeWatchUrl } from "./youtube";

test("youTubeVideoId reads the id from each YouTube link style", () => {
  const id = "dQw4w9WgXcQ";
  for (const link of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&t=42s`,
    `https://m.youtube.com/watch?feature=share&v=${id}`,
    `http://www.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?si=abc123`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://music.youtube.com/watch?v=${id}`,
  ]) {
    assert.equal(youTubeVideoId(link), id, link);
  }
});

test("youTubeVideoId refuses other sites and bad ids", () => {
  for (const link of [
    "https://vimeo.com/123456789",
    "https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "https://evil.example/youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ<script>",
    "https://www.youtube.com/channel/UCabcdefghijk",
    "javascript:alert(1)",
    "not a link",
  ]) {
    assert.equal(youTubeVideoId(link), null, link);
  }
});

test("findYouTubeVideoId finds the first YouTube link in pasted text", () => {
  assert.equal(findYouTubeVideoId("Watch this: https://youtu.be/dQw4w9WgXcQ today!"), "dQw4w9WgXcQ");
  assert.equal(findYouTubeVideoId("See https://deped.gov.ph and https://youtu.be/dQw4w9WgXcQ."), "dQw4w9WgXcQ");
  assert.equal(findYouTubeVideoId("No video here, just https://deped.gov.ph"), null);
});

test("youTubeWatchUrl is the plain watch page", () => {
  assert.equal(youTubeWatchUrl("dQw4w9WgXcQ"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
});
