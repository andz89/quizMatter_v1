// A plain teacher's 50 MB photo storage in many cases (supabase/migrations/20261231002600_photo_storage.sql and its
// fixes): uploads stop at the limit and only there, a photo that already counts is always allowed, removing photos
// frees space (a fresh upload at once), a photo still on a slide keeps counting, putting one back on a slide while
// full is refused, a copied photo never counts, two uploads at once can't both pass, the editor's Upload is greyed out
// and its message shows, losing the editor role brings back 50 MB, and an admin has no limit.
// The account is filled straight in the database (1 MB records an hour old, in My photos), so only the real tries
// go through the app's /api/upload-image.
import { randomBytes, randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, asUser, check, deleteTeacher, finish, loggedIn, makeTeacher, psql, rpc } from "./lib.mjs";

const MB = 1024 * 1024;
const LIMIT = 50 * MB;
const PREFIX = "https://images.quizmatter.com/uploads/";

// A WebP of exactly `bytes` bytes (only the first bytes say what a file is; the random rest makes a new file).
const webp = (bytes) => Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), randomBytes(bytes - 12)]);
const hexSrc = () => `${PREFIX}${randomBytes(32).toString("hex")}.webp`;

const teacher = await makeTeacher({ first: "Storage", last: "Teacher" });
const other = await makeTeacher({ first: "Other", last: "Teacher" });
const editor = await makeTeacher({ first: "Former", last: "Editor" });
const admin = await makeTeacher({ first: "Storage", last: "Admin", admin: true });
psql(`insert into public.editors (user_id) values ('${editor.id}')`);

const used = (person = teacher) => Number(psql(`select public.photo_storage_used('${person.id}')`));
const uploadRecords = (person = teacher) => psql(`select count(*) from public.photo_uploads where user_id = '${person.id}'`);
const uploadClicks = (person = teacher) =>
  psql(`select coalesce(sum(clicks), 0) from public.click_rate where user_id = '${person.id}' and feature = 'photo_upload'`);

/** Records of `bytes` (1 MB each, the last one smaller) for `person`, in their My photos, uploaded an hour ago. */
function addFiller(person, bytes) {
  const srcs = [];
  for (let left = bytes; left > 0; left -= MB) {
    const src = hexSrc();
    srcs.push(src);
    psql(`insert into public.photos (user_id, src, width, height, created_at) values ('${person.id}', '${src}', 10, 10, now() - interval '1 hour');
          insert into public.photo_uploads (user_id, src, bytes, created_at) values ('${person.id}', '${src}', ${Math.min(left, MB)}, now() - interval '1 hour');`);
  }
  return srcs;
}

/** Sets `person`'s total to exactly `bytes`: their records that no slide of theirs has are removed, then filled up. */
function setUsed(person, bytes) {
  psql(`delete from public.photos p where p.user_id = '${person.id}'
          and not exists (select 1 from public.slide_photos sp join public.presentations pr on pr.id = sp.presentation_id
                          where sp.src = p.src and pr.owner_id = '${person.id}');
        delete from public.photo_uploads u where u.user_id = '${person.id}'
          and not exists (select 1 from public.slide_photos sp join public.presentations pr on pr.id = sp.presentation_id
                          where sp.src = u.src and pr.owner_id = '${person.id}');`);
  const now = used(person);
  if (bytes < now) throw new Error(`setUsed: ${bytes} is less than what slides already hold (${now})`);
  return addFiller(person, bytes - now);
}

