import { test } from "node:test";
import assert from "node:assert/strict";
import { facebookEmbedUrl, facebookLink, findFacebookLink } from "./facebook";

test("facebookLink reads posts and videos from each Facebook link style", () => {
  const cases: [string, boolean][] = [
    ["https://www.facebook.com/DepEdPhilippines/posts/pfbid0abc123", false],
    ["https://facebook.com/DepEdPhilippines/posts/1234567890", false],
    ["https://m.facebook.com/story.php?story_fbid=123&id=456", false],
    ["https://web.facebook.com/permalink.php?story_fbid=123&id=456", false],
    ["https://www.facebook.com/share/p/1AbCdEfGh/", false],
    ["https://www.facebook.com/photo/?fbid=123456", false],
    ["https://www.facebook.com/DepEdPhilippines/videos/1234567890/", true],
    ["https://www.facebook.com/watch/?v=1234567890", true],
    ["https://www.facebook.com/reel/1234567890", true],
    ["https://www.facebook.com/share/v/1AbCdEfGh/", true],
    ["https://fb.watch/abcDEF123/", true],
  ];
  for (const [link, video] of cases) {
    const found = facebookLink(link);
    assert.ok(found, link);
    assert.equal(found.video, video, link);
    assert.ok(found.href.startsWith("https://"), link);
  }
});

test("facebookLink keeps the link but always as https", () => {
  assert.deepEqual(facebookLink("http://www.facebook.com/watch/?v=123"), {
    href: "https://www.facebook.com/watch/?v=123",
    video: true,
  });
});

test("facebookLink refuses other sites, bare pages and unsafe links", () => {
  for (const link of [
    "https://www.facebook.com.evil.example/posts/1",
    "https://evil.example/facebook.com/posts/1",
    "https://www.facebook.com/",
    "https://www.facebook.com/DepEdPhilippines",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    `https://www.facebook.com/posts/${"x".repeat(500)}`,
    "https://www.facebook.com/posts/1\"onload=\"alert(1)",
  ]) {
    assert.equal(facebookLink(link), null, link);
  }
});

test("findFacebookLink finds the first Facebook post or video in pasted text", () => {
  assert.deepEqual(findFacebookLink("Look: https://fb.watch/abcDEF123/ !"), {
    href: "https://fb.watch/abcDEF123/",
    video: true,
  });
  assert.equal(findFacebookLink("Only https://deped.gov.ph here"), null);
});

test("facebookEmbedUrl is Facebook's own player or post box for the link", () => {
  const href = "https://www.facebook.com/watch/?v=123";
  assert.equal(
    facebookEmbedUrl({ href, video: true }, 500),
    `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(href)}&show_text=false&width=500`,
  );
  const post = "https://www.facebook.com/DepEdPhilippines/posts/1";
  assert.equal(
    facebookEmbedUrl({ href: post, video: false }, 672),
    `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(post)}&show_text=true&width=500`,
  );
});
