// Photo cleanup's Delete (/api/delete-photo): a file under 7 days old is never deleted (a teacher may have it on a
// slide they haven't saved yet), a GIF from an announcement is one of our files too, and the page shows no Delete
// button for a file that new.
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, check, deleteTeacher, finish, loggedIn, makeTeacher, psql } from "./lib.mjs";

const admin = await makeTeacher({ first: "Cleanup", superAdmin: true });
const browser = await chromium.launch();
try {
  const context = await loggedIn(browser, admin, { width: 1600, height: 1000 });
  const request = context.request;
  // Only the first bytes say what a file is, so random bytes after them make a new file each run.
  const fileOf = (header) => Buffer.concat([header, randomBytes(64)]);

  // A WebP photo uploaded to My photos, then taken off the list: unused, but uploaded just now.
  const webp = fileOf(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]));
  const uploaded = await request.post(`${APP}/api/upload-image?width=10&height=10`, {
    data: webp,
    headers: { "Content-Type": "image/webp" },
  });
  const { src: webpSrc } = await uploaded.json();
  check("the WebP photo uploads", uploaded.ok() && typeof webpSrc === "string", `${uploaded.status()}`);
  psql(`delete from public.photos where src = '${webpSrc}'`);

  const deleteWebp = await request.post(`${APP}/api/delete-photo`, { data: { src: webpSrc } });
  const webpAnswer = await deleteWebp.json();
  check("a new unused WebP isn't deleted (409)", deleteWebp.status() === 409, `${deleteWebp.status()} ${JSON.stringify(webpAnswer)}`);
  check("the answer says why (7 days)", /7 days/.test(webpAnswer.error ?? ""), webpAnswer.error);

  // A GIF uploaded for an announcement, then taken off the announcement photos list.
  const gif = fileOf(Buffer.from("GIF89a"));
  const gifUpload = await request.post(`${APP}/api/announcement-image?width=10&height=10`, {
    data: gif,
    headers: { "Content-Type": "image/gif" },
  });
  const { src: gifSrc } = await gifUpload.json();
  check("the GIF uploads", gifUpload.ok() && typeof gifSrc === "string", `${gifUpload.status()}`);
  psql(`delete from public.announcement_photos where src = '${gifSrc}'`);

  const deleteGif = await request.post(`${APP}/api/delete-photo`, { data: { src: gifSrc } });
  const gifAnswer = await deleteGif.json();
  check(
    "a GIF counts as one of our files (refused only for being new, not 'isn't one of our photos')",
    deleteGif.status() === 409 && /7 days/.test(gifAnswer.error ?? ""),
    `${deleteGif.status()} ${JSON.stringify(gifAnswer)}`,
  );

  // The page: the new file is listed under "deleted later", with Keep but no Delete.
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  await page.goto(`${APP}/admin/cleanup`);
  await page.getByRole("button", { name: "Find unused photos" }).click();
  const later = page.locator("section", { has: page.getByRole("heading", { name: /Unused, deleted later/ }) });
  await later.waitFor();
  const hash = webpSrc.split("/").pop().split(".")[0];
  const listed = await later.locator(`img[src*="${hash}"]`).count();
  check("the new file is listed under 'deleted later'", listed > 0, `${listed}`);
  const deleteButtons = await later.getByRole("button", { name: "Delete" }).count();
  check("no Delete button on files that new", deleteButtons === 0, `${deleteButtons} Delete buttons`);
  await page.screenshot({ path: `${SHOTS}photo-delete.png`, fullPage: true });
} finally {
  await browser.close();
  await deleteTeacher(admin);
}
finish();
