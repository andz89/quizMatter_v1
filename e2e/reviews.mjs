// Presentation reviews, with real clicks where a person would click: an editor starts a review of a QuizMatter
// lesson (it locks for everyone else), saves a draft, leaves and comes back, submits; a plain admin sends it back;
// they submit again; the super admin publishes it; then nobody can start another until "Open to all". Also: an
// editor stops their own review, an admin cancels one, an editor losing the role (their review and waiting
// submission are canceled), a reviewer whose account is deleted (the lesson unlocks), and the author's own update.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, asUser, check, deleteTeacher, finish, loggedIn, makeTeacher, psql, rpc } from "./lib.mjs";

const tag = Date.now();
const superAdmin = await makeTeacher({ first: "Revsuper", superAdmin: true });
const plainAdmin = await makeTeacher({ first: "Revplainadmin" });
const editorA = await makeTeacher({ first: "Revone", last: "Editor" });
const editorB = await makeTeacher({ first: "Revtwo", last: "Editor" });
const editorC = await makeTeacher({ first: "Revthree", last: "Editor" });
const editorD = await makeTeacher({ first: "Revfour", last: "Editor" });
const teacher = await makeTeacher({ first: "Revteacher" });
psql(`
  insert into public.admins (user_id, is_super) values ('${plainAdmin.id}', false);
  insert into public.editors (user_id) values ('${editorA.id}'), ('${editorB.id}'), ('${editorC.id}'), ('${editorD.id}');
`);

const slideData = (id, question) => ({
  id,
  type: "choice",
  question,
  layout: "grid",
  options: ["a", "b", "c", "d"].map((o) => ({ id: `${id}-${o}`, text: o.toUpperCase() })),
  correctOptionId: null,
  elements: [],
  questionHeight: 100,
});

/** A presentation with 3 slides; `lesson` makes it a shared QuizMatter lesson. */
async function makePresentation(ownerId, title, lesson) {
  const id = randomUUID();
  await api("/rest/v1/presentations", {
    method: "POST",
    body: JSON.stringify({ id, owner_id: ownerId, title, data_version: 1, ...(lesson && { from_admin: true, is_published: true }) }),
  });
  await api("/rest/v1/slides", {
    method: "POST",
    body: JSON.stringify(
      ["One?", "Two?", "Three?"].map((q, i) => ({ presentation_id: id, id: `s${i + 1}`, position: i, data: slideData(`s${i + 1}`, q) })),
    ),
  });
  return id;
}

const MAIN = `Lesson main rev ${tag}`;
const STOP = `Lesson stop rev ${tag}`;
const ROLE = `Lesson role rev ${tag}`;
const GONE = `Lesson gone rev ${tag}`;
const AUTHOR = `Lesson author rev ${tag}`;
const mainId = await makePresentation(superAdmin.id, MAIN, true);
const stopId = await makePresentation(superAdmin.id, STOP, true);
const roleId = await makePresentation(superAdmin.id, ROLE, true);
const goneId = await makePresentation(superAdmin.id, GONE, true);

// ─── Database reads ───────────────────────────────────────────────────────────────────────────────────────────
const reviewOf = (id) =>
  psql(`select status || '|' || coalesce(reviewer_id::text, '') || '|' || canceled_by_admin || '|' ||
               (draft is not null) || '|' || coalesce(admin_note, '')
        from public.presentation_reviews where presentation_id = '${id}'`).split("|");
const liveHidden = (id) =>
  psql(`select coalesce(data ->> 'hidden', 'false') from public.slides where presentation_id = '${id}' and id = 's1'`) === "true";
