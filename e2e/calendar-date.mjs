// Calendar dates: add a Calendar Page and a Month Calendar (both start on today), Set date, save, reload.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher } from "./lib.mjs";

// A teacher and a presentation with one question slide.
const teacher = await makeTeacher({ first: "Calendar" });
const presentationId = randomUUID();
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "Calendar e2e", data_version: 1 }),
});
await api("/rest/v1/slides", {
  method: "POST",
  body: JSON.stringify([
    {
      presentation_id: presentationId,
      id: "s1",
      position: 0,
      data: {
        id: "s1",
        type: "choice",
        question: "What day is it?",
        layout: "grid",
        options: ["a", "b", "c", "d"].map((o) => ({ id: `s1-${o}`, text: o.toUpperCase() })),
        correctOptionId: null,
        elements: [],
        questionHeight: 100,
      },
    },
  ]),
});

/** The saved elements of the slide, straight from the local database. */
async function savedElements() {
  const rows = await api(`/rest/v1/slides?presentation_id=eq.${presentationId}&id=eq.s1&select=data`);
  return rows[0]?.data?.elements ?? [];
}
async function waitForSaved(test) {
  for (let i = 0; i < 40; i++) {
    if (test(await savedElements())) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
const dateOf = (elements, assetId) => elements.find((el) => el.assetId === assetId)?.calendarDate;
const sameDate = (a, b) => !!a && a.year === b.year && a.month === b.month && a.day === b.day;

const browser = await chromium.launch();
const page = await (await loggedIn(browser, teacher, { width: 1600, height: 1000 })).newPage();
page.setDefaultTimeout(60_000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

try {
  await page.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  const slide = page.locator('[data-slide-id="s1"]');
  await slide.waitFor();
  // Today on the browser's computer, as the store gives a new calendar.
  const today = await page.evaluate(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  });

  // Add both calendars from Elements → Time & Date.
  await page.locator('button[title="Elements"]').click();
  for (const label of ["Calendar Page", "Month Calendar"]) {
    const tile = page.locator(`button[title="${label}"]`);
    await page.getByText("Time & Date", { exact: true }).first().scrollIntoViewIfNeeded();
    await tile.waitFor();
    await tile.click();
  }
  const month = new Date(Date.UTC(today.year, today.month - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" }).toUpperCase();
  const slideText = (text) => slide.locator("svg text").filter({ hasText: new RegExp(`^${text}$`) });
  check("the calendar page shows this month", (await slideText(month).count()) === 1);
  check("the month calendar shows this month and year", (await slideText(`${month} ${today.year}`).count()) === 1);

  // The Month Calendar was added last, so it's picked: its toolbar has Set date.
  await page.locator('button[title="Set date"]').click();
  const dateBox = page.locator('input[type="date"][aria-label="Date"]');
  await dateBox.waitFor();
  const todayText = `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;
  check("Set date opens on today", (await dateBox.inputValue()) === todayText, await dateBox.inputValue());

  await page.keyboard.press("Control+s");
  check(
    "saved: both calendars start on today",
    await waitForSaved((els) => sameDate(dateOf(els, "calendar-page"), today) && sameDate(dateOf(els, "month-calendar"), today)),
  );

  // Pick 29 February 2024 on the Month Calendar.
  await dateBox.fill("2024-02-29");
  await page.getByText("Thursday, February 29, 2024", { exact: true }).waitFor();
  check('the panel says "Thursday, February 29, 2024"', true);
  check("the month calendar shows FEBRUARY 2024", (await slide.locator("svg text", { hasText: "FEBRUARY 2024" }).count()) === 1);
  await page.screenshot({ path: SHOTS + "calendar-date.png" });

  // Today puts it back.
  await page.getByRole("button", { name: "Today", exact: true }).click();
  check("Today puts the date box back on today", (await dateBox.inputValue()) === todayText);
  await dateBox.fill("2024-02-29");

  await page.keyboard.press("Control+s");
  check(
    "saved: the month calendar has 29 February 2024, the page still today",
    await waitForSaved(
      (els) => sameDate(dateOf(els, "month-calendar"), { year: 2024, month: 2, day: 29 }) && sameDate(dateOf(els, "calendar-page"), today),
    ),
  );

  // Reload: the slide still shows it.
  await page.reload();
  await slide.waitFor();
  await slide.locator("svg text", { hasText: "FEBRUARY 2024" }).first().waitFor();
  check("after reload: the month calendar still shows FEBRUARY 2024", true);

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (error) {
  check("run finished without an exception", false, String(error).split("\n").slice(0, 4).join(" "));
  await page.screenshot({ path: SHOTS + "calendar-date-failure.png" });
} finally {
  await browser.close();
  await deleteTeacher(teacher);
}

finish();
