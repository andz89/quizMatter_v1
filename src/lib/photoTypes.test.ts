import { test } from "node:test";
import assert from "node:assert/strict";
import { readAnnouncementImageType, readPhotoType } from "./photoTypes";

const bytes = (text: string, extra: number[] = []) => new Uint8Array([...text].map((c) => c.charCodeAt(0)).concat(extra)).buffer;
const GIF = bytes("GIF89a", [1, 0, 1, 0]);
const OLD_GIF = bytes("GIF87a", [1, 0, 1, 0]);
const WEBP = bytes("RIFF\0\0\0\0WEBP");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer;

test("readAnnouncementImageType takes GIFs as well as WebP and JPEG", () => {
  assert.deepEqual(readAnnouncementImageType(GIF), { contentType: "image/gif", extension: "gif" });
  assert.deepEqual(readAnnouncementImageType(OLD_GIF), { contentType: "image/gif", extension: "gif" });
  assert.equal(readAnnouncementImageType(WEBP)?.extension, "webp");
  assert.equal(readAnnouncementImageType(JPEG)?.extension, "jpg");
  assert.equal(readAnnouncementImageType(bytes("GIF8")), null);
  assert.equal(readAnnouncementImageType(bytes("<svg onload=alert(1)>")), null);
});

test("readPhotoType (every other upload) still refuses GIFs", () => {
  assert.equal(readPhotoType(GIF), null);
  assert.equal(readPhotoType(WEBP)?.extension, "webp");
});