/** One upload through the app, as the browser's logged-in teacher. */
async function upload(context, file) {
  const res = await context.request.post(`${APP}/api/upload-image?width=10&height=10`, {
    data: file,
    headers: { "Content-Type": "image/webp" },
  });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

const slideData = (id, srcs) => ({
  id,
  type: "choice",
  question: "Which is it?",
  questionHtml: "<p>Which is it?</p>",
  layout: "grid",
  options: ["a", "b", "c", "d"].map((x) => ({ id: `${id}-${x}`, text: x })),
  correctOptionId: null,
  questionHeight: 150,
  elements: srcs.map((src, i) => ({
    id: `${id}-p${i}`, assetId: "photo", x: 100 + i * 10, y: 100, width: 200, height: 200, containerId: null, color: "#3B82F6", src,
  })),
});
/** The teacher changes slide `id`'s photos themselves (a direct save, so the database rules apply to them). */
const setSlidePhotos = (id, srcs) =>
  asUser(teacher, `/rest/v1/slides?presentation_id=eq.${presentationId}&id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ data: slideData(id, srcs) }),
  });

// The teacher's presentation: slide 1 with photo `onSlide` (theirs, 1 MB), slide 2 empty.
const presentationId = randomUUID();
const [onSlide] = addFiller(teacher, MB);
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "Storage Quiz", data_version: 1 }),
});
for (const [position, id, srcs] of [[0, "s1", [onSlide]], [1, "s2", []]]) {
  await api("/rest/v1/slides", {
    method: "POST",
    body: JSON.stringify({ presentation_id: presentationId, id, position, data: slideData(id, srcs) }),
  });
}

const browser = await chromium.launch();
const context = await loggedIn(browser, teacher, { width: 1600, height: 1000 });
const page = await context.newPage();
page.setDefaultTimeout(60_000);

const openMyPhotos = async () => {
  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  await page.locator('[data-slide-id="s1"]').waitFor();
  await page.getByRole("button", { name: "Photos", exact: true }).click();
  await page.getByRole("tab", { name: "My Photos" }).click();
  await page.getByTestId("photo-storage").waitFor();
};

try {
  // ── 1. Room left: an upload that fits is stored and answers the new total ────────────────────────────────────
  setUsed(teacher, 49 * MB);
  const half = webp(MB / 2);
  let res = await upload(context, half);
  check(
    "at 49 MB a 0.5 MB upload is stored, answering 49.5 MB of 50 MB",
    res.status === 200 && res.body?.storage?.limit === LIMIT && res.body.storage.used === 49.5 * MB,
    `${res.status} ${JSON.stringify(res.body)}`
  );

  // ── 2. Doesn't fit what's left: refused, nothing held, not counted as an upload click ────────────────────────
  let records = uploadRecords();
  let clicks = uploadClicks();
  res = await upload(context, webp(MB));
  check(
    "at 49.5 MB a 1 MB upload is refused (413, QMSTO, names 50 MB)",
    res.status === 413 && res.body?.code === "QMSTO" && res.body.error.includes("(50 MB)"),
    `${res.status} ${JSON.stringify(res.body)}`
  );
  check("the refused answer carries the real total", res.body?.storage?.used === 49.5 * MB, JSON.stringify(res.body?.storage));
  check("the refused upload holds no space", used() === 49.5 * MB && uploadRecords() === records, `${used()} ${uploadRecords()}`);
  check("the refused upload isn't an upload click (never pauses or bans)", uploadClicks() === clicks, `${clicks} → ${uploadClicks()}`);

  // ── 3. Exactly the space left fits; then the account is full ─────────────────────────────────────────────────
  res = await upload(context, webp(LIMIT - used()));
  check("an upload of exactly the space left is stored", res.status === 200 && used() === LIMIT, `${res.status} ${used()}`);
  res = await upload(context, webp(1024));
  check("at exactly 50 MB even a 1 KB upload is refused", res.status === 413 && res.body?.code === "QMSTO", `${res.status}`);

  // ── 4. A photo that already counts may be uploaded again while full (it's the same file) ─────────────────────
  res = await upload(context, half);
  check("uploading a counted photo again while full works, the total unchanged", res.status === 200 && used() === LIMIT, `${res.status} ${used()}`);

  // ── 5. The editor while full: the bar, the message, Upload greyed out ────────────────────────────────────────
  await openMyPhotos();
  const barText = await page.getByTestId("photo-storage").innerText();
  check("the bar says 50 MB of 50 MB", barText.includes("50 MB of 50 MB"), barText);
  check("the full message shows", await page.getByText("Your photo storage is full (50 MB).").first().isVisible());
  check("Upload photo is greyed out", await page.getByRole("button", { name: "Upload photo" }).isDisabled());
  await page.screenshot({ path: `${SHOTS}photo-storage-teacher-full.png` });

  // ── 6. Removing a photo from My photos (on no slide) frees its space ─────────────────────────────────────────
  const filler = psql(`select u.src from public.photo_uploads u where u.user_id = '${teacher.id}' and u.bytes = ${MB}
                         and u.src <> '${onSlide}' limit 1`);
  res = await rpc(teacher, "remove_my_photo", { target_src: filler, mode: "if_unused" });
  check("removing an unused photo works", res.ok && res.body?.removed === true, JSON.stringify(res.body));
  check("it frees its 1 MB", used() === LIMIT - MB, `${used()}`);
  const fresh = webp(MB / 2);
  res = await upload(context, fresh);
  check("with 1 MB free a 0.5 MB upload is stored again", res.status === 200 && used() === LIMIT - MB / 2, `${res.status} ${used()}`);

  // ── 7. Removing a photo just uploaded frees it at once (not after its 10-minute hold) ────────────────────────
  res = await rpc(teacher, "remove_my_photo", { target_src: res.body.src, mode: "if_unused" });
  check("removing the fresh upload frees it at once", res.body?.removed === true && used() === LIMIT - MB, `${used()}`);

  // ── 8. A photo still on a slide keeps counting after it leaves My photos ─────────────────────────────────────
  setUsed(teacher, LIMIT);
  res = await rpc(teacher, "remove_my_photo", { target_src: onSlide, mode: "remove" });
  check("a photo on slide 1 can be removed from My photos", res.body?.removed === true, JSON.stringify(res.body));
  check("it still counts (still full)", used() === LIMIT, `${used()}`);
  res = await upload(context, webp(1024));
  check("so uploads are still refused", res.status === 413, `${res.status}`);

  // ── 9. Taking it off the slide frees it; putting it back while full is refused ───────────────────────────────
  res = await setSlidePhotos("s1", []);
  check("taking it off slide 1 saves", res.ok, JSON.stringify(res.body));
  check("and frees its 1 MB", used() === LIMIT - MB, `${used()}`);
  addFiller(teacher, MB);
  check("(full again)", used() === LIMIT, `${used()}`);
  res = await setSlidePhotos("s1", [onSlide]);
  check("putting the uncounted photo back on a slide while full is refused (QMSTO)", res.body?.code === "QMSTO", JSON.stringify(res.body));
  check(
    "the slide stays without it",
    psql(`select count(*) from public.slide_photos where presentation_id = '${presentationId}' and src = '${onSlide}'`) === "0"
  );

  // ── 10. Photos that already count, and copied photos, can go on slides while full ────────────────────────────
  const counted = psql(`select src from public.photos where user_id = '${teacher.id}' limit 1`);
  res = await setSlidePhotos("s2", [counted]);
  check("a photo from My photos (already counted) goes on a slide while full", res.ok && used() === LIMIT, JSON.stringify(res.body));
  const [othersPhoto] = addFiller(other, MB);
  res = await setSlidePhotos("s2", [counted, othersPhoto]);
  check("another teacher's photo goes on a slide while full", res.ok, JSON.stringify(res.body));
  check("and it doesn't count for the copier", used() === LIMIT, `${used()}`);

  // ── 11. Two uploads at once with room for only one: exactly one passes ───────────────────────────────────────
  setUsed(teacher, LIMIT - 1.5 * MB);
  const both = await Promise.all([upload(context, webp(MB)), upload(context, webp(MB))]);
  const statuses = both.map((r) => r.status).sort();
  check("two 1 MB uploads at once with 1.5 MB free: one stored, one refused", statuses.join(",") === "200,413", statuses.join(","));
  check("the total never passes 50 MB", used() === LIMIT - MB / 2, `${used()}`);

  // ── 12. In the editor: an upload that won't fit shows the message; one that fits works ───────────────────────
  const png = await page.screenshot(); // a real picture for the file box (the browser shrinks it to WebP)
  setUsed(teacher, LIMIT - 100);
  records = uploadRecords();
  await openMyPhotos();
  check("Upload photo still works with 100 bytes free", await page.getByRole("button", { name: "Upload photo" }).isEnabled());
  await page.locator('input[type="file"]').setInputFiles({ name: "class.png", mimeType: "image/png", buffer: png });
  await page.getByText("Your photo storage is full (50 MB).").first().waitFor();
  check("a photo too big for the 100 bytes left shows the full message", true);
  check("and nothing was stored", uploadRecords() === records, `${records} → ${uploadRecords()}`);
  await page.screenshot({ path: `${SHOTS}photo-storage-teacher-refused.png` });

  setUsed(teacher, 40 * MB);
  records = uploadRecords();
  await openMyPhotos();
  await page.locator('input[type="file"]').setInputFiles({ name: "class.png", mimeType: "image/png", buffer: png });
  // Above 10 MB the bar shows whole MB, so a small photo doesn't change "40 MB": wait for the stored record.
  const deadline = Date.now() + 60_000;
  while (Number(uploadRecords()) === Number(records) && Date.now() < deadline) await page.waitForTimeout(500);
  check("at 40 MB the same photo uploads (one new record)", Number(uploadRecords()) === Number(records) + 1, uploadRecords());
  check("its total counts it", used() > 40 * MB, `${used()}`);
  check("no full message this time", !(await page.getByText("Your photo storage is full").first().isVisible()));
  // Leave the editor (the UI upload put the photo on its slide 1): its auto save would write over the slides below.
  // Leaving asks "Leave page?" about the unsaved photo.
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("about:blank");

  // ── 13. The editor's own save (save_presentation, one request) while full ────────────────────────────────────
  // `onSlide` goes back on slide 1 into the last 1 MB; it counts only by being there. setUsed removes records that
  // no slide has, so `onSlide` (on none since step 9) gets its upload record back.
  check("(room for it)", (await setSlidePhotos("s2", [])).ok);
  setUsed(teacher, LIMIT - MB);
  psql(`insert into public.photo_uploads (user_id, src, bytes, created_at)
        values ('${teacher.id}', '${onSlide}', ${MB}, now() - interval '1 hour') on conflict do nothing`);
  const back = await setSlidePhotos("s1", [onSlide]);
  check("(it goes back on slide 1 into the last 1 MB)", back.ok && used() === LIMIT, `${used()}`);
  const save = (slides) => {
    const base = Number(psql(`select floor(extract(epoch from updated_at) * 1000)::bigint from public.presentations where id = '${presentationId}'`));
    const presentation = {
      id: presentationId, title: "Storage Quiz", description: "", grades: [], subject: "", curriculum: "",
      learningCompetency: "", author: "", referenceLinks: [], createdAt: Date.now(), slides,
    };
    return rpc(teacher, "save_presentation", {
      presentation, slide_ids: slides.map((s) => s.id), base_updated_at: base, app_version: Number(psql("select public.current_data_version()")),
    });
  };
  res = await save([slideData("s1", []), slideData("s2", [onSlide])]);
  check("moving a photo from slide 1 to slide 2 in one save works while full", res.ok && used() === LIMIT, `${res.status} ${JSON.stringify(res.body)}`);
  res = await save([slideData("s3", [onSlide])]);
  check("deleting its slide and putting it on a new one in the same save works", res.ok && used() === LIMIT, `${res.status} ${JSON.stringify(res.body)}`);
  await api(`/rest/v1/presentations?id=eq.${presentationId}`, { method: "DELETE" });
  check("deleting the presentation frees the photo", used() === LIMIT - MB, `${used()}`);

  // ── 14. An editor who loses the role is back to 50 MB ────────────────────────────────────────────────────────
  const editorContext = await loggedIn(browser, editor);
  setUsed(editor, 100 * MB);
  res = await upload(editorContext, webp(MB));
  check("an editor at 100 MB can upload (500 MB)", res.status === 200 && res.body?.storage?.limit === 500 * MB, `${res.status}`);
  psql(`delete from public.editors where user_id = '${editor.id}'`);
  res = await upload(editorContext, webp(MB));
  check(
    "without the role the same account is refused (50 MB)",
    res.status === 413 && res.body?.error?.includes("(50 MB)") && res.body?.storage?.limit === LIMIT,
    `${res.status} ${JSON.stringify(res.body)}`
  );
  await editorContext.close();

  // ── 15. An admin has no limit ────────────────────────────────────────────────────────────────────────────────
  const adminContext = await loggedIn(browser, admin);
  setUsed(admin, 60 * MB);
  res = await upload(adminContext, webp(MB));
  check("an admin at 60 MB can still upload (no limit)", res.status === 200 && res.body?.storage?.limit === null, `${res.status} ${JSON.stringify(res.body?.storage)}`);
  await adminContext.close();
} finally {
  await browser.close();
  for (const person of [teacher, other, editor, admin]) await deleteTeacher(person);
}
finish();
