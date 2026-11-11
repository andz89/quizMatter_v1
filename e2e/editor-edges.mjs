// The edges of Submit to QuizMatter and Reviews that submissions.mjs and reviews.mjs don't walk through:
// submitting from the editor's Share card (unsaved edits are saved first; Published is greyed out for editors),
// an editor's photo staying private until its presentation or review is live (and locked while it waits), two
// admins approving or publishing at the same moment, an older app tab's review save, banning an editor and
// removing one in Admin → Editors (their review and submission end), the "Copied from" line, phone width, and keys
// pressed while a box is open in the editor (they must not change the slide behind it).
import { randomBytes, randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, api, asUser, check, deleteTeacher, finish, loggedIn, makeTeacher, psql, rpc } from "./lib.mjs";

const tag = Date.now();
const superAdmin = await makeTeacher({ first: "Edgesuper", superAdmin: true });
const plainAdmin = await makeTeacher({ first: "Edgeplainadmin", admin: true });
const editorA = await makeTeacher({ first: "Edgeone", last: "Editor" });
const editorB = await makeTeacher({ first: "Edgetwo", last: "Editor" });
const editorBan = await makeTeacher({ first: "Edgeban", last: "Editor" });
const editorGone = await makeTeacher({ first: "Edgegone", last: "Editor" });
psql(`
  insert into public.editors (user_id) values ('${editorA.id}'), ('${editorB.id}'), ('${editorBan.id}'), ('${editorGone.id}');
`);

const options = (id, empty) => ["a", "b", "c", "d"].map((o) => ({ id: `${id}-${o}`, text: empty ? "" : o.toUpperCase() }));
const slide = (id, question, elements = [], type = "choice") => ({
  id,
  type,
  question,
  layout: "grid",
  options: options(id, type === "blank"),
  correctOptionId: null,
  elements,
  questionHeight: 100,
});
const element = (assetId, id, extra = {}) => ({
  id, assetId, x: 300, y: 200, width: 200, height: 200, color: "#3B82F6", containerId: null, ...extra,
});
const photoSrc = () => `https://images.quizmatter.com/uploads/${randomBytes(32).toString("hex")}.webp`;
const photoElement = (id, src) => element("photo", id, { width: 400, height: 300, image: { src, width: 800, height: 600 } });

/** A presentation with the given slides (default: 2 question slides). `extra` sets columns (lesson, copied_from…). */
async function makePresentation(ownerId, title, slides = [slide("s1", "One?"), slide("s2", "Two?")], extra = {}) {
  const id = randomUUID();
  await api("/rest/v1/presentations", {
    method: "POST",
    body: JSON.stringify({ id, owner_id: ownerId, title, data_version: 1, ...extra }),
  });
  await api("/rest/v1/slides", {
    method: "POST",
    body: JSON.stringify(slides.map((s, i) => ({ presentation_id: id, id: s.id, position: i, data: s }))),
  });
  return id;
}
const LESSON = { from_admin: true, is_published: true };
const T = (name) => `${name} edge ${tag}`;

// ─── Database reads ───────────────────────────────────────────────────────────────────────────────────────────
const submissionStatus = (id) =>
  psql(`select status from public.presentation_submissions where presentation_id = '${id}'`);
const reviewOf = (id) =>
  psql(`select status || '|' || canceled_by_admin from public.presentation_reviews where presentation_id = '${id}'`);
