// The home search: the options open as a modal and the search bar hides meanwhile; the title search's rules.
import { chromium } from "playwright";
import { APP, SHOTS, check, deleteTeacher, finish, loggedIn, makeTeacher, psql } from "./lib.mjs";

const teacher = await makeTeacher({ first: "Sam", last: "Search" });
const browser = await chromium.launch();
try {
  const context = await loggedIn(browser, teacher);
  const page = await context.newPage();
  // React's warnings (e.g. a form inside a form) and page errors.
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  await page.goto(`${APP}/`);
  const bar = page.getByPlaceholder("Search by title (2 or more words)");
  const options = page.getByRole("button", { name: "Search options" });
  const dialog = page.getByRole("dialog", { name: "Search options" });

  check("the bar shows with its title placeholder", await bar.isVisible());

  // Opens as a modal; the bar hides.
  await options.click();
  await dialog.waitFor();
  check("the options open as a modal", await dialog.isVisible());
  check("the search bar hides while it's open", !(await bar.isVisible()));
  check("the modal has no Title row", (await dialog.locator("label span", { hasText: /^Title$/ }).count()) === 0);
  await page.screenshot({ path: `${SHOTS}search-options-modal.png` });

  // Escape and ✕ close it; the bar comes back.
  await page.keyboard.press("Escape");
  check("Escape closes it", await dialog.isHidden());
  check("the bar shows again", await bar.isVisible());
  await options.click();
  await dialog.getByRole("button", { name: "Close" }).click();
  check("✕ closes it", await dialog.isHidden());

  // One word is refused from the bar and from the modal.
  await bar.fill("exam");
  await bar.press("Enter");
  await page.getByText("Type at least two words").waitFor();
  check("one word in the bar is refused with words", page.url() === `${APP}/`);

  // The bar's own search uses the title.
  await bar.fill("grade 4");
  await bar.press("Enter");
  await page.waitForURL((u) => u.searchParams.get("title") === "grade 4");
  const heading = page.getByRole("heading", { name: "Results for “grade 4”" });
  check("the bar searches by title, named in the heading", await heading.waitFor({ timeout: 15_000 }).then(() => true, () => false));

  // Enter in a modal field searches with the options only: the title is emptied.
  await options.click();
  await dialog.locator("label", { hasText: "Grade" }).locator("select").selectOption("Grade 4");
  await dialog.locator("label", { hasText: "Author" }).locator("input").press("Enter");
  await page.waitForURL((u) => u.searchParams.get("grade") === "Grade 4");
  const url = new URL(page.url());
  check("Enter in the modal searches without the title", !url.searchParams.has("title"), url.search);
  check("the modal closes after searching", await dialog.isHidden());
  check("the bar's title is emptied", (await bar.inputValue()) === "");

  // The footer's Search does the same, and one word in the bar isn't refused (it isn't searched).
  await bar.fill("exam");
  await options.click();
  await dialog.locator("label", { hasText: "Grade" }).locator("select").selectOption("Grade 5");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await page.waitForURL((u) => u.searchParams.get("grade") === "Grade 5");
  check("the footer's Search searches without the title", !new URL(page.url()).searchParams.has("title"), page.url());
  check("…and empties the bar", (await bar.inputValue()) === "");

  // The bar's ✕ leaves the search (every option too) and goes home: no other list shows.
  await bar.fill("math exam");
  await bar.press("Enter");
  await page.waitForURL((u) => u.searchParams.get("title") === "math exam");
  await page.getByRole("button", { name: "Clear search text" }).click();
  await page.waitForURL(`${APP}/`);
  check("the bar's ✕ goes home with no search", page.url() === `${APP}/` && (await bar.inputValue()) === "");
  await options.click();
  check("…and the options are cleared too", (await dialog.locator("label", { hasText: "Grade" }).locator("select").inputValue()) === "");
  await page.keyboard.press("Escape");

  // Phone width: the modal fits with no sideways scroll.
  await page.setViewportSize({ width: 390, height: 800 });
  await options.click();
  await dialog.waitFor();
  const box = await dialog.boundingBox();
  check("on a phone the modal fits the screen", box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));
  await page.screenshot({ path: `${SHOTS}search-options-modal-phone.png` });
  check("no errors or React warnings in the console", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

  // Admin → Photos shares the box: its modal keeps the box's text (its first row is that same text).
  const admin = await makeTeacher({ first: "Ada", last: "Admin", superAdmin: true });
  // The search box shows only when there is a photo: one row, no file (the page only lists it).
  const photoSrc = `https://images.quizmatter.com/uploads/e2e-search-${Date.now()}.webp`;
  psql(`insert into public.shared_photos (src, width, height, category_id, file_name, uploaded_by)
        select '${photoSrc}', 10, 10, id, 'e2e search photo', '${admin.id}' from public.photo_categories limit 1`);
  try {
    const adminPage = await (await loggedIn(browser, admin)).newPage();
    await adminPage.goto(`${APP}/admin/photos`);
    const photoBar = adminPage.getByPlaceholder("Search photos");
    await photoBar.fill("cat");
    await adminPage.getByRole("button", { name: "Search options" }).click();
    const photoDialog = adminPage.getByRole("dialog", { name: "Search options" });
    const words = photoDialog.locator("label", { hasText: "Includes the words" }).locator("input");
    check("Admin → Photos: the modal shows the box's text", (await words.inputValue()) === "cat");
    await words.fill("dog");
    await photoDialog.locator("label", { hasText: "File name" }).locator("input").press("Enter");
    await adminPage.waitForURL((u) => u.searchParams.has("q"));
    check("Admin → Photos: Enter in the modal searches its text", new URL(adminPage.url()).searchParams.get("q") === "dog", adminPage.url());
    check("Admin → Photos: the box keeps it", (await photoBar.inputValue()) === "dog");
  } finally {
    psql(`delete from public.shared_photos where src = '${photoSrc}'`);
    await deleteTeacher(admin);
  }
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}
finish();
