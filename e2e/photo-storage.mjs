// Photo storage (50 MB per teacher, 500 MB per editor; supabase/migrations/20261231002600_photo_storage.sql): the Photos panel's bar,
// the warning before removing a photo that's still on a slide, an upload's answer carrying the new total, and a
// full account refused (413, QMSTO) with the full message and Upload greyed out.
import { randomBytes, randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher, psql } from "./lib.mjs";

const editor = await makeTeacher({ first: "Storage", last: "Editor" });
psql(`insert into public.editors (user_id) values ('${editor.id}')`);
const photoA = `https://images.quizmatter.com/uploads/${"a".repeat(64)}.webp`;
// Only the first bytes say what a file is, so random bytes after them make a new file each run.
const webp = () => Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), randomBytes(64)]);
const uploadUrl = `${APP}/api/upload-image?width=10&height=10`;

// A presentation whose slide 1 has photo a; a in "My photos", uploaded (1.8 MB) an hour ago.
const presentationId = randomUUID();
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: presentationId, owner_id: editor.id, title: "Weather Quiz", data_version: 1 }),
});
await api("/rest/v1/slides", {
  method: "POST",
  body: JSON.stringify({
    presentation_id: presentationId,
    id: "s1",
    position: 0,
    data: {
      id: "s1",
      type: "choice",
      question: "Which is it?",
      questionHtml: "<p>Which is it?</p>",
      layout: "grid",
      options: ["a", "b", "c", "d"].map((x) => ({ id: `s1-${x}`, text: x })),
      correctOptionId: null,
      questionHeight: 150,
      elements: [{ id: "p1", assetId: "photo", x: 100, y: 100, width: 200, height: 200, containerId: null, color: "#3B82F6", src: photoA }],
    },
  }),
});
psql(`insert into public.photos (user_id, src, width, height) values ('${editor.id}', '${photoA}', 10, 10);
      insert into public.photo_uploads (user_id, src, bytes, created_at)
      values ('${editor.id}', '${photoA}', 1887437, now() - interval '1 hour');`);
const used = () => psql(`select public.photo_storage_used('${editor.id}')`);

const browser = await chromium.launch();
const context = await loggedIn(browser, editor, { width: 1600, height: 1000 });
const page = await context.newPage();
page.setDefaultTimeout(60_000);

const openMyPhotos = async () => {
  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  await page.locator('[data-slide-id="s1"]').waitFor().catch(async (e) => {
    await page.screenshot({ path: `${SHOTS}photo-storage-debug.png` });
    throw e;
  });
  await page.getByRole("button", { name: "Photos", exact: true }).click();
  await page.getByRole("tab", { name: "My Photos" }).click();
  await page.getByTestId("photo-storage").waitFor();
};

try {
  await openMyPhotos();
  const barText = await page.getByTestId("photo-storage").innerText();
  check("the bar shows what's used of the editor's 500 MB", barText.includes("1.8 MB of 500 MB"), barText);
  await page.screenshot({ path: `${SHOTS}photo-storage-bar.png` });

  // Removing a photo that's on slide 1 asks first, names the presentation, and says it still counts.
  const tile = page.locator(`img[src*="${"a".repeat(64)}"]`).locator("xpath=ancestor::div[contains(@class,'group')][1]");
  await tile.hover();
  await tile.getByTitle("Remove from my photos").click();
  const box = page.getByRole("dialog");
  await box.waitFor();
  const boxText = await box.innerText();
  check(
    "the warning names the presentation and slide",
    boxText.includes("This photo is still on your slides") && boxText.includes("Weather Quiz (slide 1)"),
    boxText
  );
  check("the warning says it still counts", boxText.includes("It still counts (1.8 MB) until it's gone"), boxText);
  await page.screenshot({ path: `${SHOTS}photo-storage-warning.png` });
  await box.getByRole("button", { name: "Remove from My photos" }).click();
  await page.getByText("Removed from My photos. It still counts").waitFor();
  check("it's out of My photos", psql(`select count(*) from public.photos where user_id = '${editor.id}'`) === "0");
  check("it still counts (on the slide)", used() === "1887437", used());

  // An upload's answer carries the new total.
  const uploaded = await context.request.post(uploadUrl, { data: webp(), headers: { "Content-Type": "image/webp" } });
  const answer = await uploaded.json();
  check(
    "an upload answers with the new total",
    uploaded.ok() && answer.storage?.limit === 524288000 && answer.storage.used > 1887437,
    `${uploaded.status()} ${JSON.stringify(answer)}`
  );

  // Full: 250 uploads of 2 MB in progress (held). The upload is refused, the panel says so, Upload is greyed out.
  psql(`insert into public.photo_uploads (user_id, src, bytes)
        select '${editor.id}', 'https://images.quizmatter.com/uploads/' || md5('${editor.id}' || i) || md5(i::text) || '.webp', 2097152
        from generate_series(1, 250) i;`);
  const refused = await context.request.post(uploadUrl, { data: webp(), headers: { "Content-Type": "image/webp" } });
  const refusedAnswer = await refused.json();
  check(
    "a full account's upload is refused (413, QMSTO)",
    refused.status() === 413 && refusedAnswer.code === "QMSTO" && refusedAnswer.error.includes("(500 MB)"),
    `${refused.status()} ${JSON.stringify(refusedAnswer)}`
  );
  await openMyPhotos();
  check("the full message shows", await page.getByText("Your photo storage is full (500 MB).").isVisible());
  check("Upload is greyed out", await page.getByRole("button", { name: "Upload photo" }).isDisabled());
  await page.screenshot({ path: `${SHOTS}photo-storage-full.png` });
} finally {
  await browser.close();
  await deleteTeacher(editor);
}
finish();