const isEditor = (person) => psql(`select count(*) from public.editors where user_id = '${person.id}'`) === "1";
const photoPublic = (src) => psql(`select coalesce((select is_public::text from public.shared_photos where src = '${src}'), 'none')`);
const ownerChange = (id) =>
  asUser(superAdmin, `/rest/v1/presentations?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ description: `x ${Date.now()}` }) });
const addPhotoRow = (person, src) =>
  asUser(person, "/rest/v1/photos", { method: "POST", body: JSON.stringify({ src, width: 800, height: 600 }) });
const deletePhotoRow = (person, src) =>
  asUser(person, `/rest/v1/photos?src=eq.${encodeURIComponent(src)}`, { method: "DELETE" });
const today = () => new Date().toISOString().slice(0, 10);

// ─── Browser helpers ──────────────────────────────────────────────────────────────────────────────────────────
const browser = await chromium.launch();
const errors = [];
async function newPage(person, viewport = { width: 1400, height: 1000 }) {
  const page = await (await loggedIn(browser, person, viewport)).newPage();
  page.setDefaultTimeout(60_000);
  page.on("pageerror", (e) => errors.push(e.message));
  return page;
}
const toast = (page, text) => page.locator("[data-sonner-toast]").filter({ hasText: text });
const seen = (locator, timeout = 15_000) => locator.first().waitFor({ timeout }).then(() => true, () => false);
const go = (page, path) => page.goto(`${APP}${path}`, { timeout: 120_000 });
const atPath = (page, path) => page.waitForURL((u) => u.pathname === path, { timeout: 60_000 }).then(() => true, () => false);
// The smallest block holding both the text and the button (a row in an admin list).
const rowWith = (page, text, button) =>
  page.locator("div").filter({ hasText: text }).filter({ has: page.getByRole("button", { name: button, exact: true }) }).last();
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

try {
  // ══ 1. Submit from the editor's Share card: unsaved edits are saved first ════════════════════════════════════
  const shareId = await makePresentation(editorA.id, T("Share"));
  const pageA = await newPage(editorA);
  await go(pageA, `/presentation/${shareId}/edit`);
  const shareButton = pageA.getByRole("button", { name: "Share", exact: true });
  await shareButton.click();
  const published = pageA.getByRole("button", { name: /Published/ });
  check("an editor's Share card has Published greyed out", await published.isDisabled());
  check("…saying editors send theirs to QuizMatter", await seen(pageA.getByText("Editors send their presentations to QuizMatter instead")));
  let res = await rpc(editorA, "share_presentation", { target_id: shareId });
  check("an editor's publish call is refused too", !res.ok, JSON.stringify(res.body));
  await pageA.keyboard.press("Escape");
  // An edit that isn't saved yet (auto save waits 12 seconds).
  await pageA.locator('button[title="Hide slide when presenting"]').first().click();
  await shareButton.click();
  await pageA.getByRole("button", { name: "Submit to QuizMatter" }).click();
  check("Submit asks first", await seen(pageA.getByRole("dialog", { name: "Send it to QuizMatter?" })));
  await pageA.getByRole("button", { name: "Submit", exact: true }).click();
  check("a toast says it was sent", await seen(toast(pageA, "Sent to QuizMatter.")));
  check("it opens the view page", await atPath(pageA, `/presentation/${shareId}`));
  check("it is waiting for QuizMatter", submissionStatus(shareId) === "submitted");
  check(
    "the unsaved edit was saved first (slide 1 hidden)",
    psql(`select data ->> 'hidden' from public.slides where presentation_id = '${shareId}' and id = 's1'`) === "true",
  );

  // ══ 2. An editor's photo in a submission: private until approved, locked while it waits; two admins at once ══
  const subPhoto = photoSrc();
  res = await addPhotoRow(editorA, subPhoto);
  check("editor A uploads a photo (a My photos row)", res.ok, JSON.stringify(res.body));
  check("it waits in Admin → Photos, not public", photoPublic(subPhoto) === "false", photoPublic(subPhoto));
  const photoSubId = await makePresentation(editorA.id, T("Photo submission"), [
    slide("s1", "With a photo?", [photoElement("p1", subPhoto)]),
  ]);
  res = await rpc(editorA, "submit_presentation", { target_id: photoSubId });
  check("the presentation with the photo is submitted", res.ok, JSON.stringify(res.body));
  res = await deletePhotoRow(editorA, subPhoto);
  check("the photo can't be removed while it waits (QMPHL)", res.body?.code === "QMPHL", JSON.stringify(res.body));
  check("…and is still private", photoPublic(subPhoto) === "false");
  // Two admins click Approve at the same moment.
  const approvals = await Promise.all([
    rpc(superAdmin, "approve_submission", { target_id: photoSubId }),
    rpc(plainAdmin, "approve_submission", { target_id: photoSubId }),
  ]);
  check(
    "two Approves at once: one works, the other is refused (QMSUB)",
    approvals.filter((r) => r.ok).length === 1 && approvals.some((r) => r.body?.code === "QMSUB"),
    approvals.map((r) => JSON.stringify(r.body)).join(" / "),
  );
  check(
    "…and only one QuizMatter copy is made",
    psql(`select count(*) from public.presentations where title = '${T("Photo submission")}' and from_admin`) === "1",
  );
  check("once approved, the photo is public", photoPublic(subPhoto) === "true");

  // ══ 3. A photo in a review draft, an older app tab, and two admins publishing at once ════════════════════════
  const reviewLessonId = await makePresentation(superAdmin.id, T("Photo review"), undefined, LESSON);
  const pageB = await newPage(editorB);
  await go(pageB, `/presentation/${reviewLessonId}`);
  await pageB.getByRole("button", { name: "Review", exact: true }).click();
  await atPath(pageB, `/presentation/${reviewLessonId}/edit`);
  await pageB.locator('button[title="Hide slide when presenting"]').first().click();
  await pageB.getByRole("button", { name: "Save as draft" }).click();
  check("editor B saves a review draft", await seen(pageB.getByRole("button", { name: "Draft saved" }), 30_000));
  await pageB.close();
  const reviewPhoto = photoSrc();
  check("editor B uploads a photo", (await addPhotoRow(editorB, reviewPhoto)).ok);
  const [draftText, baseText] = psql(
    `select draft::text || E'\\t' || floor(extract(epoch from draft_updated_at) * 1000)::bigint
     from public.presentation_reviews where presentation_id = '${reviewLessonId}'`,
  ).split("\t");
  const draft = JSON.parse(draftText);
  draft.slides[1].elements.push(photoElement("p2", reviewPhoto));
  res = await rpc(editorB, "save_review_draft", { target_id: reviewLessonId, review_draft: draft, base_updated_at: Number(baseText), app_version: 3 });
  check("the draft is saved with the photo", res.ok, JSON.stringify(res.body));
  const base = res.body;
  // An older app tab (data version 2) is turned away, so it can't save over what this app saved.
  res = await rpc(editorB, "save_review_draft", { target_id: reviewLessonId, review_draft: draft, base_updated_at: base, app_version: 2 });
  check("an older app tab's draft save is refused (QMOLD)", res.body?.code === "QMOLD", JSON.stringify(res.body));
  res = await rpc(editorB, "submit_review", { target_id: reviewLessonId, review_draft: draft, reviewed_on: today(), base_updated_at: base, app_version: 2 });
  check("an older app tab's submit is refused (QMOLD)", res.body?.code === "QMOLD", JSON.stringify(res.body));
  res = await rpc(editorB, "submit_review", { target_id: reviewLessonId, review_draft: draft, reviewed_on: today(), base_updated_at: base, app_version: 3 });
  check("the current app's submit works", res.ok, JSON.stringify(res.body));
  check("the review's photo is still private", photoPublic(reviewPhoto) === "false");
  res = await deletePhotoRow(editorB, reviewPhoto);
  check("the review's photo can't be removed while it waits (QMPHL)", res.body?.code === "QMPHL", JSON.stringify(res.body));
  const publishes = await Promise.all([
    rpc(superAdmin, "publish_review", { target_id: reviewLessonId }),
    rpc(plainAdmin, "publish_review", { target_id: reviewLessonId }),
  ]);
  check(
    "two Publishes at once: one works, the other is refused",
    publishes.filter((r) => r.ok).length === 1,
    publishes.map((r) => JSON.stringify(r.body)).join(" / "),
  );
  check(
    "…and editor B is listed once in Reviewed by",
    psql(`select count(*) from public.presentation_reviewers where presentation_id = '${reviewLessonId}'`) === "1",
  );
  check("once published, the review's photo is public", photoPublic(reviewPhoto) === "true");
  check(
    "the live lesson has the photo",
    psql(`select count(*) from public.slides where presentation_id = '${reviewLessonId}' and data::text like '%${reviewPhoto}%'`) === "1",
  );

  // ══ 4. Banning an editor (Admin → Teachers): their review and submission end; unbanning doesn't give it back ══
  const banLessonId = await makePresentation(superAdmin.id, T("Ban lesson"), undefined, LESSON);
  const banOwnId = await makePresentation(editorBan.id, T("Ban own"));
  check("the editor to ban starts a review", (await rpc(editorBan, "start_review", { target_id: banLessonId })).ok);
  check("…and submits their own presentation", (await rpc(editorBan, "submit_presentation", { target_id: banOwnId })).ok);
  const superPage = await newPage(superAdmin);
  await go(superPage, "/admin/teachers");
  await rowWith(superPage, editorBan.email, "Ban").getByRole("button", { name: "Ban", exact: true }).click();
  await superPage.getByPlaceholder("e.g. Spam presentations").fill("Testing a ban");
  await superPage.getByRole("button", { name: "Ban teacher" }).click();
  check("the super admin's Ban says so", await seen(toast(superPage, `${editorBan.email} is banned.`)));
  check("banning takes the editor role away", !isEditor(editorBan));
  check("…cancels their review (by QuizMatter)", reviewOf(banLessonId) === "canceled|true", reviewOf(banLessonId));
  check("…and their waiting submission", submissionStatus(banOwnId) === "canceled", submissionStatus(banOwnId));
  check("the lesson is unlocked", (await ownerChange(banLessonId)).ok);
  res = await rpc(superAdmin, "approve_submission", { target_id: banOwnId });
  check("the canceled submission can't be approved", !res.ok, JSON.stringify(res.body));
  await rowWith(superPage, editorBan.email, "Unban").getByRole("button", { name: "Unban", exact: true }).click();
  await superPage.getByRole("button", { name: "Unban", exact: true }).last().click();
  check("Unban says so", await seen(toast(superPage, `${editorBan.email} can use QuizMatter again.`)));
  check("unbanning doesn't give the editor role back", !isEditor(editorBan));

  // ══ 5. A plain admin removes an editor in Admin → Editors ════════════════════════════════════════════════════
  const goneLessonId = await makePresentation(superAdmin.id, T("Removed lesson"), undefined, LESSON);
  const goneOwnId = await makePresentation(editorGone.id, T("Removed own"));
  check("the editor to remove starts a review", (await rpc(editorGone, "start_review", { target_id: goneLessonId })).ok);
  check("…and submits their own presentation", (await rpc(editorGone, "submit_presentation", { target_id: goneOwnId })).ok);
  const plainPage = await newPage(plainAdmin);
  await go(plainPage, "/admin/editors");
  // The editor's card: the one holding their email, the button and their open review.
  const goneRow = plainPage.locator("div.rounded-card").filter({ hasText: editorGone.email }).filter({ hasText: T("Removed lesson") });
  check("Admin → Editors shows their open review", await seen(goneRow.getByText("Reviewing")));
  await goneRow.getByRole("button", { name: "Remove as editor" }).click();
  await plainPage.getByRole("button", { name: "Remove editor" }).click();
  check("Remove says so", await seen(toast(plainPage, `${editorGone.email} is no longer an editor.`)));
  check("the role is gone", !isEditor(editorGone));
  check("their review is canceled (by QuizMatter)", reviewOf(goneLessonId) === "canceled|true", reviewOf(goneLessonId));
  check("their waiting submission is canceled", submissionStatus(goneOwnId) === "canceled");
  res = await asUser(editorGone, `/rest/v1/presentations?id=eq.${goneOwnId}`, { method: "PATCH", body: JSON.stringify({ description: "mine" }) });
  check("their own presentation is unlocked", res.ok, JSON.stringify(res.body));

  // ══ 6. "Copied from" on the admin's submission page ═════════════════════════════════════════════════════════
  const sourceId = await makePresentation(superAdmin.id, T("Copy source"), undefined, LESSON);
  const copiedId = await makePresentation(editorA.id, T("Copied"), undefined, { copied_from: sourceId });
  // "Copied from" only keeps a real source, so this one copies a lesson that is then deleted.
  const goneSourceId = await makePresentation(superAdmin.id, T("Deleted source"), undefined, LESSON);
  const orphanId = await makePresentation(editorA.id, T("Copied orphan"), undefined, { copied_from: goneSourceId });
  await api(`/rest/v1/presentations?id=eq.${goneSourceId}`, { method: "DELETE" });
  check("a copy is submitted", (await rpc(editorA, "submit_presentation", { target_id: copiedId })).ok);
  check("a copy of a deleted one is submitted", (await rpc(editorA, "submit_presentation", { target_id: orphanId })).ok);
  await go(superPage, `/admin/presentations/submissions/${copiedId}`);
  const sourceLink = superPage.getByRole("link", { name: T("Copy source") });
  check("its page says Copied from <title>", await seen(superPage.getByText("Copied from")) && await seen(sourceLink));
  check("…linking to the source", (await sourceLink.getAttribute("href")) === `/presentation/${sourceId}`);
  await go(superPage, `/admin/presentations/submissions/${orphanId}`);
  check("a copy of a deleted one says so", await seen(superPage.getByText("Copied from a presentation that was deleted")));

  // ══ 7. Phone width: no page scrolls sideways ════════════════════════════════════════════════════════════════
  const phone = { width: 390, height: 844 };
  const phoneA = await newPage(editorA, phone);
  await go(phoneA, "/reviews-submissions");
  await phoneA.getByText(T("Copied")).first().waitFor();
  check("phone: Reviews & submissions doesn't scroll sideways", await noSideScroll(phoneA));
  const phoneB = await newPage(editorB, phone);
  await go(phoneB, `/presentation/${sourceId}`);
  await phoneB.getByRole("button", { name: "Review", exact: true }).waitFor();
  check("phone: a lesson's view page with Review doesn't scroll sideways", await noSideScroll(phoneB));
  const phoneSuper = await newPage(superAdmin, phone);
  for (const [name, path, wait] of [
    ["the Submissions list", "/admin/presentations/submissions", T("Copied")],
    ["a submission's page", `/admin/presentations/submissions/${copiedId}`, "Copied from"],
    ["the Under review list", "/admin/presentations/reviews", null],
    ["Admin → Editors", "/admin/editors", editorA.email],
  ]) {
    await go(phoneSuper, path);
    if (wait) await phoneSuper.getByText(wait).first().waitFor();
    else await phoneSuper.waitForLoadState("networkidle");
    check(`phone: ${name} doesn't scroll sideways`, await noSideScroll(phoneSuper));
  }

  // ══ 8. Keys pressed while a box is open in the editor don't change the slide behind it ══════════════════════
  const keysId = await makePresentation(editorA.id, T("Keys"), [slide("s1", "", [element("star", "k1")], "blank")]);
  await go(pageA, `/presentation/${keysId}/edit`);
  const elements = pageA.locator("[data-element-id]");
  await pageA.locator('[data-element-id="k1"]').first().click();
  await pageA.keyboard.press("Control+c");
  await pageA.locator('button[title="Presentation details"]').click();
  const details = pageA.getByRole("dialog", { name: "Presentation details" });
  await details.waitFor();
  // A click on the box's title takes the focus out of its text boxes, as a teacher's click often does.
  await details.getByRole("heading", { name: "Presentation details" }).click();
  // Counted after each key, so a paste that the next key takes away again still shows.
  const counts = [];
  for (const key of ["Control+v", "ArrowRight", "Delete", "Control+z"]) {
    await pageA.keyboard.press(key);
    await pageA.waitForTimeout(300);
    counts.push(`${key} → ${await elements.count()}`);
  }
  check("Ctrl+V, arrows, Delete and Ctrl+Z with the Details box open change nothing behind it", counts.every((c) => c.endsWith("→ 1")), counts.join(", "));
  check("…and nothing was added to Undo", await pageA.locator('button[title="Undo (Ctrl+Z)"]').isDisabled());
  await pageA.keyboard.press("Escape");
  check("Escape closes the Details box", await details.waitFor({ state: "hidden", timeout: 3000 }).then(() => true, () => false));
  await pageA.keyboard.press("Control+v");
  check("with the box closed, Ctrl+V pastes again", await elements.nth(1).waitFor({ timeout: 5000 }).then(() => true, () => false));

  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
  // QuizMatter lessons and approved receipts stay after their people are deleted, and an open review blocks
  // deleting its lesson, so those go first.
  const people = [superAdmin, plainAdmin, editorA, editorB, editorBan, editorGone];
  // A waiting submission locks its presentation too, so submissions go before presentations.
  psql(`
    delete from public.presentation_reviews where presentation_id in
      (select id from public.presentations where title like '% edge ${tag}');
    delete from public.presentation_submissions where submitter_id in (${people.map((p) => `'${p.id}'`).join(", ")});
    delete from public.presentations where title like '% edge ${tag}';
  `);
  for (const person of people) await deleteTeacher(person);
}
finish();
