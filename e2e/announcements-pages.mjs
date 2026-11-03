// Announcements on teachers' pages, put straight in the table: corner boxes (text, YouTube, Facebook) at desktop
// and phone width, the HTML top bar (sealed, floating on the editor page), and an HTML modal loading outside files.
// Deletes every announcement in the local database first.
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { APP, SHOTS, api, check, deleteTeacher, finish, loggedIn, makeTeacher, psql, round } from "./lib.mjs";

const teacher = await makeTeacher();
const presentationId = randomUUID();
await api("/rest/v1/presentations", {
  method: "POST",
  body: JSON.stringify({ id: presentationId, owner_id: teacher.id, title: "Editor test", data_version: 1 }),
});
psql(`
delete from public.announcement_dismissals;
delete from public.announcements;
insert into public.announcements
  (name, is_on, show_modal, modal_text, modal_attachment, modal_close_after, show_bar, bar_html, bar_close_after,
   repeat, pages, modal_size, modal_format, modal_html, modal_height, bar_format, bar_height, modal_display, modal_auto_close)
values
  ('A corner text', true, true, 'Corner box text for the home page, phone and editor.', null, 0, false, '', 0,
   'every_visit', '{my_presentations,editor}', 'small', 'post', '', 400, 'text', 60, 'corner', 0),
  ('B html bar', true, false, '', null, 0, true,
   '<div style="height:100%;display:flex;align-items:center;padding:0 12px;background:#ffc233;font:15px sans-serif">HTML top bar</div>',
   0, 'every_visit', '{editor,account}', 'large', 'post', '', 400, 'html', 50, 'center', 0),
  ('C corner youtube', true, true, 'A video for you.',
   '{"kind":"youtube","video_id":"dQw4w9WgXcQ","title":"Test video","src":"https://images.quizmatter.com/uploads/test-thumb.webp"}',
   0, false, '', 0, 'every_visit', '{saved}', 'medium', 'post', '', 400, 'text', 60, 'corner', 0),
  ('D corner facebook', true, true, 'A post for you.',
   '{"kind":"facebook","href":"https://www.facebook.com/facebook/posts/10153231379946729","video":false}',
   0, false, '', 0, 'every_visit', '{liked}', 'small', 'post', '', 400, 'text', 60, 'corner', 0),
  ('E html outside', true, true, '', null, 0, false, '', 0, 'every_visit', '{search}', 'large', 'html',
   '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Pacifico&display=swap"><div style="padding:16px"><p id="t" style="font-family:Pacifico;font-size:28px;margin:0">Outside font</p><img id="pic" src="https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png" width="200"></div>',
   320, 'text', 60, 'center', 0);
`);

