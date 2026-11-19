// Admin → Admins: the super admin sees every admin (Super admin / Admin, Two-step on / not set up) and the menu item;
// a plain admin gets neither (the page is "page not found").
import { chromium } from "playwright";
import { APP, SHOTS, check, deleteTeacher, finish, loggedIn, makeTeacher, psql } from "./lib.mjs";

const superAdmin = await makeTeacher({ first: "Listsuper", superAdmin: true });
const plain = await makeTeacher({ first: "Listplain", admin: true });
// An admin who hasn't set up the authenticator app yet.
const noApp = await makeTeacher({ first: "Listnoapp" });
psql(`insert into public.admins (user_id) values ('${noApp.id}')`);

const browser = await chromium.launch();
try {
  const page = await (await loggedIn(browser, superAdmin, { width: 1400, height: 1000 })).newPage();
  page.setDefaultTimeout(60_000);
  await page.goto(`${APP}/admin/admins`);
  const rowOf = (email) => page.locator("div.rounded-card", { hasText: email });

  await rowOf(superAdmin.email).waitFor();
  check("the menu has Admins", (await page.getByRole("link", { name: "Admins", exact: true }).count()) === 1);
  check("super admin row says Super admin", (await rowOf(superAdmin.email).getByText("Super admin").count()) === 1);
  check("super admin row says Two-step on", (await rowOf(superAdmin.email).getByText("Two-step on").count()) === 1);
  check("plain admin row says Admin", (await rowOf(plain.email).getByText("Admin", { exact: true }).count()) === 1);
  check("plain admin row says Two-step on", (await rowOf(plain.email).getByText("Two-step on").count()) === 1);
  check("no-app row says not set up", (await rowOf(noApp.email).getByText("Two-step not set up").count()) === 1);
  check("rows show Joined", (await rowOf(noApp.email).getByText(/Joined/).count()) === 1);
  await page.screenshot({ path: `${SHOTS}admin-list.png`, fullPage: true });

  const plainPage = await (await loggedIn(browser, plain, { width: 1400, height: 1000 })).newPage();
  plainPage.setDefaultTimeout(60_000);
  await plainPage.goto(`${APP}/admin/admins`);
  await plainPage.getByText(/page not found/i).first().waitFor();
  check("plain admin gets page not found", true);
  await plainPage.goto(`${APP}/admin`);
  await plainPage.getByRole("link", { name: "Editors", exact: true }).waitFor();
  check("plain admin's menu has no Admins", (await plainPage.getByRole("link", { name: "Admins", exact: true }).count()) === 0);
} finally {
  await browser.close();
  await deleteTeacher(superAdmin);
  await deleteTeacher(plain);
  await deleteTeacher(noApp);
}
finish();
