// The public home page, sitemap, page titles and h1s (docs/superpowers/specs/2026-11-20-public-home-and-seo-design.md).
// Logged out, "/" is the public home (the proxy serves /welcome there; /welcome itself goes to "/"), with the newest
// QuizMatter lessons linking to their previews and never a teacher's shared copy. Logged in, "/" is the normal home.
// sitemap.xml lists lessons, not teachers' copies; robots.txt names it. Pages have their own titles; the editor has
// one h1.
import { chromium } from "playwright";
import { APP, SHOTS, check, deleteTeacher, finish, loggedIn, makeTeacher, psql } from "./lib.mjs";

const admin = await makeTeacher({ first: "Home", last: "Admin", admin: true });
const teacher = await makeTeacher({ first: "Home", last: "Teacher" });
const browser = await chromium.launch();

const slide = (id, question) => ({
  id,
  type: "choice",
  question,
  layout: "grid",
  options: ["a", "b", "c", "d"].map((option) => ({ id: `${id}-${option}`, text: `Choice ${option.toUpperCase()}` })),
  correctOptionId: `${id}-b`,
  elements: [],
  questionHeight: 100,
});

const tag = Date.now();
const ids = { lesson: crypto.randomUUID(), original: crypto.randomUUID(), copy: crypto.randomUUID(), mine: crypto.randomUUID() };
const lessonTitle = `Public lesson ${tag}`;
const copyTitle = `Teacher copy ${tag}`;
psql(`
  insert into public.presentations (id, owner_id, title, subject, grades, is_published, from_admin) values
    ('${ids.lesson}', '${admin.id}', '${lessonTitle}', 'Science', '{"Grade 3"}', true, true);
  insert into public.presentations (id, owner_id, title) values
    ('${ids.original}', '${teacher.id}', 'Original ${tag}'),
    ('${ids.mine}', '${teacher.id}', 'Editable ${tag}');
  select set_config('quizmatter.sharing', 'yes', false);
  insert into public.presentations (id, owner_id, title, shared_from, is_published, shared_at) values
    ('${ids.copy}', '${teacher.id}', '${copyTitle}', '${ids.original}', true, now());
  insert into public.slides (presentation_id, id, position, data) values
    ('${ids.lesson}', 'l1', 0, $j$${JSON.stringify(slide("l1", "What do plants need?"))}$j$),
    ('${ids.copy}', 'c1', 0, $j$${JSON.stringify(slide("c1", "Copy slide"))}$j$),
    ('${ids.mine}', 'm1', 0, $j$${JSON.stringify(slide("m1", "Mine"))}$j$);
`);

try {
  // ─── Logged out ─────────────────────────────────────────────────────────────────────────────────────────────
  const visitor = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await visitor.newPage();
  await page.goto(`${APP}/`);
  await page.locator("h1").waitFor();
  check("logged out, / stays at /", new URL(page.url()).pathname === "/", page.url());
  check("the public home's h1", (await page.locator("h1").innerText()) === "Build presentations with quizzes built in");
  check("there is exactly one h1", (await page.locator("h1").count()) === 1);
  check("Sign up free goes to sign up", (await page.getByRole("link", { name: "Sign up free" }).first().getAttribute("href")) === "/signup");
  const lessonLink = page.getByRole("link", { name: new RegExp(lessonTitle) });
  check("a QuizMatter lesson links to its preview", (await lessonLink.getAttribute("href")) === `/presentation/${ids.lesson}`);
  check("a teacher's shared copy isn't listed", (await page.getByText(copyTitle).count()) === 0);
  check("the page doesn't scroll sideways at phone width", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: `${SHOTS}public-home-phone.png`, fullPage: true });
  check("the home's title", (await page.title()) === "QuizMatter: presentations with quizzes built in", await page.title());

  const welcome = await fetch(`${APP}/welcome`, { redirect: "manual" });
  check("/welcome itself goes to /", welcome.status === 307 && new URL(welcome.headers.get("location"), APP).pathname === "/", `${welcome.status} ${welcome.headers.get("location")}`);

  const sitemap = await (await fetch(`${APP}/sitemap.xml`)).text();
  check("sitemap.xml lists the lesson", sitemap.includes(`/presentation/${ids.lesson}`));
  check("sitemap.xml doesn't list a teacher's copy", !sitemap.includes(ids.copy));
  check("sitemap.xml lists the public pages", ["/login", "/signup", "/privacy", "/terms"].every((path) => sitemap.includes(`https://quizmatter.com${path}`)));
  const robots = await (await fetch(`${APP}/robots.txt`)).text();
  check("robots.txt names the sitemap", robots.includes("Sitemap: https://quizmatter.com/sitemap.xml"), robots);

  await page.goto(`${APP}/login`);
  check("the login page's title", (await page.title()) === "Log in · QuizMatter", await page.title());
  await page.goto(`${APP}/privacy`);
  check("Privacy's title says QuizMatter once", (await page.title()) === "Privacy Policy · QuizMatter", await page.title());
  await visitor.close();

  // ─── Logged in ──────────────────────────────────────────────────────────────────────────────────────────────
  const context = await loggedIn(browser, teacher);
  const home = await context.newPage();
  await home.goto(`${APP}/`);
  await home.locator("h1").first().waitFor();
  check("logged in, / is the normal home", (await home.locator("h1").first().innerText()) === "Presentations");
  check("the logged-in home's title", (await home.title()) === "My presentations · QuizMatter", await home.title());
  await home.goto(`${APP}/saved`);
  check("Saved's title", (await home.title()) === "Saved · QuizMatter", await home.title());
  await home.goto(`${APP}/presentation/${ids.mine}/edit`);
  await home.locator("h1").first().waitFor({ state: "attached", timeout: 30_000 });
  check("the editor has exactly one h1, its title", (await home.locator("h1").count()) === 1 && (await home.locator("h1").textContent()) === `Editable ${tag}`);
  await context.close();
} finally {
  await browser.close();
  // Deleting an admin moves their QuizMatter lessons to the super admin, so the lesson goes first.
  psql(`delete from public.presentations where id = '${ids.lesson}'`);
  await deleteTeacher(teacher);
  await deleteTeacher(admin);
}
finish();
