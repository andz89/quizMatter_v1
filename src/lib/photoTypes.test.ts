import { test } from "node:test";
import assert from "node:assert/strict";
import { isOurPhotoFile, readAnnouncementImageType, readPhotoType, readUploadBody } from "./photoTypes";

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

const HASH = "a".repeat(64);

test("isOurPhotoFile takes our WebP, JPEG and GIF files (Photo cleanup deletes GIFs too)", () => {
  assert.equal(isOurPhotoFile(`https://images.quizmatter.com/uploads/${HASH}.webp`), true);
  assert.equal(isOurPhotoFile(`https://images.quizmatter.com/uploads/${HASH}.jpg`), true);
  assert.equal(isOurPhotoFile(`https://images.quizmatter.com/uploads/${HASH}.gif`), true);
});

test("isOurPhotoFile refuses anything else in the bucket or elsewhere", () => {
  assert.equal(isOurPhotoFile(`https://images.quizmatter.com/uploads/${HASH}.png`), false);
  assert.equal(isOurPhotoFile(`https://images.quizmatter.com/uploads/${HASH.slice(1)}.webp`), false);
  assert.equal(isOurPhotoFile(`https://images.quizmatter.com/other/${HASH}.webp`), false);
  assert.equal(isOurPhotoFile(`https://imagesXquizmatter.com/uploads/${HASH}.webp`), false);
  assert.equal(isOurPhotoFile(`https://images.quizmatter.com/uploads/${HASH}.webp/../x`), false);
});

// A body sent in pieces with no Content-Length, like a chunked upload. `pulled` counts the pieces read.
function chunkedRequest(pieces: number, pieceSize: number) {
  const counter = { pulled: 0 };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (counter.pulled === pieces) return controller.close();
      counter.pulled++;
      controller.enqueue(new Uint8Array(pieceSize).fill(counter.pulled));
    },
  });
  const request = new Request("http://localhost/api/upload-image", { method: "POST", body, duplex: "half" } as RequestInit);
  return { request, counter };
}

test("readUploadBody returns the whole body when it fits", async () => {
  const { request } = chunkedRequest(3, 100);
  const body = await readUploadBody(request, 300);
  assert.equal(body?.byteLength, 300);
  assert.deepEqual([...new Uint8Array(body!)].filter((_, i) => i % 100 === 0), [1, 2, 3]);
});

test("readUploadBody stops reading as soon as a body with no Content-Length is too big", async () => {
  const { request, counter } = chunkedRequest(1000, 100);
  assert.equal(await readUploadBody(request, 250), null);
  assert.ok(counter.pulled < 10, `read ${counter.pulled} pieces`);
});

test("readUploadBody refuses a too-big Content-Length before reading anything", async () => {
  const request = new Request("http://localhost/api/upload-image", {
    method: "POST",
    body: new Uint8Array(10),
    headers: { "content-length": "999" },
  });
  assert.equal(await readUploadBody(request, 500), null);
  assert.equal(request.bodyUsed, false);
});
