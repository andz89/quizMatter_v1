// The Download box, only in the editor: Word (.docx) of all slides has the question, unmarked options, the real
// photo (read in the browser straight from R2, which needs the bucket's CORS rule for localhost:3100) and the Answer
// key at the end; a cropped, flipped copy of the photo is its own picture, half as wide; a wrong Custom number is
// refused with words; Custom "2" has only that slide (no key); Text (.txt) has the Markdown. The editor shows the
// photo first, so the Word download also covers a photo the browser already saved. The presentation page has no
// Download button.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { unzipSync, strFromU8 } from "fflate";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

// One of our real photos (a WebP in R2).
const PHOTO = "https://images.quizmatter.com/uploads/3d0f1ff1e184bdb50a3704220304e27bc38cd1c4480131fee7c981d98df2dcc3.webp";

const teacher = await makeTeacher({ first: "Download" });
const presentationId = randomUUID();
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "Download e2e: planets", data_version: 6 }),
});
const base = (id, type) => ({
  id,
  type,
  question: "",
  layout: "grid",
  options: ["a", "b", "c", "d"].map((o) => ({ id: `${id}-${o}`, text: "" })),
  correctOptionId: null,
  correctAnswer: "",
  elements: [],
  questionHeight: 200,
});
const choice = { ...base("s1", "choice"), question: "Which planet is the largest?" };
choice.options = [
  { id: "s1-a", text: "Jupiter" },
  { id: "s1-b", text: "Mars" },
  { id: "s1-c", text: "" },
  { id: "s1-d", text: "" },
];
choice.correctOptionId = "s1-a";
const photoSlide = {
  ...base("s2", "blank"),
  elements: [
    { id: "p1", assetId: "photo", x: 320, y: 120, width: 640, height: 480, color: "#000000", containerId: null, image: { src: PHOTO, width: 800, height: 600 } },
    // The left half, mirrored: the file gets its own picture for it.
    {
      id: "p2", assetId: "photo", x: 320, y: 400, width: 320, height: 480, color: "#000000", containerId: null,
      image: { src: PHOTO, width: 800, height: 600 }, crop: { x: 0, y: 0, width: 0.5, height: 1 }, flipX: true,
    },
  ],
};
await api("/rest/v1/slides", {
  method: "POST",
  body: JSON.stringify([choice, photoSlide].map((data, position) => ({ presentation_id: presentationId, id: data.id, position, data }))),
});

const browser = await chromium.launch();
const context = await loggedIn(browser, teacher, { width: 1400, height: 900 }, { acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(60_000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const box = page.getByRole("dialog", { name: "Download", exact: true });

/** Opens the Download box, picks the format and slides (`custom` = the typed numbers) and returns the file. */
async function download(format, custom) {
  await page.locator('button[title="Download"]').click();
  await box.getByLabel(format).check();
  if (custom) {
    await box.getByLabel("Custom").check();
    await box.getByLabel("Slide numbers").fill(custom);
  } else await box.getByLabel(/^All slides/).check();
  const [file] = await Promise.all([page.waitForEvent("download"), box.getByRole("button", { name: "Download" }).click()]);
  return { name: file.suggestedFilename(), bytes: await readFile(await file.path()) };
}

const wordText = (bytes) => strFromU8(unzipSync(new Uint8Array(bytes))["word/document.xml"]);

try {
  await page.goto(`${APP}/presentation/${presentationId}`, { timeout: 120_000 });
  await page.getByRole("heading", { name: "Download e2e: planets" }).waitFor();
  check("the presentation page has no Download button", (await page.locator('button[title="Download"]').count()) === 0);
  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  await page.locator('button[title="Download"]').waitFor();

  const word = await download("Word (.docx)");
  check("the box closes after the download", await box.isHidden());
  check("Word: the file is named after the title", word.name === "Download e2e planets.docx", word.name);
  const files = unzipSync(new Uint8Array(word.bytes));
  const xml = strFromU8(files["word/document.xml"]);
  const keyAt = xml.indexOf(">Answer key<");
  check("Word: question 1 with its options, none marked", xml.includes(">1. Which planet is the largest?<") && xml.includes(">A. Jupiter<") && !xml.includes("correct"));
  check("Word: the Answer key comes last, with 1. A. Jupiter", keyAt > xml.indexOf(">B. Mars<") && /^[\s\S]*?>1\. <\/w:t>[\s\S]*?>A\. Jupiter</.test(xml.slice(keyAt)));
  const media = Object.keys(files).filter((name) => name.startsWith("word/media/"));
  const jpegs = media.length === 2 && media.every((name) => files[name][0] === 0xff && files[name][1] === 0xd8);
  check("Word: the photo and its cropped, flipped copy are inside as two real JPEG pictures", jpegs, media.join(", "));
  // A JPEG's size sits after its SOF0 mark (FF C0): height then width, 2 bytes each.
  const size = (bytes) => {
    const at = bytes.findIndex((byte, i) => byte === 0xff && (bytes[i + 1] === 0xc0 || bytes[i + 1] === 0xc2));
    return { height: (bytes[at + 5] << 8) | bytes[at + 6], width: (bytes[at + 7] << 8) | bytes[at + 8] };
  };
  const [a, b] = media.map((name) => size(files[name]));
  check("Word: the cropped one is half as wide (same height)", a && b && a.height === b.height && Math.abs(Math.min(a.width, b.width) * 2 - Math.max(a.width, b.width)) <= 2, JSON.stringify([a, b]));
  check("Word: no photo fell back to a link", !xml.includes("Photo (link)"));
  check("Word: no 'couldn't be added' toast", (await page.getByText("couldn't be added").count()) === 0);

  await page.locator('button[title="Download"]').click();
  await box.getByLabel("Word (.docx)").check();
  await box.getByLabel(/^All slides/).check();
  await box.screenshot({ path: SHOTS + "download-box.png" });
  await box.getByLabel("Custom").check();
  await box.screenshot({ path: SHOTS + "download-box-custom.png" });
  await box.getByLabel("Slide numbers").fill("1, 9");
  await box.getByRole("button", { name: "Download" }).click();
  check("Custom: a number past the last slide is refused with words", await box.getByText("This presentation has 2 slides").isVisible());
  await box.getByRole("button", { name: "Cancel" }).click();

  const second = wordText((await download("Word (.docx)", "2")).bytes);
  check("Custom 2: only the photo slide, no question and no Answer key", !second.includes("Which planet") && !second.includes("Answer key") && second.includes("<w:drawing>"));

  const text = await download("Text (.txt)");
  const markdown = text.bytes.toString("utf8");
  check("Text: the file is named after the title", text.name === "Download e2e planets.txt", text.name);
  check(
    "Text: Markdown with plain options, the photo link and the key at the end",
    markdown.includes("1. Which planet is the largest?\n\n- A. Jupiter\n- B. Mars") &&
      markdown.includes(`![Photo](${PHOTO})`) &&
      markdown.includes(`![Photo (cropped on the slide)](${PHOTO})`) &&
      markdown.endsWith("## Answer key\n\n1. A. Jupiter\n"),
  );

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (error) {
  check("run finished without an exception", false, String(error).split("\n").slice(0, 4).join(" "));
  await page.screenshot({ path: SHOTS + "download-word-failure.png" });
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}

finish();
