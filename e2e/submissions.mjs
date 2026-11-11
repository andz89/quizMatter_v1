// Submit to QuizMatter, start to end, with real clicks: an editor submits from the card's ⋮ menu (an empty one is
// refused), it's locked while it waits, a plain admin sends it back with a note, the editor sees the note and
// submits again, the super admin approves it (QuizMatter's own shared copy, the editor as Author), and it can't be
// submitted again. Also: a plain teacher can't submit, the admin pages are not found for teachers and for a decided
// one, and a presentation hidden while it waits can't be approved.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, asUser, check, deleteTeacher, finish, loggedIn, makeTeacher, psql, rpc } from "./lib.mjs";

const tag = Date.now();
const editor = await makeTeacher({ first: "Subeditor", last: "Maker" });
const teacher = await makeTeacher({ first: "Subteacher" });
const plainAdmin = await makeTeacher({ first: "Subplainadmin", admin: true });
const superAdmin = await makeTeacher({ first: "Subsuper", superAdmin: true });
psql(`insert into public.editors (user_id) values ('${editor.id}')`);

const slideData = (id, question) => ({
  id,
  type: "choice",
  question,
  layout: "grid",
  options: ["a", "b", "c", "d"].map((o) => ({ id: `${id}-${o}`, text: question ? o.toUpperCase() : "" })),
  correctOptionId: null,
  elements: [],
  questionHeight: 100,
});

/** A presentation with `questions.length` slides (an empty question makes an empty slide). */
async function makePresentation(ownerId, title, questions) {
  const id = randomUUID();
  await api("/rest/v1/presentations", {
    method: "POST",
    body: JSON.stringify({ id, owner_id: ownerId, title, data_version: 1 }),
  });
  await api("/rest/v1/slides", {
    method: "POST",
    body: JSON.stringify(
      questions.map((q, i) => ({ presentation_id: id, id: `s${i + 1}`, position: i, data: slideData(`s${i + 1}`, q) })),
    ),
  });
  return id;
}

const TITLE = `Submit e2e ${tag}`;
const EMPTY = `Empty e2e ${tag}`;
const HIDDEN = `Hidden e2e ${tag}`;
const TEACHERS = `Teacher e2e ${tag}`;
const mainId = await makePresentation(editor.id, TITLE, ["What is 2 + 2?", "What is 3 + 3?", "Name a planet."]);
const emptyId = await makePresentation(editor.id, EMPTY, [""]);
const hiddenId = await makePresentation(editor.id, HIDDEN, ["Hidden question?"]);
await makePresentation(teacher.id, TEACHERS, ["A teacher's question?"]);