const ownerChange = (id, description) =>
  asUser(superAdmin, `/rest/v1/presentations?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ description }) });

// ─── Browser helpers ──────────────────────────────────────────────────────────────────────────────────────────
const browser = await chromium.launch();
const errors = [];
async function newPage(person) {
  const page = await (await loggedIn(browser, person, { width: 1400, height: 1000 })).newPage();
  page.setDefaultTimeout(60_000);
  page.on("pageerror", (e) => errors.push(e.message));
  return page;
}
const toast = (page, text) => page.locator("[data-sonner-toast]").filter({ hasText: text });
const seen = (locator, timeout = 15_000) => locator.first().waitFor({ timeout }).then(() => true, () => false);
const go = (page, path) => page.goto(`${APP}${path}`, { timeout: 120_000 });
const reviewButton = (page) => page.getByRole("button", { name: "Review", exact: true });
const atPath = (page, path) =>
  page.waitForURL((u) => u.pathname === path, { timeout: 60_000 }).then(() => true, () => false);
// The smallest block holding both the text and the button (a row in an admin list).
const rowWith = (page, text, button) =>
  page.locator("div").filter({ hasText: text }).filter({ has: page.getByRole("button", { name: button }) }).last();
const myRow = (page, title) => page.locator("tr").filter({ hasText: title });

/**
 * On the view page: clicks Review (or Update this lesson) and waits for the editor. With `toastText`, also that the
 * toast showed: watched from the click, since it can be gone by the time a slow page has loaded.
 */
async function startByClick(page, id, button = reviewButton(page), toastText = null) {
  await go(page, `/presentation/${id}`);
  const toastSeen = toastText && seen(toast(page, toastText), 60_000);
  await button.click();
  const opened = await atPath(page, `/presentation/${id}/edit`);
  return toastText ? opened && (await toastSeen) : opened;
}
/** In the review editor: hides slide 1 and clicks Save as draft. */
async function hideAndSaveDraft(page) {
  await page.locator('button[title="Hide slide when presenting"]').first().click();
  await page.getByRole("button", { name: "Save as draft" }).click();
  return seen(page.getByRole("button", { name: "Draft saved" }), 30_000);
}
/** In the review editor: ⋮ → Submit for publishing → the box's Submit for publishing. */
async function submitByClick(page) {
  await page.getByRole("button", { name: "Review actions" }).click();
  await page.getByRole("button", { name: "Submit for publishing" }).click();
  await page.getByRole("button", { name: "Submit for publishing" }).last().click();
  return seen(toast(page, "Thanks! QuizMatter will publish"));
}
/** The admin's review page: Publish → confirm. */
async function publishByClick(page, id) {
  await go(page, `/admin/presentations/reviews/${id}`);
  await page.getByRole("button", { name: "Publish" }).click();
  await page.getByRole("button", { name: "Publish" }).last().click();
  return seen(toast(page, "Published."));
}

try {
  const pageA = await newPage(editorA);
  const pageB = await newPage(editorB);
  const teacherPage = await newPage(teacher);
  const plainPage = await newPage(plainAdmin);
  const superPage = await newPage(superAdmin);

  // ══ 1. The main path: start → lock → draft → leave → continue → submit → send back → submit → publish ══════════
  await go(teacherPage, `/presentation/${mainId}`);
  await teacherPage.getByText(MAIN).first().waitFor();
  check("a plain teacher has no Review button", (await reviewButton(teacherPage).count()) === 0);

  check(
    "an editor's Review opens the editor, with a toast saying the review started",
    await startByClick(pageA, mainId, reviewButton(pageA), "You're reviewing this presentation now."),
  );
  let [status, reviewer] = reviewOf(mainId);
  check("the database has editor A reviewing", status === "reviewing" && reviewer === editorA.id, `${status} ${reviewer}`);

  // Locked for everyone else.
  await go(teacherPage, `/presentation/${mainId}`);
  check("teachers see Under review", await seen(teacherPage.getByText("Under review")));
  check("teachers can't copy it while it's under review", await teacherPage.getByRole("button", { name: "Make a copy" }).isDisabled());
  await go(pageB, `/presentation/${mainId}`);
  check("another editor sees Under review", await seen(pageB.getByText("Under review")));
  check("…and no Review button", (await reviewButton(pageB).count()) === 0);
  let res = await rpc(editorB, "start_review", { target_id: mainId });
  check("another editor's start is refused (QMRVW)", res.body?.code === "QMRVW", res.body?.message);
  res = await ownerChange(mainId, "Changed while under review");
  check("even its owner can't change it while it's under review (QMREV)", res.body?.code === "QMREV", JSON.stringify(res.body));
  res = await asUser(editorA, `/rest/v1/slides?presentation_id=eq.${mainId}&id=eq.s1`, {
    method: "PATCH",
    body: JSON.stringify({ data: { ...slideData("s1", "One?"), hidden: true } }),
  });
  check("the reviewer can't change the live slides directly", !res.ok || (res.body ?? []).length === 0, JSON.stringify(res.body));

  // The editor saves a draft and leaves before finishing.
  check("Save as draft saves the draft", await hideAndSaveDraft(pageA));
  check("the database has the draft", reviewOf(mainId)[3] === "true");
  check("teachers still see the live slide (not hidden)", !liveHidden(mainId));
  await go(pageA, "/reviews-submissions");
  check("Reviews & submissions says Reviewing", await seen(myRow(pageA, MAIN).getByText("Reviewing")));
  await go(pageA, `/presentation/${mainId}`);
  await pageA.getByRole("button", { name: "Continue review" }).or(pageA.getByRole("link", { name: "Continue review" })).click();
  check("Continue review opens the editor", await atPath(pageA, `/presentation/${mainId}/edit`));
  check("…with the saved draft (slide 1 still hidden)", await seen(pageA.locator('button[title="Show slide"]'), 30_000));

  // Submit.
  await pageA.getByRole("button", { name: "Review actions" }).click();
  await pageA.getByRole("button", { name: "Submit for publishing" }).click();
  check("the submit box shows the reviewer's email", await seen(pageA.getByText(editorA.email)));
  await pageA.getByRole("button", { name: "Submit for publishing" }).last().click();
  check("a toast thanks the reviewer", await seen(toast(pageA, "Thanks! QuizMatter will publish")));
  check("it goes back to the view page", await atPath(pageA, `/presentation/${mainId}`));
  check("the view page has See submitted version", await seen(pageA.getByText("See submitted version")));
  check("the database has it submitted", reviewOf(mainId)[0] === "submitted");
  await go(pageA, `/presentation/${mainId}/edit`);
  check("a submitted review opens view only", await seen(pageA.getByText("Submitted. QuizMatter will publish your changes")));
  check("…with no Save button", (await pageA.getByRole("button", { name: /Save as draft|Draft saved/ }).count()) === 0);
  await go(pageA, "/reviews-submissions");
  check("Reviews & submissions says Waiting for QuizMatter", await seen(myRow(pageA, MAIN).getByText("Waiting for QuizMatter")));

  // A plain admin sends it back.
  await go(plainPage, "/admin/presentations/reviews");
  await plainPage.getByRole("link", { name: new RegExp(MAIN) }).click();
  await plainPage.getByRole("button", { name: "Send back" }).click();
  const NOTE = "Please also fix slide 2.";
  const form = plainPage.locator("form").filter({ hasText: "What should they change?" });
  await form.locator("textarea").fill(NOTE);
  await form.getByRole("button", { name: "Send back" }).click();
  check("a toast says it was sent back", await seen(toast(plainPage, "Sent back to the reviewer.")));
  [status, , , , ] = reviewOf(mainId);
  check("the database has it reviewing again with the note", status === "reviewing" && reviewOf(mainId)[4] === NOTE);
  check("…and still locked (owner refused)", (await ownerChange(mainId, "x")).body?.code === "QMREV");
  await go(pageA, "/reviews-submissions");
  check("Reviews & submissions says Sent back", await seen(myRow(pageA, MAIN).getByText("Sent back")));
  check("…with the note", await seen(myRow(pageA, MAIN).getByText(NOTE)));
  await go(pageA, `/presentation/${mainId}/edit`);
  check("the editor shows QuizMatter sent this back", await seen(pageA.getByText("QuizMatter sent this back.")));
  await pageA.getByRole("button", { name: "View comments" }).click();
  check("View comments shows the note", await seen(pageA.getByText(NOTE)));
  const comments = pageA.getByRole("dialog", { name: "QuizMatter's comments" }).or(pageA.getByLabel("QuizMatter's comments"));
  await pageA.keyboard.press("Escape");
  const closedByEscape = await comments.first().waitFor({ state: "hidden", timeout: 3000 }).then(() => true, () => false);
  check("Escape closes the comments box", closedByEscape);
  if (!closedByEscape) await comments.first().getByRole("button", { name: "Close" }).click();
  check("the draft is still there after send back", await seen(pageA.locator('button[title="Show slide"]'), 30_000));
  check("it can be submitted again", await submitByClick(pageA));

  // The super admin publishes it.
  check("the super admin publishes it", await publishByClick(superPage, mainId));
  check("the live slide changed (slide 1 hidden)", liveHidden(mainId));
  check(
    "editor A is in its Reviewed by list",
    psql(`select count(*) from public.presentation_reviewers where presentation_id = '${mainId}' and reviewer_id = '${editorA.id}'`) === "1",
  );
  res = await ownerChange(mainId, "Changed after publish");
  check("after publishing it's unlocked (owner can change it)", res.ok, JSON.stringify(res.body));
  await go(teacherPage, `/presentation/${mainId}`);
  check("teachers see the reviewer's email on the view page", await seen(teacherPage.getByText(editorA.email)));
  check("…and no Under review", (await teacherPage.getByText("Under review").count()) === 0);
  check("teachers can copy it again", await teacherPage.getByRole("button", { name: "Make a copy" }).isEnabled());
  await go(pageA, "/reviews-submissions");
  check("Reviews & submissions says Published", await seen(myRow(pageA, MAIN).getByText("Published")));

  // Closed until an admin opens it again.
  await go(pageB, `/presentation/${mainId}`);
  await pageB.getByText(MAIN).first().waitFor();
  check("after publishing, another editor has no Review button", (await reviewButton(pageB).count()) === 0);
  await go(pageA, `/presentation/${mainId}`);
  await pageA.getByText(MAIN).first().waitFor();
  check("…nor its last reviewer", (await reviewButton(pageA).count()) === 0);
  res = await rpc(editorB, "start_review", { target_id: mainId });
  check("a start is refused: already reviewed", res.body?.code === "QMRVW" && /already reviewed/.test(res.body?.message), res.body?.message);
  await go(superPage, "/admin/presentations");
  await rowWith(superPage, MAIN, "Open to all").getByRole("button", { name: "Open to all" }).click();
  check("the admin's Open to all says so", await seen(toast(superPage, "Any editor can review it next.")));
  await go(pageB, `/presentation/${mainId}`);
  check("after Open to all, another editor has Review", await seen(reviewButton(pageB)));
  await pageB.screenshot({ path: `${SHOTS}reviews-open-again.png` });

  // ══ 2. The editor stops their own review, then an admin cancels the next one ════════════════════════════════════
  check("editor B starts a review", await startByClick(pageB, stopId));
  check("…and saves a draft", await hideAndSaveDraft(pageB));
  await pageB.getByRole("button", { name: "Review actions" }).click();
  await pageB.getByRole("button", { name: "Stop review" }).click();
  check("Stop review asks first", await seen(pageB.getByText("Stop this review?")));
  await pageB.getByRole("button", { name: "Stop review" }).last().click();
  check("a toast says nothing was changed", await seen(toast(pageB, "Review stopped. Nothing was changed.")));
  check("it goes back to the view page", await atPath(pageB, `/presentation/${stopId}`));
  let round = reviewOf(stopId);
  check("the database has it canceled by the editor, draft gone", round[0] === "canceled" && round[2] === "false" && round[3] === "false", round.join(" "));
  check("the live slide didn't change", !liveHidden(stopId));
  check("it's unlocked (owner can change it)", (await ownerChange(stopId, "After stop")).ok);
  await go(pageB, "/reviews-submissions");
  check("Reviews & submissions says Canceled by you", await seen(myRow(pageB, STOP).getByText("Canceled by you")));

  check("never published, so the editor can start again", await startByClick(pageB, stopId));
  await pageB.locator('button[title="Hide slide when presenting"]').first().click();
  await go(plainPage, "/admin/presentations/reviews");
  await rowWith(plainPage, STOP, "Cancel review").getByRole("button", { name: "Cancel review" }).click();
  await plainPage.getByRole("button", { name: "Cancel review" }).last().click();
  check("the admin's Cancel review says so", await seen(toast(plainPage, "Review canceled.")));
  round = reviewOf(stopId);
  check("the database has it canceled by the admin", round[0] === "canceled" && round[2] === "true", round.join(" "));
  await go(plainPage, "/admin/presentations/reviews");
  check("the admin's list says Canceled", await seen(plainPage.getByRole("listitem").or(plainPage.locator("div")).filter({ hasText: STOP }).getByText("Canceled", { exact: true })));
  // The editor still has the editor open: their save is refused, and nothing is saved. Auto save may have saved the
  // first edit before the cancel (a slow admin page takes over 12 seconds), so a fresh edit gives Save something to send.
  await pageB.locator('button[title="Hide slide when presenting"]').first().click();
  await pageB.getByRole("button", { name: "Save as draft" }).click();
  check("the editor's next save is refused", await seen(pageB.locator('[data-sonner-toast][data-type="error"]')));
  check("…and no draft was saved", reviewOf(stopId)[3] === "false");
  check("…and the live slide didn't change", !liveHidden(stopId));
  await go(pageB, "/reviews-submissions");
  check("Reviews & submissions says Canceled by QuizMatter", await seen(myRow(pageB, STOP).getByText("Canceled by QuizMatter")));

  // ══ 3. An editor loses the role: their open review and waiting submission are canceled ══════════════════════════
  res = await rpc(editorC, "start_review", { target_id: roleId });
  check("editor C starts a review", res.ok, JSON.stringify(res.body));
  const cOwnId = await makePresentation(editorC.id, `Own role rev ${tag}`, false);
  res = await rpc(editorC, "submit_presentation", { target_id: cOwnId });
  check("editor C submits their own presentation", res.ok, JSON.stringify(res.body));
  psql(`delete from public.editors where user_id = '${editorC.id}'`);
  round = reviewOf(roleId);
  check("the review is canceled (by QuizMatter)", round[0] === "canceled" && round[2] === "true", round.join(" "));
  check(
    "the waiting submission is canceled",
    psql(`select status from public.presentation_submissions where presentation_id = '${cOwnId}'`) === "canceled",
  );
  check("the lesson is unlocked", (await ownerChange(roleId, "After role removed")).ok);
  res = await asUser(editorC, `/rest/v1/presentations?id=eq.${cOwnId}`, { method: "PATCH", body: JSON.stringify({ description: "mine again" }) });
  check("their own presentation is unlocked", res.ok, JSON.stringify(res.body));

  // ══ 4. A reviewer's account is deleted: the lesson doesn't stay locked ══════════════════════════════════════════
  res = await rpc(editorD, "start_review", { target_id: goneId });
  check("editor D starts a review", res.ok, JSON.stringify(res.body));
  check("…which locks the lesson", (await ownerChange(goneId, "x")).body?.code === "QMREV");
  await deleteTeacher(editorD);
  check("after D's account is deleted, the owner can change it", (await ownerChange(goneId, "After delete")).ok);
  res = await rpc(editorB, "start_review", { target_id: goneId });
  check("…and another editor can start a review", res.ok, JSON.stringify(res.body));
  await rpc(editorB, "stop_review", { target_id: goneId });

  // ══ 5. The author's own update, while the lesson is closed to other editors ════════════════════════════════════
  const aOwnId = await makePresentation(editorA.id, AUTHOR, false);
  await rpc(editorA, "submit_presentation", { target_id: aOwnId });
  const authorLesson = (await rpc(superAdmin, "approve_submission", { target_id: aOwnId })).body;
  check("editor A's presentation is a QuizMatter lesson", typeof authorLesson === "string", JSON.stringify(authorLesson));
  // Someone else reviewed it before and it's closed (not open to all).
  psql(`insert into public.presentation_reviews (presentation_id, last_reviewer_id, open_to_all)
        values ('${authorLesson}', '${editorB.id}', false)
        on conflict (presentation_id) do update set last_reviewer_id = excluded.last_reviewer_id, open_to_all = false`);
  await go(pageB, `/presentation/${authorLesson}`);
  await pageB.getByText(AUTHOR).first().waitFor();
  check("another editor has no Review on the closed lesson", (await reviewButton(pageB).count()) === 0);
  check(
    "its author's Update this lesson opens the editor, with a toast saying the update started",
    await startByClick(pageA, authorLesson, pageA.getByRole("button", { name: "Update this lesson" }), "You're updating this lesson now."),
  );
  await pageA.locator('button[title="Hide slide when presenting"]').first().click();
  check("the author submits the update", await submitByClick(pageA));
  await go(superPage, "/admin/presentations/reviews");
  check("the admin's list says Update by the author", await seen(superPage.locator("div").filter({ hasText: AUTHOR }).getByText(/Update by the author/)));
  check("the super admin publishes the update", await publishByClick(superPage, authorLesson));
  check("the live lesson changed", liveHidden(authorLesson));
  check(
    "an author's update adds no Reviewed by row",
    psql(`select count(*) from public.presentation_reviewers where presentation_id = '${authorLesson}'`) === "0",
  );
  check(
    "…and leaves the last reviewer and Open to all as they were",
    psql(`select last_reviewer_id || '|' || open_to_all from public.presentation_reviews where presentation_id = '${authorLesson}'`) ===
      `${editorB.id}|false`,
  );
  await go(pageA, "/reviews-submissions");
  check("Reviews & submissions says Update · published", await seen(myRow(pageA, AUTHOR).getByText(/Update · published/)));
  await pageA.screenshot({ path: `${SHOTS}reviews-editor-page.png`, fullPage: true });

  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
  // QuizMatter lessons and approved receipts stay after their people are deleted, so they go first.
  // An open review locks its lesson, even against deleting: end the rounds first.
  psql(`
    delete from public.presentation_reviews where presentation_id in
      (select id from public.presentations where title like '% rev ${tag}');
    delete from public.presentations where title like '% rev ${tag}';
    delete from public.presentation_submissions where submitter_id in ('${editorA.id}', '${editorC.id}');
  `);
  // editorD was deleted in scenario 4.
  for (const person of [superAdmin, plainAdmin, editorA, editorB, editorC, teacher]) await deleteTeacher(person);
}
finish();
