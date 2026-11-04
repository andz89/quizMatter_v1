// Admin → Reports as a plain admin: a teacher's reported shared copy has Hide and Delete; a reported QuizMatter
// lesson has neither (only the super admin may, see the moderation_fixes migration) and says so.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, check, deleteTeacher, finish, loggedIn, makeTeacher, psql } from "./lib.mjs";

const admin = await makeTeacher({ first: "Plainadmin" });
psql(`insert into public.admins (user_id, is_super) values ('${admin.id}', false)`);
const teacher = await makeTeacher({ first: "Reported" });
const reporter = await makeTeacher({ first: "Reporter" });
const superAdmin = await makeTeacher({ first: "Superowner", superAdmin: true });
const lessonId = randomUUID();
const copyId = randomUUID();
const originalId = randomUUID();
const tag = Date.now();
psql(`
  insert into public.presentations (id, owner_id, title, from_admin, is_published) values
    ('${lessonId}', '${superAdmin.id}', 'Lesson ${tag}', true, true);
  insert into public.presentations (id, owner_id, title) values ('${originalId}', '${teacher.id}', 'Copy ${tag}');
  select set_config('quizmatter.sharing', 'yes', false);
  insert into public.presentations (id, owner_id, title, shared_from, is_published, shared_at)
    values ('${copyId}', '${teacher.id}', 'Copy ${tag}', '${originalId}', true, now());
  insert into public.presentation_reports (presentation_id, reporter_id, reason) values
    ('${lessonId}', '${reporter.id}', 'spam'), ('${copyId}', '${reporter.id}', 'spam');
`);

const browser = await chromium.launch();
try {
  const page = await (await loggedIn(browser, admin, { width: 1400, height: 1000 })).newPage();
  page.setDefaultTimeout(60_000);
  await page.goto(`${APP}/admin/reports`);
  const rowOf = (title) => page.locator("div.rounded-card", { has: page.getByRole("link", { name: title }) });

  const lesson = rowOf(`Lesson ${tag}`);
  await lesson.waitFor();
  check("the lesson row has no Hide", (await lesson.getByRole("button", { name: "Hide" }).count()) === 0);
  check("the lesson row has no Delete", (await lesson.getByRole("button", { name: /^Delete/ }).count()) === 0);
  check("the lesson row says why", (await lesson.getByText("Only the super admin can hide or delete this one.").count()) === 1);

  const copy = rowOf(`Copy ${tag}`);
  check("the teacher's copy has Hide", (await copy.getByRole("button", { name: "Hide" }).count()) === 1);
  check("the teacher's copy has Delete", (await copy.getByRole("button", { name: /^Delete/ }).count()) === 1);
  await page.screenshot({ path: `${SHOTS}reports-plain-admin.png`, fullPage: true });
} finally {
  await browser.close();
  psql(`delete from public.presentations where id in ('${lessonId}', '${copyId}', '${originalId}')`);
  await deleteTeacher(admin);
  await deleteTeacher(teacher);
  await deleteTeacher(reporter);
  await deleteTeacher(superAdmin);
}
finish();