const patchPresentation = (person, id, change) =>
  asUser(person, `/rest/v1/presentations?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(change) });
const submissionOf = (id) =>
  psql(`select status || '|' || coalesce(admin_note, '') || '|' || coalesce(copy_id, '')
        from public.presentation_submissions where presentation_id = '${id}'`);

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
const seen = (locator, timeout = 15_000) =>
  locator.first().waitFor({ timeout }).then(() => true, () => false);
// The card's white box (the title's nearest rounded-card).
const cardOf = (page, title) =>
  page.getByText(title, { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-card')][1]");

/** Opens a card's ⋮ menu and returns the names of its items. */
async function menuItems(page, title) {
  const button = page.getByRole("button", { name: `Options for ${title}` });
  await button.click();
  const menu = button.locator("xpath=following-sibling::div[1]");
  await menu.waitFor();
  return (await menu.locator("a, button").allInnerTexts()).map((t) => t.trim());
}
const closeMenu = (page) => page.keyboard.press("Escape");
const notFound = (page) => page.getByRole("heading", { name: "Page not found" });

async function openHome(page) {
  await page.goto(`${APP}/`, { timeout: 120_000 });
  await page.getByRole("button", { name: `Options for ${TITLE}` }).waitFor();
}

try {
  const editorPage = await newPage(editor);

  // ── 1. An empty presentation is refused ──────────────────────────────────────────────────────────────────────
  await openHome(editorPage);
  let items = await menuItems(editorPage, EMPTY);
  check("an editor's card menu has Submit to QuizMatter", items.includes("Submit to QuizMatter"), items.join(", "));
  await editorPage.getByRole("button", { name: "Submit to QuizMatter" }).click();
  await editorPage.getByRole("button", { name: "Submit", exact: true }).click();
  check(
    "an empty presentation is refused with a message",
    await seen(toast(editorPage, "Add a title and some content before publishing.")),
  );
  check("the empty one has no submission row", submissionOf(emptyId) === "");

  // ── 2. Submit ────────────────────────────────────────────────────────────────────────────────────────────────
  await menuItems(editorPage, TITLE);
  await editorPage.getByRole("button", { name: "Submit to QuizMatter" }).click();
  check("the confirm box asks first", await seen(editorPage.getByText("Send it to QuizMatter?")));
  await editorPage.getByRole("button", { name: "Submit", exact: true }).click();
  check("a toast says it was sent", await seen(toast(editorPage, "Sent to QuizMatter.")));
  check("the card says Waiting for QuizMatter", await seen(cardOf(editorPage, TITLE).getByText("Waiting for QuizMatter")));
  check("the database has it as submitted", submissionOf(mainId) === "submitted||");
  items = await menuItems(editorPage, TITLE);
  check("while waiting the menu has no Edit", !items.includes("Edit"), items.join(", "));
  check("while waiting the menu has no Delete", !items.includes("Delete"), items.join(", "));
  check("while waiting the menu has no Submit", !items.some((i) => i.startsWith("Submit")), items.join(", "));
  check("while waiting it can still be presented", items.includes("Present"), items.join(", "));
  await closeMenu(editorPage);
  await editorPage.screenshot({ path: `${SHOTS}submissions-waiting.png` });
  // Opening its editor by its address sends the editor to the view page, which says why.
  await editorPage.goto(`${APP}/presentation/${mainId}/edit`, { timeout: 120_000 });
  const wentToView = await editorPage
    .waitForURL((u) => u.pathname === `/presentation/${mainId}`, { timeout: 30_000 })
    .then(() => true, () => false);
  check("its editor's address opens the view page instead", wentToView, editorPage.url());
  check("the view page says Waiting for QuizMatter", await seen(editorPage.getByText("Waiting for QuizMatter")));

  // ── 3. Locked while it waits ─────────────────────────────────────────────────────────────────────────────────
  let res = await patchPresentation(editor, mainId, { title: "Changed while waiting" });
  check("a change while waiting is refused (QMREV)", res.body?.code === "QMREV", JSON.stringify(res.body));
  res = await asUser(editor, `/rest/v1/slides?presentation_id=eq.${mainId}&id=eq.s1`, {
    method: "PATCH",
    body: JSON.stringify({ data: slideData("s1", "Changed?") }),
  });
  check("a slide change while waiting is refused (QMREV)", res.body?.code === "QMREV", JSON.stringify(res.body));
  res = await asUser(editor, `/rest/v1/presentations?id=eq.${mainId}`, { method: "DELETE" });
  check("deleting while waiting is refused", res.body?.code === "QMREV", JSON.stringify(res.body));
  check("the title didn't change", psql(`select title from public.presentations where id = '${mainId}'`) === TITLE);
  res = await rpc(editor, "submit_presentation", { target_id: mainId });
  check("submitting it twice is refused (QMSUB)", res.body?.code === "QMSUB", JSON.stringify(res.body));

  // ── 4. Teachers can't submit or see the admin pages ──────────────────────────────────────────────────────────
  const teacherPage = await newPage(teacher);
  await teacherPage.goto(`${APP}/`, { timeout: 120_000 });
  await teacherPage.getByRole("button", { name: `Options for ${TEACHERS}` }).waitFor();
  items = await menuItems(teacherPage, TEACHERS);
  check("a plain teacher's menu has no Submit", !items.some((i) => i.startsWith("Submit")), items.join(", "));
  await closeMenu(teacherPage);
  const teachersId = psql(`select id from public.presentations where title = '${TEACHERS}'`);
  res = await rpc(teacher, "submit_presentation", { target_id: teachersId });
  check("a plain teacher's submit call is refused (42501)", res.body?.code === "42501", JSON.stringify(res.body));
  await teacherPage.goto(`${APP}/admin/presentations/submissions/${mainId}`);
  check("a teacher gets Page not found on the admin submission page", await seen(notFound(teacherPage)));
  // The page sends them home once it starts loading (a redirect inside a streamed page), so wait for it.
  await teacherPage.goto(`${APP}/reviews-submissions`);
  const wentHome = await teacherPage.waitForURL((u) => u.pathname === "/", { timeout: 30_000 }).then(() => true, () => false);
  check("a teacher has no Reviews & submissions page (sent home)", wentHome, teacherPage.url());

  // ── 5. A plain admin sends it back ───────────────────────────────────────────────────────────────────────────
  const plainPage = await newPage(plainAdmin);
  await plainPage.goto(`${APP}/admin/presentations/submissions`, { timeout: 120_000 });
  const row = plainPage.getByRole("link", { name: new RegExp(TITLE) });
  check("the admin list shows it", await seen(row));
  check("the row names the editor's email", (await row.innerText()).includes(editor.email), await row.innerText());
  await row.click();
  check("its page opens with the title", await seen(plainPage.getByRole("heading", { name: TITLE })));
  check("its page says Submitted by", await seen(plainPage.getByText("Submitted by")));
  await plainPage.getByRole("button", { name: "Send back" }).click();
  const form = plainPage.locator("form").filter({ hasText: "What should they change?" });
  await form.waitFor();
  check("Send back is off while the note is empty", await form.getByRole("button", { name: "Send back" }).isDisabled());
  const NOTE = "Slide 3 needs an answer key.";
  await form.locator("textarea").fill(NOTE);
  await form.getByRole("button", { name: "Send back" }).click();
  check("a toast says it was sent back", await seen(toast(plainPage, "Sent back to the editor.")));
  await plainPage.waitForURL(/\/admin\/presentations\/submissions$/);
  check(
    "it left the admin list",
    (await plainPage.getByRole("link", { name: new RegExp(TITLE) }).count()) === 0,
  );
  check("the database has it sent back with the note", submissionOf(mainId) === `sent_back|${NOTE}|`);

  // ── 6. The editor sees the note, fixes it and submits again ──────────────────────────────────────────────────
  await editorPage.goto(`${APP}/reviews-submissions`, { timeout: 120_000 });
  const myRow = editorPage.locator("tr").filter({ hasText: TITLE });
  check("Reviews & submissions lists it", await seen(myRow));
  check("…as Sent back", await seen(myRow.getByText("Sent back")));
  check("…with the admin's note", await seen(myRow.getByText(NOTE)));
  res = await patchPresentation(editor, mainId, { description: "Now with an answer key." });
  check("after send back it can be changed again", res.ok, JSON.stringify(res.body));
  await openHome(editorPage);
  check("the card says Sent back", await seen(cardOf(editorPage, TITLE).getByText("Sent back")));
  items = await menuItems(editorPage, TITLE);
  check("the menu has Edit again", items.includes("Edit"), items.join(", "));
  check("the menu says Submit again", items.includes("Submit again"), items.join(", "));
  await editorPage.getByRole("button", { name: "Submit again" }).click();
  await editorPage.getByRole("button", { name: "Submit", exact: true }).click();
  check("a toast says it was sent again", await seen(toast(editorPage, "Sent to QuizMatter.")));
  check("the database has it submitted again, the old note cleared", submissionOf(mainId) === "submitted||");

  // ── 7. The super admin approves it ───────────────────────────────────────────────────────────────────────────
  const superPage = await newPage(superAdmin);
  await superPage.goto(`${APP}/admin/presentations/submissions/${mainId}`, { timeout: 120_000 });
  await superPage.getByRole("button", { name: "Approve" }).click();
  check("the confirm box asks first", await seen(superPage.getByText("Approve this presentation?")));
  await superPage.getByRole("button", { name: "Approve" }).last().click();
  check("a toast says it was approved", await seen(toast(superPage, "Approved.")));
  await superPage.waitForURL(/\/admin\/presentations\/submissions$/);

  const [status, , copyId] = submissionOf(mainId).split("|");
  check("the database has it approved, with its copy", status === "approved" && copyId !== "", submissionOf(mainId));
  const copy = psql(`select owner_id || '|' || from_admin || '|' || is_published || '|' || author || '|' ||
                            coalesce(author_id::text, '') || '|' || title || '|' || description
                     from public.presentations where id = '${copyId}'`).split("|");
  const author = psql(`select public.editor_author('${editor.id}')`);
  check("the copy is owned by the approving admin", copy[0] === superAdmin.id, copy[0]);
  check("the copy is from QuizMatter and shared", copy[1] === "true" && copy[2] === "true", `${copy[1]} ${copy[2]}`);
  check("the copy's Author is the editor", copy[3] === author && copy[4] === editor.id, `${copy[3]} ${copy[4]}`);
  check("the copy has the fixed title and description", copy[5] === TITLE && copy[6] === "Now with an answer key.");
  check(
    "the copy has the same 3 slides",
    psql(`select count(*) from public.slides where presentation_id = '${copyId}'`) === "3",
  );
  check(
    "the editor keeps their original",
    psql(`select owner_id || '|' || from_admin from public.presentations where id = '${mainId}'`) === `${editor.id}|false`,
  );
  // Page not found, but status 200: loading.tsx was already sent before the page knew (Next can't change it then).
  await superPage.goto(`${APP}/admin/presentations/submissions/${mainId}`);
  check("a decided one's admin page says Page not found", await seen(notFound(superPage)));
  check("…with no Approve button", (await superPage.getByRole("button", { name: "Approve" }).count()) === 0);

  // ── 8. After approval ────────────────────────────────────────────────────────────────────────────────────────
  await editorPage.goto(`${APP}/reviews-submissions`, { timeout: 120_000 });
  const approvedRow = editorPage.locator("tr").filter({ hasText: TITLE });
  check("Reviews & submissions says In QuizMatter", await seen(approvedRow.getByText("In QuizMatter")));
  const link = approvedRow.getByRole("link", { name: "See it in QuizMatter" });
  check("…with a link to QuizMatter's copy", (await link.getAttribute("href")) === `/presentation/${copyId}`);
  await editorPage.screenshot({ path: `${SHOTS}submissions-approved.png`, fullPage: true });
  await openHome(editorPage);
  check("the card says In QuizMatter", await seen(cardOf(editorPage, TITLE).getByText("In QuizMatter")));
  items = await menuItems(editorPage, TITLE);
  check("an approved one has no Submit", !items.some((i) => i.startsWith("Submit")), items.join(", "));
  check("an approved one has Edit and Delete", items.includes("Edit") && items.includes("Delete"), items.join(", "));
  await closeMenu(editorPage);
  res = await rpc(editor, "submit_presentation", { target_id: mainId });
  check("submitting an approved one is refused (QMSUB)", res.body?.code === "QMSUB", JSON.stringify(res.body));
  res = await patchPresentation(editor, mainId, { description: "Changed after approval." });
  check("the original is unlocked after approval", res.ok, JSON.stringify(res.body));
  check(
    "changing the original doesn't change QuizMatter's copy",
    psql(`select description from public.presentations where id = '${copyId}'`) === "Now with an answer key.",
  );
  await teacherPage.goto(`${APP}/presentation/${copyId}`, { timeout: 120_000 });
  check("a plain teacher can open QuizMatter's copy", await seen(teacherPage.getByText(TITLE)));

  // The editor deletes their original: the approved receipt and QuizMatter's copy stay.
  await openHome(editorPage);
  await menuItems(editorPage, TITLE);
  await editorPage.getByRole("button", { name: "Delete" }).click();
  await editorPage.getByRole("button", { name: "Delete", exact: true }).last().click();
  check("the original is deleted", await seen(toast(editorPage, "Presentation deleted.")));
  await editorPage.goto(`${APP}/reviews-submissions`, { timeout: 120_000 });
  const receipt = editorPage.locator("tr").filter({ hasText: TITLE });
  check("the receipt stays, marked (original deleted)", await seen(receipt.getByText("(original deleted)")));
  check("…still In QuizMatter, with its link", await seen(receipt.getByRole("link", { name: "See it in QuizMatter" })));
  check("QuizMatter's copy is still there", psql(`select count(*) from public.presentations where id = '${copyId}'`) === "1");

  // ── 9. Hidden while it waits: Approve is refused ─────────────────────────────────────────────────────────────
  res = await rpc(editor, "submit_presentation", { target_id: hiddenId });
  check("another one is submitted", res.ok, JSON.stringify(res.body));
  // Only an admin may hide (check_hidden_change), so the super admin hides it, as Admin → Reports does.
  res = await patchPresentation(superAdmin, hiddenId, { hidden_at: new Date().toISOString() });
  check("the super admin hides it while it waits", res.ok, JSON.stringify(res.body));
  await superPage.goto(`${APP}/admin/presentations/submissions/${hiddenId}`, { timeout: 120_000 });
  await superPage.getByRole("button", { name: "Approve" }).click();
  await superPage.getByRole("button", { name: "Approve" }).last().click();
  check("approving a hidden one says why", await seen(toast(superPage, "This presentation is hidden")));
  check("it stays waiting", submissionOf(hiddenId) === "submitted||");
  check(
    "no copy was made",
    psql(`select count(*) from public.presentations where title = '${HIDDEN}' and from_admin`) === "0",
  );

  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
  // QuizMatter's copy and the approved receipt stay after their people are deleted, so they go first.
  psql(`
    delete from public.presentations where title like '% e2e ${tag}' and from_admin;
    delete from public.presentation_submissions where submitter_id = '${editor.id}';
  `);
  for (const person of [editor, teacher, plainAdmin, superAdmin]) await deleteTeacher(person);
}
finish();