const browser = await chromium.launch();
const desktop = { width: 1366, height: 800 };
const teacherPage = async (viewport = desktop) => (await loggedIn(browser, teacher, viewport)).newPage();
try {
  // 1. The teacher's home page loads, with the corner box.
  let p = await teacherPage();
  await p.goto(`${APP}/`, { timeout: 120_000 });
  const box = p.getByRole("region", { name: "Announcement" });
  await box.waitFor({ timeout: 60_000 });
  check("home: the page loads (no 'Something went wrong')", !(await p.getByText("Something went wrong").isVisible()));
  check("home: the corner box shows", await box.getByText("Corner box text for the home page").isVisible());

  // 2. Phone width: a Small box stays at the bottom-right; a Medium one spans the width less 16 px a side.
  p = await teacherPage({ width: 390, height: 844 });
  await p.goto(`${APP}/`);
  const phoneBox = p.getByRole("region", { name: "Announcement" });
  await phoneBox.waitFor({ timeout: 60_000 });
  const pb = await phoneBox.boundingBox();
  check(
    "phone: a Small box (300) fits, so it stays at the bottom-right",
    Math.round(pb.width) === 300 && Math.abs(390 - 16 - (pb.x + pb.width)) <= 1 && Math.abs(844 - 16 - (pb.y + pb.height)) <= 1,
    round(pb),
  );
  await p.goto(`${APP}/saved`);
  const phoneMedium = p.getByRole("region", { name: "Announcement" });
  await phoneMedium.waitFor({ timeout: 60_000 });
  const pm = await phoneMedium.boundingBox();
  check(
    "phone: a Medium box (500) spans the width less 16 px a side",
    Math.abs(pm.x - 16) <= 1 && Math.abs(pm.width - 358) <= 1 && Math.abs(844 - 16 - (pm.y + pm.height)) <= 1,
    round(pm),
  );
  await p.screenshot({ path: SHOTS + "announcements-pages-phone.png" });

  // 3. Editor page: the floating HTML bar and the corner box together.
  p = await teacherPage();
  await p.goto(`${APP}/presentation/${presentationId}/edit`, { timeout: 120_000 });
  const editorBox = p.getByRole("region", { name: "Announcement" });
  await editorBox.waitFor({ timeout: 60_000 });
  const barFrame = p.locator('iframe[title="Announcement"]').first();
  await barFrame.waitFor({ timeout: 30_000 });
  const eb = await editorBox.boundingBox();
  const bb = await barFrame.boundingBox();
  const overlap = !(eb.x > bb.x + bb.width || bb.x > eb.x + eb.width || eb.y > bb.y + bb.height || bb.y > eb.y + eb.height);
  check("editor: corner box at the bottom-right", Math.abs(1366 - 16 - (eb.x + eb.width)) <= 1, round(eb));
  check("editor: the HTML bar floats at the bottom, 50 px tall", bb.y > 600 && Math.round(bb.height) === 50, round(bb));
  check("editor: the floating bar and the Small box don't overlap at 1366 px", !overlap);
  await p.screenshot({ path: SHOTS + "announcements-pages-editor.png" });

  // 4. Account page: the HTML top bar at the top, sealed, ✕ outside its box.
  p = await teacherPage();
  await p.goto(`${APP}/account`, { timeout: 120_000 });
  const topFrameEl = p.locator('iframe[title="Announcement"]').first();
  await topFrameEl.waitFor({ timeout: 60_000 });
  const tb = await topFrameEl.boundingBox();
  check("account: HTML top bar at the top, full width, 50 px", tb.y < 120 && tb.width > 1000 && Math.round(tb.height) === 50, round(tb));
  const topFrame = p.frameLocator('iframe[title="Announcement"]').first();
  check("account: the bar's HTML shows", await topFrame.getByText("HTML top bar").isVisible());
  const sealed = await topFrame.locator("body").evaluate(() => {
    let cookieBlocked = false;
    let parentBlocked = false;
    try {
      void document.cookie;
    } catch {
      cookieBlocked = true;
    }
    try {
      void parent.document.title;
    } catch {
      parentBlocked = true;
    }
    return { cookieBlocked, parentBlocked };
  });
  check("account: the box is sealed (no cookies, no page access)", sealed.cookieBlocked && sealed.parentBlocked, JSON.stringify(sealed));
  await p.waitForTimeout(500);
  const closeOutside = await p.evaluate(() => {
    const bar = document.querySelector('iframe[title="Announcement"]')?.parentElement;
    return Boolean(bar?.querySelector('button[aria-label="Close"]'));
  });
  check("account: the ✕ sits outside the HTML box", closeOutside);

  // 5. Saved page: a YouTube card in a Medium corner box.
  p = await teacherPage();
  await p.goto(`${APP}/saved`, { timeout: 120_000 });
  const ytBox = p.getByRole("region", { name: "Announcement" });
  await ytBox.waitFor({ timeout: 60_000 });
  const yt = ytBox.getByRole("link", { name: "Watch on YouTube: Test video" });
  check("saved: YouTube card in the corner box", await yt.isVisible());
  check(
    "saved: it opens YouTube in a new tab",
    (await yt.getAttribute("target")) === "_blank" && (await yt.getAttribute("href")).includes("dQw4w9WgXcQ"),
  );
  check("saved: Medium box is 500 wide", Math.round((await ytBox.boundingBox()).width) === 500);

  // 6. Liked page: a Facebook post in a Small corner box.
  p = await teacherPage();
  await p.goto(`${APP}/liked`, { timeout: 120_000 });
  const fbBox = p.getByRole("region", { name: "Announcement" });
  await fbBox.waitFor({ timeout: 60_000 });
  const fbFrame = fbBox.locator('iframe[title="Facebook post"]');
  check(
    "liked: Facebook's post frame in the corner box",
    (await fbFrame.getAttribute("src")).startsWith("https://www.facebook.com/plugins/post.php"),
  );
  check("liked: 'Open on Facebook' link", await fbBox.getByRole("link", { name: "Open on Facebook" }).isVisible());

  // 7. Search page: an HTML modal loading an outside picture and font.
  p = await teacherPage();
  await p.goto(`${APP}/search`, { timeout: 120_000 });
  await p.getByRole("dialog", { name: "Announcement" }).waitFor({ timeout: 60_000 });
  const htmlFrame = p.frameLocator('iframe[title="Announcement"]');
  await htmlFrame.locator("#pic").waitFor();
  await p.waitForTimeout(4000);
  const outside = await htmlFrame.locator("body").evaluate(async () => {
    await document.fonts.ready;
    const pic = document.getElementById("pic");
    return { picture: pic.complete && pic.naturalWidth > 0, font: document.fonts.check("28px Pacifico") };
  });
  check("search: the HTML box loads an outside picture", outside.picture);
  check("search: the HTML box loads an outside font", outside.font);
} catch (error) {
  check("run finished without an exception", false, String(error).split("\n")[0]);
} finally {
  await browser.close();
  psql("delete from public.announcement_dismissals; delete from public.announcements;");
  await deleteTeacher(teacher);
}

finish();
