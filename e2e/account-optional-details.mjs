// Account → Personal details: contact number, birthday, gender and educational background are optional
// (docs/superpowers/specs/2026-11-21-shorter-sign-up-design.md). A new teacher (names only, like sign up makes) can
// save with them empty, fill them in, and clear them again; a filled one still follows the rules.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { APP, check, deleteTeacher, finish, loggedIn, makeTeacher, psql, SHOTS } from "./lib.mjs";

const browser = await chromium.launch();
const teacher = await makeTeacher({ first: "Optional" });
const saved = () =>
  psql(
    `select contact_number || '|' || coalesce(birth_date::text, '') || '|' || gender || '|' || education_level || '|' || education_field
     from public.user_settings where user_id = '${teacher.id}'`,
  );
// The consent record for the sensitive details: "<version>|<has a time>".
const consent = () =>
  psql(
    `select coalesce(details_consent_version, '') || '|' || (details_consent_at is not null)
     from public.user_settings where user_id = '${teacher.id}'`,
  );
const LEGAL_VERSION = readFileSync("src/lib/legal.ts", "utf8").match(/LEGAL_VERSION = "([^"]+)"/)[1];
/** True once `text` shows on the page (React may still be drawing it right after a click). */
const shows = (page, text) => page.getByText(text).waitFor({ timeout: 5000 }).then(() => true, () => false);
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
  check("no details, no consent record", consent() === "|false", consent());

  await open();
  await page.locator("#contactNumber").fill("12");
  await page.getByRole("button", { name: "Save details" }).click();
  check("a too-short contact number is still refused", await shows(page, "Enter a contact number with at least 7 digits."));
  await page.locator("#contactNumber").fill("09171234567");
  await page.locator("#birthDate").fill("1990-05-05");
  await page.locator("#gender").selectOption("female");
  await page.locator("#educationLevel").selectOption("bachelor");
  await page.locator("#educationField").fill("Math");
  check("filling them in saves", await saveDetails());
  check("they're saved", saved() === "09171234567|1990-05-05|female|bachelor|Math", saved());
  check("saving them keeps the consent version and time", consent() === `${LEGAL_VERSION}|true`, consent());

  // A half-typed birthday (the day erased) must not quietly remove the saved one.
  await open();
  await page.locator("#birthDate").click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Backspace");
  check("the box knows it's half-typed", await page.locator("#birthDate").evaluate((box) => box.validity.badInput));
  // Chrome's own form check stops the save first (badInput is invalid); the page's check is for browsers that don't.
  await page.getByRole("button", { name: "Save details" }).click();
  check("a half-typed birthday doesn't save", !(await shows(page, "Details saved.")));
  check("the saved birthday stays", saved().split("|")[1] === "1990-05-05", saved());

  await open();
  await page.locator("#contactNumber").fill("");
  await page.locator("#birthDate").fill("");
  await page.locator("#gender").selectOption("");
  await page.locator("#educationLevel").selectOption("");
  await page.locator("#educationField").fill("");
  check("clearing them saves", await saveDetails());
  check("they're empty again", saved() === "||||", saved());
  check("clearing them clears the consent record", consent() === "|false", consent());
  await page.screenshot({ path: `${SHOTS}account-optional-details.png`, fullPage: true });
  await context.close();
} finally {
  await deleteTeacher(teacher);
  await browser.close();
}
finish();
