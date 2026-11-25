// Admin → Presentations reads only the rows it shows: 10 at first, "Show more" adds 10; search and sort live in
// the page link (?q=…&sort=newest&shown=20) and run in the database. Run: npm run e2e:dev, then
// node e2e/admin-presentations-paging.mjs
import { chromium } from "playwright";
import { APP, SHOTS, check, deleteTeacher, finish, loggedIn, makeTeacher, psql } from "./lib.mjs";

const admin = await makeTeacher({ first: "Paging", last: "Admin", superAdmin: true });
const browser = await chromium.launch();
try {
  // 23 QuizMatter presentations, each made a day apart (lesson 23 is the newest), one about Astronomy.
  const rows = Array.from({ length: 23 }, (_, i) => {
    const n = String(i + 1).padStart(2, "0");
    const subject = i === 4 ? "Astronomy" : "Science";
    return `('${crypto.randomUUID()}', '${admin.id}', 'Paged lesson ${n}', '${subject}', true, now() - interval '${23 - i} days')`;
  });
  psql(`insert into public.presentations (id, owner_id, title, subject, from_admin, created_at) values ${rows.join(", ")};`);

  const context = await loggedIn(browser, admin);
  const page = await context.newPage();
  const titles = () => page.locator('a[target="_blank"][href^="/presentation/"]').allTextContents();

  await page.goto(`${APP}/admin/presentations`);
  check("first load shows 10 rows", (await titles()).length === 10, String((await titles()).length));
  check("says Showing 10 of 23", await page.getByText("Showing 10 of 23").isVisible());

  await page.getByRole("link", { name: "Show more" }).click();
  await page.waitForURL(/shown=20/);
  await page.getByText("Showing 20 of 23").waitFor();
  check("Show more adds 10 (20 rows)", (await titles()).length === 20, String((await titles()).length));

  await page.getByRole("link", { name: "Show more" }).click();
  await page.waitForURL(/shown=30/);
  await page.getByRole("link", { name: "Show more" }).waitFor({ state: "detached" });
  check("all 23 show and the button is gone", (await titles()).length === 23, String((await titles()).length));

  await page.getByLabel("Search presentations").fill("astronomy");
  await page.getByLabel("Search presentations").press("Enter");
  await page.waitForURL(/q=astronomy/);
  await page.waitForFunction(() => document.querySelectorAll('a[target="_blank"][href^="/presentation/"]').length === 1);
  const found = await titles();
  check("search runs in the database (subject)", found.length === 1 && found[0] === "Paged lesson 05", found.join(", "));
  check("a new search drops the count", !page.url().includes("shown="), page.url());

  await page.getByLabel("Search presentations").fill("");
  await page.getByLabel("Search presentations").press("Enter");
  // An empty search sends ?q= (read as no search).
  await page.waitForURL((url) => !url.search.includes("q=astronomy"));
  await page.getByText("Showing 10 of 23").waitFor();
  await page.getByRole("link", { name: "Newest" }).click();
  await page.waitForURL(/sort=newest/);
  await page.getByText("Showing 10 of 23").waitFor();
  const newest = await titles();
  check("Newest puts the newest made first", newest[0] === "Paged lesson 23" && newest[9] === "Paged lesson 14", newest.join(", "));
  await page.screenshot({ path: `${SHOTS}admin-presentations-paging.png`, fullPage: true });

  await page.goto(`${APP}/admin/presentations?shown=15`);
  check("an odd count in the link falls back to 10", (await titles()).length === 10, String((await titles()).length));
  await context.close();
} finally {
  await browser.close();
  await deleteTeacher(admin);
}
finish();
