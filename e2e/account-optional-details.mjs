// Account → Personal details: contact number, birthday, gender and educational background are optional
// (docs/superpowers/specs/2026-11-21-shorter-sign-up-design.md). A new teacher (names only, like sign up makes) can
// save with them empty, fill them in, and clear them again; a filled one still follows the rules.
import { chromium } from "playwright";
import { APP, check, deleteTeacher, finish, loggedIn, makeTeacher, psql, SHOTS } from "./lib.mjs";

const browser = await chromium.launch();
const teacher = await makeTeacher({ first: "Optional" });
const saved = () =>
  psql(
    `select contact_number || '|' || coalesce(birth_date::text, '') || '|' || gender || '|' || education_level || '|' || education_field
     from public.user_settings where user_id = '${teacher.id}'`,
  );
try {
  const context = await loggedIn(browser, teacher);
  const page = await context.newPage();
  const open = async () => {
    await page.goto(`${APP}/account`);
    await page.locator("#bio").waitFor();
  };
  const saveDetails = async () => {
    await page.getByRole("button", { name: "Save details" }).click();
    return page.getByText("Details saved.").waitFor({ timeout: 10000 }).then(() => true, () => false);
  };

  await open();
  check("the new teacher's details start empty", saved() === "||||", saved());
  check("the optional boxes aren't required", (await page.locator("#contactNumber[required], #birthDate[required], #gender[required], #educationLevel[required], #educationField[required]").count()) === 0);

  await page.locator("#bio").fill("I teach math.");
  check("saving with them empty works", await saveDetails());
  check("they stay empty (birthday saved as none)", saved() === "||||", saved());

  await open();
  await page.locator("#contactNumber").fill("12");
  await page.getByRole("button", { name: "Save details" }).click();
  check("a too-short contact number is still refused", await page.getByText("Enter a contact number with at least 7 digits.").isVisible());
  await page.locator("#contactNumber").fill("09171234567");
  await page.locator("#birthDate").fill("1990-05-05");
  await page.locator("#gender").selectOption("female");
  await page.locator("#educationLevel").selectOption("bachelor");
  await page.locator("#educationField").fill("Math");
  check("filling them in saves", await saveDetails());
  check("they're saved", saved() === "09171234567|1990-05-05|female|bachelor|Math", saved());

  await open();
  await page.locator("#contactNumber").fill("");
  await page.locator("#birthDate").fill("");
  await page.locator("#gender").selectOption("");
  await page.locator("#educationLevel").selectOption("");
  await page.locator("#educationField").fill("");
  check("clearing them saves", await saveDetails());
  check("they're empty again", saved() === "||||", saved());
  await page.screenshot({ path: `${SHOTS}account-optional-details.png`, fullPage: true });
  await context.close();
} finally {
  await deleteTeacher(teacher);
  await browser.close();
}
finish();
