// Photo uploads: every teacher uploads their own photos (with their 50 MB storage bar in the Photos panel), a profile
// photo is stored before the profile switches to it (only editors get that far), and a too-big upload sent in pieces
// with no Content-Length is refused (413) like one with the header.
import { randomBytes, randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, api, check, deleteTeacher, finish, loggedIn, makeTeacher, psql } from "./lib.mjs";

const teacher = await makeTeacher({ first: "Plain" });
const editor = await makeTeacher({ first: "Editor" });
psql(`insert into public.editors (user_id) values ('${editor.id}')`);
const browser = await chromium.launch();
// Only the first bytes say what a file is, so random bytes after them make a new file each run.
const webp = () => Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), randomBytes(64)]);
const profileUrl = `${APP}/api/profile-photo?width=400&height=400`;
try {
  // A plain teacher is refused before anything is stored or counted.
  const teacherContext = await loggedIn(browser, teacher);
  const refused = await teacherContext.request.post(profileUrl, { data: webp(), headers: { "Content-Type": "image/webp" } });
  const refusedAnswer = await refused.json();
  check("a plain teacher can't add a profile photo (403)", refused.status() === 403, `${refused.status()} ${JSON.stringify(refusedAnswer)}`);
  const teacherRow = psql(`select count(*) from public.profile_photos where user_id = '${teacher.id}'`);

  // A plain teacher uploads their own photo: it's in their "My photos", and the answer carries their 50 MB storage.
  const own = await teacherContext.request.post(`${APP}/api/upload-image?width=10&height=10`, {
    data: webp(),
    headers: { "Content-Type": "image/webp" },
  });
  const ownAnswer = await own.json();
  check(
    "a plain teacher uploads their own photo, with their 50 MB storage",
    own.ok() && ownAnswer.storage?.limit === 52428800 && ownAnswer.storage.used > 0,
    `${own.status()} ${JSON.stringify(ownAnswer)}`
  );
  const ownRow = psql(`select count(*) from public.photos where user_id = '${teacher.id}' and src = '${ownAnswer.src}'`);
  check("it's in their My photos", ownRow === "1", `${ownRow} rows`);

  // Their Photos panel: the storage bar and an Upload button that works, no "available soon".
  const presentationId = randomUUID();
  await api("/rest/v1/presentations", {
    method: "POST",
    body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "Upload e2e", data_version: 1 }),
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
        elements: [],
      },
    }),
  });
  const page = await teacherContext.newPage();
  page.setDefaultTimeout(60_000);
  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  await page.locator('[data-slide-id="s1"]').waitFor();
  await page.getByRole("button", { name: "Photos", exact: true }).click();
  await page.getByRole("tab", { name: "My Photos" }).click();
  await page.getByTestId("photo-storage").waitFor();
  const bar = await page.getByTestId("photo-storage").innerText();
  check("the panel shows their storage of 50 MB", bar.includes("of 50 MB"), bar);
  check("Upload works for them", await page.getByRole("button", { name: "Upload photo" }).isEnabled());
  check("no \"available soon\"", (await page.getByText("This will be available soon.").count()) === 0);
  check("nothing is counted for them", teacherRow === "0", `${teacherRow} rows`);

  // An editor's photo is stored, then the profile switches to it and it counts.
  const editorContext = await loggedIn(browser, editor);
  const saved = await editorContext.request.post(profileUrl, { data: webp(), headers: { "Content-Type": "image/webp" } });
  const savedAnswer = await saved.json();
  check("an editor's profile photo saves", saved.ok() && savedAnswer.leftToday === 2, `${saved.status()} ${JSON.stringify(savedAnswer)}`);
  const row = psql(`select src || ' ' || changes from public.profile_photos where user_id = '${editor.id}'`);
  check("the profile points at the new photo, counted once", row === `${savedAnswer.src} 1`, row);

  // A body sent in pieces (no Content-Length) that grows past 2 MB.
  const cookie = (await editorContext.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  let sent = 0;
  const huge = new ReadableStream({
    pull(controller) {
      if (sent >= 20 * 1024 * 1024) return controller.close();
      const piece = new Uint8Array(256 * 1024);
      if (sent === 0) piece.set(webp());
      sent += piece.byteLength;
      controller.enqueue(piece);
    },
  });
  const tooBig = await fetch(`${APP}/api/upload-image?width=10&height=10`, {
    method: "POST",
    body: huge,
    duplex: "half",
    headers: { cookie, "Content-Type": "image/webp" },
  });
  check("a too-big upload with no Content-Length is refused (413)", tooBig.status === 413, `${tooBig.status}`);
} finally {
  await browser.close();
  await deleteTeacher(teacher);
  await deleteTeacher(editor);
}
finish();
