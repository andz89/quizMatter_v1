import { Children, type ReactNode } from "react";
import { notFound } from "next/navigation";
import { ChevronDownIcon, ShieldIcon } from "lucide-react";
import { getAccount } from "@/lib/account";
import { BLOCKED_EMAIL_DOMAINS } from "@/lib/blockedEmailDomains";
import { LOGIN_LIMIT, SIGN_UP_LIMIT, SIGN_UPS_PER_ADDRESS, type BrowserLimit } from "@/lib/browserLimits";
import { KEEP_UNCONFIRMED_DAYS } from "@/lib/cleanupAccounts";
import { KEEP_NEW_FILES_MS } from "@/lib/cleanupPhotos";
import { DRAFT_LIFETIME_MS } from "@/lib/drafts";
import { FOLDER_NAME_MAX, MAX_FOLDERS } from "@/lib/folders";
import {
  CONTACT_NUMBER_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  EDUCATION_FIELD_MAX_LENGTH,
  EDUCATION_LEVEL_LABELS,
  EDUCATION_LEVELS,
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/userSettings";
import { MAX_PHOTO_FILE_BYTES, MAX_STORED_PHOTO_BYTES } from "@/lib/constants";
import { PHOTO_TICKET_LIFETIME_MS } from "@/lib/photoTickets";
import { REFUSALS } from "@/lib/presentations";
import { MAX_PRESENTATIONS, MAX_SAVED, MAX_SLIDES, MAX_TAGS, PUBLISH_NEEDS_CONTENT, WRITES_PER_MINUTE } from "@/lib/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { timeAgo } from "@/lib/format";
import { ClickTabs } from "./ClickTabs";
import { lookUpEmails, type AdminClient, type ClickLimit } from "./data";
import { PausedTeachers, type PausedRow } from "./PausedTeachers";

/**
 * Admin → Safety: every protection against misuse that works in QuizMatter, with its numbers, how many teachers
 * are paused or banned right now, and a Release button for paused teachers. The click limits come straight from the
 * click_limits table, the rest from the app's own limits, so the page stays true when a number changes.
 * click_limits and click_rate have no policies, so they need the secret key.
 */
export default async function AdminSafetyPage() {
  // The layout checks too, but a layout doesn't run again on every request, so the page checks next to its data.
  if (!(await getAccount()).isAdmin) notFound();
  const admin = createAdminClient();
  if (!admin) {
    return (
      <p className="rounded-card border border-border-default bg-bg-surface px-5 py-12 text-center text-sm text-text-secondary">
        This page needs the secret key SUPABASE_SECRET_KEY on the server.
      </p>
    );
  }

  const limits = await admin.from("click_limits").select("*").order("feature");
  if (limits.error) throw limits.error;
  const clickLimits = limits.data as ClickLimit[];

  const [banned, autoBanned, pausedRows] = await Promise.all([
    admin.from("banned_users").select("user_id", { count: "exact", head: true }),
    admin.from("banned_users").select("user_id", { count: "exact", head: true }).eq("is_automatic", true),
    buildPausedRows(admin, clickLimits),
  ]);
  if (banned.error) throw banned.error;
  if (autoBanned.error) throw autoBanned.error;

  const banningLimits = clickLimits.filter((limit) => limit.ban_after_pauses);
  // Teachers, not rows: one teacher paused on two features counts once.
  const pausedNow = new Set(pausedRows.filter((row) => row.isPausedNow).map((row) => row.userId)).size;
  const repeatHours = [...new Set(clickLimits.map((limit) => limit.repeat_within_hours))].join(" or ");
  const megabytes = (bytes: number) => `${bytes / 1024 / 1024} MB`;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-text-secondary">
        Everything that stops misuse of QuizMatter, and what the teacher sees when it happens. Admins aren&apos;t
        counted by the speed limits.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Paused now" value={pausedNow} note="Teachers who clicked a feature too fast" />
        <Stat label="Banned" value={banned.count ?? 0} note="See Admin → Teachers" />
        <Stat label="Automatic bans" value={autoBanned.count ?? 0} note="Made by the app, not an admin" />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">Clicked too fast</h2>
        <ClickTabs active="now" />
        <PausedTeachers rows={pausedRows} repeatHours={repeatHours} />
      </section>

      <Group title="Speed limits">
        <Item
          name="Save speed limit"
          where="Database"
          rule={`${WRITES_PER_MINUTE} a minute each for saving presentations and uploading photos (bookmarks use their own click limit, below)`}
          sees={`“${REFUSALS.QM429}” For photos: “You're adding photos too fast. Wait a minute and try again.”`}
          more={{
            what: [
              "The database counts how many times each teacher saves a presentation in one minute, and how many photos they upload in one minute. Each teacher has their own count.",
              `Up to ${WRITES_PER_MINUTE} a minute is fine. More than that is refused until the minute is over. Nothing is paused for long and nobody is banned: after a minute it works again.`,
            ],
            example: `Ana is working fast and presses Ctrl+S many times. Even pressing it every 2 seconds is still under ${WRITES_PER_MINUTE} a minute, so she never sees the message.`,
            scenario: `Someone writes a script (a small program that does the clicking for them) that saves a presentation 1,000 times a minute, to slow the app down for everyone. Only ${WRITES_PER_MINUTE} of those saves go through each minute; the rest are refused right away.`,
          }}
        />
        {clickLimits.map((limit) => (
          <Item
            key={limit.feature}
            name={`${limit.label || limit.feature} click limit`}
            where="Database"
            rule={
              (limit.daily_reset_time_zone
                ? `${limit.max_clicks} a day pauses it until 12:00 midnight (${zoneName(limit.daily_reset_time_zone)}), when the count starts again.`
                : `${limit.max_clicks} clicks within ${timeSpan(limit.per_seconds)} pauses it for ${duration(limit.first_pause_minutes)}. ` +
                  `If it happens again within ${limit.repeat_within_hours} hours, the pause is ${duration(limit.repeat_pause_minutes)}.`) +
              (limit.ban_after_pauses ? ` ${banRule(limit.ban_after_pauses)}` : "")
            }
            sees="Its buttons grey out, and a notice at the bottom says when they work again."
            more={clickLimitMore(limit)}
          />
        ))}
      </Group>

      <Group title="Sharing presentations">
        <Item
          name="Only real content is published"
          where="Database + app"
          rule="A teacher's presentation can only become published with a title and at least one slide with something on it (question or answer text, an element, or a video / slides link). Already published ones can still be saved as usual"
          sees={`“${PUBLISH_NEEDS_CONTENT}”`}
          more={{
            what: [
              "Before a presentation becomes published, the app checks two things: it has a title, and at least one slide has something on it. “Something” means question text, answer text, a text box, picture or shape, or a video or slides link.",
              "The app checks it first, so the teacher is told at once. The database checks it again, so nobody can skip it (not even Claude, or a request sent by hand).",
              "It's only checked when a presentation becomes published. A presentation that's already published can be saved as usual.",
            ],
            example: "Ben makes a new presentation, leaves the title empty, and clicks Share → Published. He sees “Add a title and some content before publishing.” He types the title “Plant Parts”, adds a question, and publishes again. It works.",
            scenario: "Someone wants to fill other teachers' Home page with junk, so they make 50 empty presentations with no title and try to publish them. Every one is refused, because none has a title or any content.",
          }}
        />
        <Item
          name="Share and publish click limits"
          where="Database"
          rule="Each teacher has two counters of their own: one for switching a presentation private ↔ published, one for publishing. They count every way of saving (the Share button, Claude, or requests sent by hand), and all of the teacher's presentations together, not each one alone. Admins and QuizMatter presentations aren't counted"
          sees="The Share card greys out the switch, and a notice at the bottom says when it works again."
          more={{
            what: <ShareLimitDetails limits={clickLimits} />,
            scenario: "Someone tries to stay at the top of other teachers' Home page by publishing, hiding and publishing again all day, or tries to post many presentations at once. The switching limit stops the back-and-forth after a few minutes, and the publishing limit stops the flood until midnight.",
          }}
        />
        <Item
          name="Private means private"
          where="Database + app"
          rule="Other teachers can't open, save or copy a private presentation, and its link stops working. A page left open from before it went private checks again before “Make a copy”"
          sees="“This presentation is private now, so it can't be copied.”"
          more={{
            what: [
              "When a teacher makes a presentation private, the database hides it from everyone else. It leaves the Home page and other teachers' “Saved” lists, and its link shows “not found”.",
              "One more case: another teacher may still have its page open from before. When they click “Make a copy”, the app asks the database again first. If it's private now, no copy is made.",
            ],
            example: "Ana published “Fractions Quiz”. At 2:00 PM Ben opens it. At 2:05 PM Ana makes it private. At 2:10 PM Ben, still on the old page, clicks “Make a copy”. He sees “This presentation is private now, so it can't be copied.”, and the page reloads as “not found”.",
            scenario: "Someone shares a presentation's link in a group chat after the owner made it private. Nobody who opens the link can see it, save it or copy it.",
          }}
        />
      </Group>

      <Group title="Bans">
        {banningLimits.map((limit) => (
          <Item
            key={limit.feature}
            name={`Automatic ban: ${limit.label || limit.feature}`}
            where="Database"
            rule={`${banRule(limit.ban_after_pauses!)} Each time must be within ${limit.repeat_within_hours} hours of the last.`}
            sees="Banned like an admin ban. Shows as “Automatic” on Admin → Teachers, where it can be lifted with Unban."
            more={{
              what: [
                `If a teacher keeps hitting the ${limit.label || limit.feature} click limit again and again, the app bans the account by itself, without waiting for an admin.`,
                `The times must come close together: each one within ${limit.repeat_within_hours} hours of the last. ${banRule(limit.ban_after_pauses!)}`,
                "The ban works like an admin's ban: no saving, no uploads, no logging in. It shows as “Automatic” on Admin → Teachers, and an admin can lift it with Unban.",
              ],
              example: `Ben hits the limit on Monday morning and is paused. He hits it again that afternoon, and again that evening. The ${ordinal(limit.ban_after_pauses!)} time, he is banned instead of paused. An admin looks, sees it was a mistake, and clicks Unban.`,
              scenario: "A script keeps clicking all night, waiting out each pause and starting again. Instead of being paused forever, the account is banned, and an admin sees it in the morning.",
            }}
          />
        ))}
        <Item
          name="Admin ban"
          where="Database + login"
          rule="An admin bans a teacher on Admin → Teachers, with a reason"
          sees="Can't save or add photos from that moment, and can't log in again. A login that's already open stops working within the hour."
          more={{
            what: [
              "An admin can ban a teacher on Admin → Teachers, and writes the reason. Admins can't ban themselves or other admins.",
              "From that moment the teacher can't save or upload photos. They can't log in again, and a login that's already open stops working within the hour (that's how long a login lasts before Supabase checks it again).",
              "Unban on the same page undoes it.",
            ],
            example: "Teachers report three of Ben's presentations as rude. An admin reads them, bans Ben with the reason “Rude content”, and hides the presentations on Admin → Reports.",
            scenario: "Someone posts bad content and makes new ones as soon as they're hidden. One ban stops all of it: they can't save, upload or log in again.",
          }}
        />
      </Group>

      <Group title="Size limits">
        <Item
          name="Presentations per teacher"
          where="Database"
          rule={`${MAX_PRESENTATIONS} at most`}
          sees="Asked to delete some first."
          more={{
            what: [`Each teacher can have up to ${MAX_PRESENTATIONS} presentations. To make another one, they delete one they don't need.`],
            example: `Ana has ${MAX_PRESENTATIONS} presentations and clicks “New presentation”. She's asked to delete some first. She deletes 2 old ones and makes her new one.`,
            scenario: "A script tries to make 10,000 presentations to fill the database. It stops at the limit.",
          }}
        />
        <NewPresentationsItem limit={clickLimits.find((limit) => limit.feature === "create")} />
        <Item
          name="Slides per presentation"
          where="Database + app"
          rule={`${MAX_SLIDES} at most`}
          sees="Adding slides is greyed out at the limit."
          more={{
            what: [`A presentation can have up to ${MAX_SLIDES} slides. In the editor, the “add slide” buttons grey out at the limit, and the database refuses more too.`],
            example: `Ben's review presentation has ${MAX_SLIDES} slides. The add-slide button is greyed out, so he starts a second presentation for the rest.`,
            scenario: "Someone sends one giant presentation with 5,000 slides, so the app gets slow for every teacher who opens it. The database refuses it.",
          }}
        />
        <Item
          name="Saved presentations"
          where="Database"
          rule={`${MAX_SAVED} at most`}
          sees="Asked to remove some first."
          more={{
            what: [`A teacher can bookmark (save) up to ${MAX_SAVED} of other teachers' presentations into their “Saved” list.`],
            example: `Ana has saved ${MAX_SAVED} presentations and clicks Save on another one. She's asked to remove some first. She removes 3 she no longer uses.`,
            scenario: "A script tries to bookmark every presentation in the app. It stops at the limit (and the bookmark click limit pauses it sooner).",
          }}
        />
        <Item
          name="Photo size"
          where="Browser + server"
          rule={`The file ${megabytes(MAX_PHOTO_FILE_BYTES)} at most (checked in the browser); stored ${megabytes(MAX_STORED_PHOTO_BYTES)} at most after shrinking (checked on the server)`}
          sees={`“This photo is too big (${megabytes(MAX_PHOTO_FILE_BYTES)} at most).” or “This photo is too detailed to upload. Please try a smaller one.”`}
          more={{
            what: [
              `A photo file can be up to ${megabytes(MAX_PHOTO_FILE_BYTES)}. The browser checks that before uploading anything.`,
              `The app then shrinks the photo. What's stored must be ${megabytes(MAX_STORED_PHOTO_BYTES)} or less, and the server checks that, so a photo that stays too big after shrinking is refused.`,
            ],
            example: `Ben uploads a 6 MB phone photo. It's under ${megabytes(MAX_PHOTO_FILE_BYTES)}, so it's shrunk to a much smaller file and saved.`,
            scenario: "Someone uploads huge files to use up the app's storage. Files over the limit never leave their computer, and the server refuses anything too big that's sent another way.",
          }}
        />
        <Item
          name="Text length"
          where="App + database"
          rule="Every text that's saved has a maximum length, checked with zod in the app. The database also checks titles, reports and photo details; slide text is only limited by the slide's total size (about 2 MB)"
          sees="The text box stops at the limit, or the save is refused."
          more={{
            what: [
              "Every text box has a maximum length (for example, a title or a report note). The text box stops taking letters at the limit.",
              "Before saving, the app checks everything again with zod (a checking tool that compares the data with a list of rules). The database also checks titles, reports and photo details, and the total size of each slide (about 2 MB).",
            ],
            example: "Ana pastes a whole page of text into the title box. Only the first part fits, and the rest is cut off.",
            scenario: "Someone skips the app and sends a title that is a million letters long by hand. The database refuses it.",
          }}
        />
        <Item
          name="Folders per teacher"
          where="Database + app"
          rule={`${MAX_FOLDERS} folders at most, each name up to ${FOLDER_NAME_MAX} characters`}
          sees={`“You have ${MAX_FOLDERS} folders, the most allowed. Delete one to make another.”`}
          more={{
            what: [`Each teacher can make up to ${MAX_FOLDERS} folders to sort their presentations. The database counts them, so the limit holds even for requests sent by hand.`],
            example: `Ana has a folder for each subject and grade, ${MAX_FOLDERS} in all. To add one for a new class, she deletes an old one first.`,
            scenario: "A script tries to make 100,000 empty folders to fill the database. It stops at the limit.",
          }}
        />
        <Item
          name="Tags per presentation"
          where="App + database"
          rule={`${MAX_TAGS} tags at most on each presentation`}
          sees={`“Use ${MAX_TAGS} tags at most.”`}
          more={{
            what: [`Tags help teachers find presentations on the Home page. A presentation can have up to ${MAX_TAGS}; the app checks it with zod, and the database checks it again.`],
            example: "Ben tags his quiz “fractions”, “math”, “grade 4”. That's 3, well under the limit.",
            scenario: "Someone adds hundreds of popular tags to their presentation so it shows up in every search. Only the first few can be saved.",
          }}
        />
      </Group>

      <Group title="Access">
        <Item
          name="Own data only"
          where="Database"
          rule="Teachers can only change their own presentations, photos and bookmarks"
          sees="Nothing; other people's things are read only."
          more={{
            what: [
              "The database has rules for every table, called row level security (rules that decide, for each row, who may read or change it). A teacher can only change rows that belong to them.",
              "Other teachers' published presentations can be looked at and copied, but never changed.",
            ],
            example: "Ben opens Ana's published presentation. He can look at it, save it or make his own copy, but there's no Edit button, and his copy is a separate presentation.",
            scenario: "Someone changes the address in the browser, or sends a request by hand, to delete Ana's presentation. The database checks who owns it and refuses.",
          }}
        />
        <Item
          name="Reports"
          where="Database"
          rule="One report per teacher per presentation; admins can hide it (Admin → Reports)"
          sees="“You already reported this presentation.”"
          more={{
            what: [
              "Any teacher can report another teacher's published presentation, with a reason (rude or unsafe, spam, copied without credit, or other).",
              "Each teacher can report one presentation only once. Admins see the reports on Admin → Reports and can hide the presentation.",
            ],
            example: "Ben finds a presentation full of ads, and reports it as “Spam”. An admin sees the report and hides it, so teachers don't see it anymore.",
            scenario: "Someone clicks Report 100 times on a presentation they don't like, to make it look bad. Only their first report counts; the rest are refused.",
          }}
        />
        <Item
          name="Photos from Claude"
          where="Server"
          rule={`Only admins can use Claude. When Claude adds a photo to the shared library, it gets a one-time upload link that stops after ${duration(PHOTO_TICKET_LIFETIME_MS / 60_000)}, so nobody can reuse it.`}
          sees="Nothing; teachers can't use Claude. If a link is too old, Claude simply asks for a new one."
          more={{
            what: [
              "Only admins can connect Claude (the AI helper) to QuizMatter.",
              `When Claude adds a photo to the shared library, it first asks for an upload link. That link works only once, and only for ${duration(PHOTO_TICKET_LIFETIME_MS / 60_000)}.`,
            ],
            example: "An admin asks Claude to add a photo of a volcano. Claude gets a link, uploads the photo with it, and the link stops working right after.",
            scenario: "Someone finds an old upload link in a chat log and tries to upload their own pictures with it. The link was already used, or is too old, so the upload is refused.",
          }}
        />
        <Item
          name="Admin pages only for admins"
          where="Server"
          rule="Every Admin page, and every admin action behind it, first checks that the person is an admin (the admins table). The database functions for admin work check it again"
          sees="A teacher who types an Admin address sees “not found”, as if the page didn't exist."
          more={{
            what: [
              "The Admin area and each page in it ask the server “is this person an admin?” before showing anything. A teacher gets the “not found” page, so they can't even tell the page exists.",
              "The buttons on those pages (ban, hide, publish a review, …) call actions that check again, and the database functions behind them check a third time.",
            ],
            example: "Ben sees a link to /admin/teachers in a screenshot and types it in. He gets “not found”.",
            scenario: "Someone sends the “ban teacher” request by hand, without the Admin page. The server and the database both see they're not an admin and refuse.",
          }}
        />
        <Item
          name="Claude only for admins"
          where="Server"
          rule={`Only admins who aren't banned can connect Claude to QuizMatter. A presentation Claude makes is a draft that only that admin can open, and it's deleted after ${duration(DRAFT_LIFETIME_MS / 60_000)} if it isn't saved`}
          sees="Nothing; teachers don't see Claude. An admin opening an old draft link is told it has expired."
          more={{
            what: [
              "Claude (the AI helper) logs in to QuizMatter with the admin's own account. The server checks on every request that the account is an admin and isn't banned.",
              `What Claude makes waits as a draft. Only the admin who asked for it can open the draft link, and it's deleted after ${duration(DRAFT_LIFETIME_MS / 60_000)} unless they save it.`,
            ],
            example: "An admin asks Claude for a quiz about volcanoes, opens the draft link, checks it and saves it as a presentation.",
            scenario: "A teacher connects Claude with their own account to make hundreds of presentations. The server sees they're not an admin and refuses every request.",
          }}
        />
        <Item
          name="Login only returns to QuizMatter pages"
          where="App"
          rule="After logging in, the app goes back only to a page on quizmatter.com, never to another site. The sign up email link only opens quizmatter.com/auth/confirm"
          sees="Nothing; they land back on the page they wanted."
          more={{
            what: [
              "When a logged-out teacher opens a page, the app remembers it and goes back there after login. It only goes back to a page on this site; anything that points elsewhere is replaced with the home page.",
              "The link in the sign up email works the same way: it always opens QuizMatter's own page, which logs the teacher in.",
            ],
            example: "Ana opens a shared presentation link while logged out, logs in, and lands on that presentation.",
            scenario: "Someone sends teachers a QuizMatter login link that's changed to send them to a fake site afterwards (to steal their password there). The app ignores the other site and opens QuizMatter's home page.",
          }}
        />
        <Item
          name="Profiles show only public details"
          where="Database"
          rule="Every teacher has a profile page that any logged-in user can open with its link: display name, first and last name, educational background and bio. The profile page never shows the contact number or email. Admin profiles stay hidden from teachers: their names on presentations aren't links"
          sees="Their profile, from “View my profile” on the Account page, or the Publisher and Reviewer names on a presentation."
          more={{
            what: [
              "A teacher's details live in one row that only they can read, because it also holds their contact number. The profile page doesn't open that row: it asks a database function (teacher_profile) that hands out only the public fields.",
              "Teachers know admins only as “QuizMatter”, so an admin's profile is shown only to admins, and the presentation page links only names whose profile the viewer may open. Someone who isn't logged in is sent to log in first.",
              "Note: presentation pages still show the publisher's and reviewers' email next to their name, as before. Only the profile page itself leaves it out.",
            ],
            example: "Ana copies her profile link from the Account page and shares it in her school's group chat. Colleagues with a QuizMatter account open it and see her name, degree and bio.",
            scenario: "Someone opens many profile pages to collect teachers' phone numbers. The pages never contain them, and sending requests by hand doesn't help, because the function never returns them.",
          }}
        />
      </Group>

      <Group title="Presentation reviews">
        <Item
          name="Locked while under review"
          where="Database"
          rule="While an editor reviews a presentation (until an admin publishes it or sends it back), nobody can change it or its slides, except hiding it. Only publishing the review changes it"
          sees={`“${REFUSALS.QMREV}”`}
          more={{
            what: [
              "An editor's changes are kept as a draft, not in the presentation itself. While the review is open, the database refuses every change to the presentation and its slides, from anyone, so the editor and the admin see exactly what they're checking.",
              "When an admin publishes the review, the draft replaces the presentation. A review whose editor no longer has an account doesn't lock anything, and an admin can cancel any review.",
            ],
            example: "An editor is fixing typos in a QuizMatter presentation. Someone with the presentation open tries to save. The save is refused, and they're told it's under review.",
            scenario: "Someone tries to slip new content into a presentation after it was checked but before it's published. The database refuses the change, so only what was reviewed goes live.",
          }}
        />
        <Item
          name="Review rules"
          where="Database"
          rule="Only editors (teachers an admin trusts) can review, one review at a time per presentation. The reviewer can't change the author, sharing, owner or “from QuizMatter”, and a banned reviewer's work can't be published"
          sees={`“${REFUSALS.QMRVW}”`}
          more={{
            what: [
              "An admin makes a teacher an editor in Admin → Teachers. Only editors can start a review, and only one review can be open on a presentation at a time.",
              "All of these rules live in the database functions, which check who is calling, so they hold even if the app is skipped. Taking away the editor role cancels that editor's open review.",
            ],
            example: "Two editors open the same presentation. The first starts reviewing; the second is told someone else is reviewing it.",
            scenario: "An editor tries to use a review to make themselves the author of a popular presentation. The review can't change the author, so the change is never saved.",
          }}
        />
      </Group>

      <Group title="Safe content">
        <Item
          name="Text can't carry code"
          where="App"
          rule="Text typed on slides is stored as plain words with simple styles only (bold, italic, underline, alignment). Anything else in saved text, like a script or a picture tag, is removed before it's shown"
          sees="Nothing; their text looks the way they typed it."
          more={{
            what: [
              "Web pages are built from code (HTML), and text that holds code can run in the viewer's browser. So the text editor only keeps the few styles it offers, and saved text is rebuilt through those same rules before it's shown: any other tag simply disappears.",
            ],
            example: "Ana types “<b>” into a question as an example for her class. It shows as the letters “<b>”, not as bold text.",
            scenario: "Someone saves a slide whose text secretly holds a script that would steal the login of every teacher who opens it (called XSS). The script is removed before the slide is shown, so it never runs.",
          }}
        />
        <Item
          name="Only known sites inside slides"
          where="App"
          rule="Videos only from YouTube or Vimeo, slides only from Google Slides or Canva, pictures only from https links or Google Drive. Other links are refused"
          sees="“Paste a picture link that starts with https://”, or a similar message for videos and slides."
          more={{
            what: [
              "A slide can show a video or another slide deck inside it. The app only accepts links from a few well-known sites, and turns them into that site's own player address, so no other website can be put inside a slide.",
            ],
            example: "Ben pastes a YouTube link. The video plays on his slide.",
            scenario: "Someone pastes a link to a fake login page so it shows inside a slide, hoping other teachers type their password there. The link isn't from a known site, so it's refused.",
          }}
        />
        <Item
          name="Photo links checked"
          where="Server + Cloudflare"
          rule={`Adding a photo from a link: https only, public internet addresses only, JPG, PNG or WebP only, ${megabytes(MAX_PHOTO_FILE_BYTES)} at most, and 10 seconds at most. Only for logged-in teachers`}
          sees="“This link isn't a JPG, PNG or WebP photo.” or “Couldn't get a photo from this link.”"
          more={{
            what: [
              "When a teacher pastes a photo link, QuizMatter's server downloads it for them. It only goes to public internet addresses (a Cloudflare setting), so it can't be pointed at private networks.",
              `It stops as soon as the file passes ${megabytes(MAX_PHOTO_FILE_BYTES)} or takes longer than 10 seconds, and only accepts real photo types.`,
            ],
            example: "Ana pastes a link to a picture of the solar system. The server fetches it, and it's added like any uploaded photo.",
            scenario: "Someone pastes the address of a computer inside a company network, hoping QuizMatter's server will fetch private data for them. The server only reaches the public internet, so it fails.",
          }}
        />
        <Item
          name="Photo uploads checked"
          where="Server"
          rule={`Only logged-in teachers can upload, and the server reads the start of each file to make sure it really is a JPG, PNG or WebP photo (not just named like one). ${megabytes(MAX_STORED_PHOTO_BYTES)} at most. Only admins can add photos to the shared library`}
          sees="“Only photos can be uploaded.”"
          more={{
            what: [
              "Every file type starts with its own few bytes (a kind of signature). The server checks those, so a program renamed to “photo.jpg” is refused.",
              "Uploads also count toward the save speed limit, and a banned account can't upload.",
            ],
            example: "Ben uploads a PNG drawing his class made. The server sees it's a real PNG and saves it.",
            scenario: "Someone renames a harmful program to “cat.jpg” and uploads it, hoping others download it. The server sees it isn't a photo and refuses it.",
          }}
        />
        <Item
          name="Newer work is never overwritten"
          where="Database"
          rule="A save from an older copy of a presentation (another tab or device that wasn't reloaded) is refused, so it can't wipe out newer changes"
          sees={`“${REFUSALS.QM409}”`}
          more={{
            what: [
              "Each saved presentation remembers when it was last saved. A save that starts from an older copy is refused, and the teacher is asked to reload to get the newest one.",
            ],
            example: "Ana edits a quiz on her laptop, then on her phone. Back on the laptop, its old tab tries to save. She's asked to reload, and her phone's changes are kept.",
            scenario: "Two tabs keep saving over each other and a teacher loses an hour of work. The older save is refused instead.",
          }}
        />
      </Group>

      <Group title="Sign up and login">
        <Item
          name="Login check"
          where="Login page + Supabase"
          rule="Cloudflare Turnstile checks it's a person, not a script. Supabase Auth checks its answer (Attack Protection in the Supabase dashboard)"
          sees="A quick “are you a person” check before logging in, usually automatic."
          more={{
            what: [
              "Before logging in or signing up, Cloudflare Turnstile (a free “are you a person?” check) quietly looks at the browser. Most people never have to click anything.",
              "Supabase, which runs the logins, checks Turnstile's answer too, so a script can't skip the login page and log in directly.",
            ],
            example: "Ana opens the login page, types her email and password, and logs in. The check ran in the background, and she didn't notice it.",
            scenario: "A script tries thousands of passwords on a teacher's email, or makes thousands of fake accounts. It can't pass the person check, so it's stopped before Supabase even tries the password.",
          }}
        />
        <Item
          name="Email must be confirmed"
          where="Supabase"
          rule="A new account can't log in until the teacher clicks the link Supabase emails them (Authentication → Sign In / Providers → Confirm email)"
          sees="“Check your email” after signing up. Logging in before clicking the link: “Please confirm your email first.”"
          more={{
            what: [
              "After signing up, Supabase emails a link to the address the teacher typed. The account works only after that link is clicked, so the email must be real and theirs.",
              "Admin → Teachers marks accounts that haven't clicked it yet as “Not confirmed”.",
            ],
            example: "Ana signs up with ana.cruz@gmail.com, opens her Gmail, clicks “Confirm my email”, and lands on the home page, logged in.",
            scenario: "Someone signs up with a made-up address or another teacher's email. Nobody can click the link, so the account can never be used.",
          }}
        />
        <Item
          name="Throwaway emails refused"
          where="Sign up page"
          rule={`${BLOCKED_EMAIL_DOMAINS.size} common throwaway email services (like mailinator.com and yopmail.com) are refused. The list is in src/lib/blockedEmailDomains.ts`}
          sees="“Please use your real email address (school or personal), not a throwaway one.”"
          more={{
            what: [
              "Throwaway email sites give anyone an inbox for a few minutes, with no sign up. They make fake accounts easy, so the sign up form refuses the best-known ones.",
              "It's a short list on purpose: the full lists have over 100,000 sites and would make the page slow. Add a site to the list if fake sign ups keep coming from it.",
            ],
            example: "Ben tries to sign up with test123@mailinator.com and sees the message. He uses his school email instead, and it works.",
            scenario: "Someone makes 20 throwaway inboxes to confirm 20 fake accounts. The form refuses those addresses before anything is sent.",
          }}
        />
        <Item
          name="Sign ups per internet address"
          where="Database (Supabase hook)"
          rule={`${SIGN_UPS_PER_ADDRESS} new accounts per hour from one internet address. After that, Supabase refuses until the hour is over: no account is made and no email is sent. Turned on in the Supabase dashboard (Authentication → Hooks → Before User Created)`}
          sees="“Too many accounts were made from this internet connection. Please try again in an hour.”"
          more={{
            what: [
              "Just before Supabase makes a new account, it asks the database (the hook_before_user_created function), which writes down the internet address and counts how many sign ups came from it in the last hour.",
              "Supabase runs it itself, so clearing the browser, another browser or a script can't skip it. Logins aren't counted.",
              `Teachers on the same Wi-Fi share one internet address, so a school shares ${SIGN_UPS_PER_ADDRESS} an hour. A bigger group signing up together has to spread it over more than an hour.`,
            ],
            example: `A school runs a QuizMatter training. 8 teachers sign up on the school Wi-Fi in the morning: all fine, it's under ${SIGN_UPS_PER_ADDRESS}.`,
            scenario: `Someone at home keeps signing up with made-up emails. After ${SIGN_UPS_PER_ADDRESS} in one hour, every new try is refused, and no more emails are wasted.`,
          }}
        />
        <Item
          name="Sign ups per browser"
          where="Browser"
          rule={browserLimitRule(SIGN_UP_LIMIT, "sign ups")}
          sees="“You've made several accounts on this browser. Please try again after 3:45 PM.”"
          more={{
            what: [
              "The sign up page counts, in the browser's own storage, how many accounts were made on it. Too many in a short time locks the page on that browser for a while.",
              "It's a speed bump for someone clicking by hand: clearing the browser, a private window or a script gets around it. The limit per internet address above is the one that can't be skipped.",
              "If the browser blocks storage, nothing is counted, so a real teacher is never locked out by mistake.",
            ],
            example: `Three teachers share the faculty-room laptop and all sign up in the same hour. A fourth would wait ${duration(SIGN_UP_LIMIT.firstLockMs / 60_000)}.`,
            scenario: "Someone keeps clicking “Create account” with made-up emails. After a few, the page on their browser stops sending anything for an hour, then for a day if they come back and do it again.",
          }}
        />
        <Item
          name="Wrong logins per browser"
          where="Browser"
          rule={`${browserLimitRule(LOGIN_LIMIT, "wrong logins")} Only a wrong email or password counts, and a correct login starts the count again`}
          sees="“Too many wrong tries on this browser. Please try again after 3:45 PM.”"
          more={{
            what: [
              "The login page counts wrong email-or-password tries in the browser's own storage. Too many in a short time locks the login page on that browser for a while.",
              "Shorter than the sign up lock on purpose: a teacher who forgot their password must not wait a day.",
              "It locks the browser, not the account, so nobody can lock a real teacher out by typing wrong passwords for their email. Like the sign up lock, clearing the browser gets around it; the person check and Supabase's limit below are the real walls.",
            ],
            example: `Ana mixes up her passwords and gets it wrong ${LOGIN_LIMIT.max} times. She waits ${duration(LOGIN_LIMIT.firstLockMs / 60_000)}, remembers the right one, and logs in.`,
            scenario: "Someone tries to guess a teacher's password by hand. After a few wrong guesses they're locked out of the login page for a while, and each try still needs the person check.",
          }}
        />
        <Item
          name="Unconfirmed accounts deleted"
          where="Cloudflare timer"
          rule={`Every day at 4:00 AM (UTC), accounts whose email wasn't confirmed within ${KEEP_UNCONFIRMED_DAYS} days are deleted (src/lib/cleanupAccounts.ts). Accounts an admin invited from the Supabase dashboard are kept; one added there by hand must have “Auto Confirm User” ticked`}
          sees="Nothing. A teacher whose link expired can simply sign up again."
          more={{
            what: [
              `Fake or mistyped sign ups are never confirmed. Once a day, the app deletes accounts still unconfirmed after ${KEEP_UNCONFIRMED_DAYS} days, so they don't pile up in Admin → Teachers.`,
              "Confirmed accounts are never touched. An unconfirmed account never logged in, so it has no presentations or photos to lose.",
            ],
            example: `Ben signs up but types his email wrong, so the link never reaches him. ${KEEP_UNCONFIRMED_DAYS} days later the broken account is gone, and he signs up again with the right email.`,
            scenario: "Someone makes dozens of fake accounts. They show as “Not confirmed” for a few days, then disappear on their own.",
          }}
        />
        <Item
          name="Supabase sign up and email limits"
          where="Supabase dashboard"
          rule="Sign ups and logins together: 30 per 5 minutes per internet address. Emails: a set number per hour for the whole app. Set in the Supabase dashboard (Authentication → Rate Limits), not in the code"
          sees="“Too many tries. Please wait a few minutes and try again.” When the emails run out: “We can't send more sign up emails right now. Please try again in an hour.”"
          more={{
            what: [
              "Supabase counts sign ups and logins from each internet address, and refuses more than 30 in 5 minutes.",
              "It also counts every email it sends for the whole app. When the hour's emails run out, sign ups wait until the next hour, for everyone. That's why the limits above stop spam before it uses them up.",
            ],
            example: "A busy school logs in at the start of class. 25 teachers on the same Wi-Fi in 5 minutes is still under 30, so nobody notices.",
            scenario: "A script hammers the login page from one address. After 30 tries in 5 minutes, Supabase refuses it until the 5 minutes are over.",
          }}
        />
        <Item
          name="Password rules"
          where="App + Supabase"
          rule={`A password needs ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters and must be typed twice the same way, on sign up and on the Account page. Supabase checks its own minimum too (Authentication → Sign In / Providers → Email)`}
          sees={`“Use at least ${PASSWORD_MIN_LENGTH} characters for your password.” or “The two passwords don't match.”`}
          more={{
            what: [
              `Short passwords are easy to guess, so the app asks for at least ${PASSWORD_MIN_LENGTH} characters. Typing it twice catches typos, so a teacher doesn't lock themselves out with a password they never meant.`,
              "Supabase, which keeps the passwords, refuses short ones too, so someone who skips the app still can't set a weak one (as long as its minimum in the dashboard is set to the same number).",
            ],
            example: `Ben types “cat123” and sees “Use at least ${PASSWORD_MIN_LENGTH} characters for your password.” He picks a longer one, types it twice, and signs up.`,
            scenario: "Someone tries to guess a teacher's password from a list of common short ones. None of them is long enough to be anyone's password here.",
          }}
        />
        <Item
          name="Sign up details checked"
          where="App + database"
          rule={`First and last name up to ${NAME_MAX_LENGTH} characters each, display name up to ${DISPLAY_NAME_MAX_LENGTH}, contact number 7–${CONTACT_NUMBER_MAX_LENGTH} characters (digits, spaces and + - ( ) only, at least 7 digits), educational background from the list (${EDUCATION_LEVELS.map((level) => EDUCATION_LEVEL_LABELS[level]).join(", ")}) and field or major up to ${EDUCATION_FIELD_MAX_LENGTH}. All required`}
          sees="A plain message under the form, e.g. “Enter a contact number with at least 7 digits.”"
          more={{
            what: [
              "The sign up form and the Account page check every detail with zod before anything is sent (src/lib/userSettings.ts).",
              "The database checks the same limits again (the user_settings columns), so details sent straight to Supabase, skipping the app, can't be too long or have a made-up education level: that sign up simply fails.",
            ],
            example: "Ana types her contact number as “0917-123-4567”. It has 11 digits and only dashes, so it's accepted.",
            scenario: "A script sends a sign up with a 10,000-letter “name” to fill the database with junk. The database refuses it, and no account is made.",
          }}
        />
        <Item
          name="Emails really from QuizMatter"
          where="Cloudflare DNS + Resend"
          rule="Sign up emails are sent by Resend as no-reply@quizmatter.com. The SPF, DKIM and DMARC records for quizmatter.com in Cloudflare (DNS → Records) prove they really come from QuizMatter. Set up outside the code"
          sees="Emails from “QuizMatter <no-reply@quizmatter.com>” that land in the inbox, not in spam."
          more={{
            what: [
              "Anyone can write “QuizMatter” as the sender of an email. Three DNS records (small lines in quizmatter.com's settings) let inboxes check it: SPF says which servers may send for quizmatter.com, DKIM signs every email, and DMARC tells inboxes what to do with emails that fail those checks.",
              "Resend (the email service) and Supabase's SMTP Settings send the emails; the records live in Cloudflare. If they're removed, emails start landing in spam.",
            ],
            example: "Ana signs up with her Gmail. Gmail checks the signature, sees the email really came from quizmatter.com, and puts it in her inbox.",
            scenario: "Someone sends teachers a fake “Confirm your QuizMatter account” email from their own server, with a link to a fake login page. It fails the checks, so inboxes mark it as suspicious or put it in spam.",
          }}
        />
        <Item
          name="Supabase login settings"
          where="Supabase dashboard"
          rule="Anonymous sign-ins and manual linking are off; links in emails only go back to quizmatter.com (Authentication → URL Configuration: Site URL and Redirect URLs); changing an account's email needs a confirmation from both the old and the new address (Secure email change). Set in the dashboard, not in the code"
          sees="Nothing; it just keeps every account tied to a real, confirmed email."
          more={{
            what: [
              "Anonymous sign-ins would let anyone in without an email at all, so they're off.",
              "The links in Supabase's emails can only lead back to quizmatter.com (and localhost while testing), never to another site.",
              "To change the email of an account, both the old and the new address must confirm it, so someone who gets into an account for a moment can't quietly take it over.",
            ],
            example: "Ben clicks “Confirm my email” in his sign up email. It opens quizmatter.com/auth/confirm, which logs him in.",
            scenario: "Someone edits a QuizMatter email link to send teachers to their own fake site after confirming. Supabase only follows links to the allowed addresses, so it refuses.",
          }}
        />
      </Group>

      <Group title="Outside the app">
        <Item
          name="Cloudflare rate limit"
          where="Cloudflare"
          rule="Counts requests per IP address. Set in the Cloudflare dashboard (Security → WAF → Rate limiting rules), not in the code"
          sees="Cloudflare's “Error 1015 — You are being rate limited” page. Teachers sharing one school network share one IP."
          more={{
            what: [
              "Cloudflare sits in front of the app and counts how many requests (page loads, saves, clicks) come from each IP address. An IP address is like the street address of an internet connection.",
              "Too many in a short time and Cloudflare blocks that address for a while, before the request even reaches the app. The numbers are set in the Cloudflare dashboard, not in the code.",
            ],
            example: "A whole school uses QuizMatter on the same Wi-Fi, so they all share one IP address. If the limit is set too low, a busy class could see “Error 1015” for a short time, so the limit has to leave room for that.",
            scenario: "Someone floods the app with millions of requests to make it crash (a “DDoS” attack). Cloudflare blocks the flood at the door, and teachers can keep working.",
          }}
        />
        <Item
          name="Weekly photo cleanup"
          where="Cloudflare timer"
          rule={`Every Sunday at 3:00 AM (UTC), photo files that nothing uses anymore (no “My photos” list, shared photo, slide or review draft) are deleted. Files newer than ${duration(KEEP_NEW_FILES_MS / 60_000)} are kept. Admin → Photo cleanup shows what will go`}
          sees="Nothing; photos still in use are never touched."
          more={{
            what: [
              "Photos live in Cloudflare's storage. Once a week the app lists every photo file and deletes the ones nothing points to anymore, so unused files don't pile up.",
              `New files are always kept for ${duration(KEEP_NEW_FILES_MS / 60_000)}, because a teacher may have put one on a slide they haven't saved yet. Photos in review drafts count as used.`,
            ],
            example: "Ben uploads 10 photos, uses 3, and deletes the other 7 from “My photos”. A week later, the 7 unused files are gone from storage.",
            scenario: "Someone uploads photos and deletes them again, over and over, to fill QuizMatter's storage. The files are deleted in the next cleanup.",
          }}
        />
      </Group>
    </div>
  );
}

type Streak = { user_id: string; feature: string; paused_until: string; pause_streak: number };

/**
 * The Paused teachers table: paused now (first), or paused before and still counting toward an automatic ban (the
 * pause ended less than `repeat_within_hours` ago). Times are counted from now, so the server's time zone doesn't
 * matter.
 */
async function buildPausedRows(admin: AdminClient, limits: ClickLimit[]): Promise<PausedRow[]> {
  const now = Date.now();
  // Only chains that may still count: the pause ended less than the longest repeat_within_hours ago.
  const longestRepeatHours = Math.max(0, ...limits.map((limit) => limit.repeat_within_hours));
  const { data, error } = await admin
    .from("click_rate")
    .select("user_id, feature, paused_until, pause_streak")
    .gt("pause_streak", 0)
    .gt("paused_until", new Date(now - longestRepeatHours * 3_600_000).toISOString());
  if (error) throw error;
  const streaks = data as Streak[];

  const limitByFeature = new Map(limits.map((limit) => [limit.feature, limit]));
  const current = streaks.filter((row) => {
    const limit = limitByFeature.get(row.feature);
    return limit && Date.parse(row.paused_until) > now - limit.repeat_within_hours * 3_600_000;
  });
  const emails = await lookUpEmails(admin, current.map((row) => row.user_id));

  return current
    .map((row) => {
      const limit = limitByFeature.get(row.feature)!;
      const until = Date.parse(row.paused_until);
      const isPausedNow = until > now;
      return {
        userId: row.user_id,
        email: emails.get(row.user_id) ?? "",
        feature: row.feature,
        label: limit.label || row.feature,
        status: isPausedNow
          ? `Paused for ${Math.ceil((until - now) / 60_000)} more min`
          : `Pause ended ${timeAgo(until, now).toLowerCase()}, can use it again`,
        isPausedNow,
        streak: row.pause_streak,
        banAfter: limit.ban_after_pauses,
      };
    })
    .sort((a, b) => Number(b.isPausedNow) - Number(a.isPausedNow) || b.streak - a.streak);
}

/**
 * The automatic ban, in words. The time that reaches `banAfter` bans instead of pausing (count_click), so there are
 * only banAfter − 1 pauses before it.
 */
function banRule(banAfter: number): string {
  if (banAfter === 1) return "Reaching the limit bans the teacher at once.";
  const pauses = banAfter - 1;
  return `Reaching the limit ${banAfter} times in a row bans the teacher (the first ${pauses === 1 ? "time only pauses" : `${pauses} times only pause`}).`;
}

/**
 * Everything about the share and publish limits, in plain words: the numbers (from their click_limits rows, so they
 * stay true when they change), what counts and what doesn't, how the counting time works, and an example timeline
 * for each. Without the rows (the share_limits migration not run yet), it says so instead of showing numbers.
 */
function ShareLimitDetails({ limits }: { limits: ClickLimit[] }) {
  const share = limits.find((limit) => limit.feature === "share");
  const publish = limits.find((limit) => limit.feature === "publish");

  return (
    <div className="flex flex-col gap-3">
      <p>
        Each teacher has <b>two limits of their own</b>. One teacher reaching a limit never affects another teacher.
        Both limits count <b>all of the teacher&apos;s presentations together</b>: switching 3 different
        presentations 4 times each counts as 12, the same as switching one presentation 12 times.
      </p>

      {!share || !publish ? (
        <p className="rounded-dropdown bg-highlight-soft px-3 py-2 text-highlight-strong">
          These limits aren&apos;t in the database yet, so they don&apos;t work yet. Run the migration
          20261103000000_share_limits.sql, and their numbers and examples show here.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-dropdown border border-border-default bg-bg-surface">
            <table className="w-full text-left text-[13px]">
              <thead className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">
                <tr className="border-b border-border-default">
                  <th className="px-3 py-2">Limit</th>
                  <th className="px-3 py-2">What counts</th>
                  <th className="px-3 py-2">How many</th>
                  <th className="px-3 py-2">First pause</th>
                  <th className="px-3 py-2">Pause again</th>
                  <th className="px-3 py-2">Ban</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { limit: share, name: "Switching", counts: "Private → published and published → private (both ways)" },
                  { limit: publish, name: "Publishing", counts: "Only private → published" },
                ].map(({ limit, name, counts }) => (
                  <tr key={name} className="border-b border-border-default last:border-b-0">
                    <td className="px-3 py-2 font-semibold">{name}</td>
                    <td className="px-3 py-2">{counts}</td>
                    <td className="px-3 py-2">{limitAmount(limit)}</td>
                    <td className="px-3 py-2">{firstPause(limit)}</td>
                    <td className="px-3 py-2">
                      {limit.daily_reset_time_zone
                        ? "Until 12:00 midnight, every time"
                        : `${duration(limit.repeat_pause_minutes)}, if it happens again within ${limit.repeat_within_hours} hours after the last pause ended`}
                    </td>
                    <td className="px-3 py-2">{limit.ban_after_pauses ? banRule(limit.ban_after_pauses) : "Never"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <MoreList
            title="What counts"
            lines={[
              "Making a presentation published (counts for both limits).",
              "Making a presentation private (counts only for switching).",
              "Saving a brand-new presentation as published the first time (counts for both).",
              "Every way of doing it: the Share button, Claude, or a request sent by hand, skipping the app.",
            ]}
          />
          <MoreList
            title="What doesn't count"
            lines={[
              "Normal saves: editing slides, the title, the details, and pressing Save.",
              "Opening the Share card, clicking Cancel in the “Continue?” box, or clicking the choice that's already picked.",
              "Copy link.",
              "A click that's refused during a pause (it doesn't make the pause longer).",
              "Admins, and QuizMatter presentations (made on Admin → Presentations).",
            ]}
          />
          <MoreList
            title="How the counting works"
            lines={[
              `Switching: the count starts at the teacher's first switch, and goes back to 0 ${resetText(share)}.`,
              `Publishing: the count goes back to 0 ${resetText(publish)}.`,
              `The last allowed one still works: the ${ordinal(share.max_clicks)} switch, or the ${ordinal(publish.max_clicks)} publish. The one after it is refused, and the pause starts.`,
              "While switching is paused, both Private and Published are greyed out. While only publishing is paused, just Published is greyed out: the teacher can still make presentations private.",
              "The teacher sees the greyed-out choices, a short line in the Share card, and a notice at the bottom of the screen with the time it works again. Nothing else in the app stops.",
              "An admin can end a pause early with Release, in the “Clicked too fast” list above.",
            ]}
          />
          <Timeline
            title={`Example: switching (${limitAmount(share)})`}
            steps={switchingTimeline(share)}
          />
          <Timeline
            title={`Example: publishing (${limitAmount(publish)})`}
            steps={publishingTimeline(publish)}
          />
        </>
      )}
    </div>
  );
}

/** Ana's day with the switching limit, from its numbers: she starts at 9:00 AM and reaches the limit 20 minutes in. */
function switchingTimeline(limit: ClickLimit): [string, string][] {
  const start = 9 * 60;
  const last = start + Math.min(20, Math.floor(limit.per_seconds / 60 / 3));
  const pauseEnd = last + limit.first_pause_minutes;
  const again = pauseEnd + 240;
  return [
    [clock(start), `Ana publishes “Fractions Quiz”. That's switch 1 of ${limit.max_clicks}.`],
    [`${clock(start)} – ${clock(last)}`, `She keeps switching it (and another presentation) private and published: switches 2 to ${limit.max_clicks - 1}.`],
    [clock(last), `Switch ${limit.max_clicks}. It still works. Now switching is paused for ${duration(limit.first_pause_minutes)}, until ${clock(pauseEnd)}.`],
    [clock(last + 5), `She opens Share again. Private and Published are greyed out, and the notice at the bottom says “Sharing presentations is paused until ${clock(pauseEnd)}”.`],
    [clock(pauseEnd), "The pause ends. She can switch again, and the count starts from 0."],
    [clock(again), `She reaches ${limit.max_clicks} switches again. This is within ${limit.repeat_within_hours} hours after the last pause ended, so this pause is longer: ${duration(limit.repeat_pause_minutes)}, until ${clock(again + limit.repeat_pause_minutes)}.`],
  ];
}

/**
 * Ben's day with the publishing limit, from its numbers. Counted per day: he publishes from 7:00 to 7:20 AM and waits
 * until midnight. Otherwise: from 9:00 AM, the last one a third of the way into the counting time.
 */
function publishingTimeline(limit: ClickLimit): [string, string][] {
  if (limit.daily_reset_time_zone) {
    return [
      [clock(7 * 60), `Ben publishes his first presentation that day. That's publish 1 of ${limit.max_clicks}.`],
      [`${clock(7 * 60)} – ${clock(7 * 60 + 20)}`, `He publishes more: publishes 2 to ${limit.max_clicks - 1}.`],
      [clock(7 * 60 + 20), `Publish ${limit.max_clicks}. It still works. Now publishing is paused until 12:00 midnight.`],
      [clock(9 * 60), "He wants to publish one more. Published is greyed out, and the notice at the bottom says “Publishing presentations is paused until 12:00 AM”. Private still works, so he can still hide a presentation (that counts as a switch)."],
      ["12:00 midnight", `Midnight (${zoneName(limit.daily_reset_time_zone)}). The pause ends, and the count starts from 0: he can publish ${limit.max_clicks} more today.`],
    ];
  }
  const start = 9 * 60;
  const last = start + Math.floor(limit.per_seconds / 60 / 3);
  const pauseEnd = last + limit.first_pause_minutes;
  return [
    [clock(start), `Ben publishes his first presentation that day. That's publish 1 of ${limit.max_clicks}.`],
    [`${clock(start)} – ${clock(last)}`, `He publishes more: publishes 2 to ${limit.max_clicks - 1}.`],
    [clock(last), `Publish ${limit.max_clicks}. It still works. Now publishing is paused for ${duration(limit.first_pause_minutes)}, until ${clock(pauseEnd)}.`],
    [clock(last + 30), "He wants to publish one more. Published is greyed out. Private still works, so he can still hide a presentation (that counts as a switch)."],
    [clock(pauseEnd), "The pause ends. He can publish again, and the count starts from 0."],
  ];
}

function MoreList({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div>
      <p className="font-semibold">{title}</p>
      <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

/** An example as times and what happens at each. */
function Timeline({ title, steps }: { title: string; steps: [string, string][] }) {
  return (
    <div className="rounded-dropdown border border-border-default bg-bg-surface px-3 py-2.5">
      <p className="font-semibold">{title}</p>
      <ol className="mt-1.5 flex flex-col gap-1">
        {steps.map(([time, text]) => (
          <li key={time} className="flex flex-col sm:flex-row sm:gap-3">
            <span className="shrink-0 font-semibold text-accent sm:w-36">{time}</span>
            <span>{text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Minutes after midnight → "9:20 AM", or "9:20 AM the next day" (2 days later: "in 2 days"). */
function clock(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const inDay = minutes % 1440;
  const hours = Math.floor(inDay / 60);
  const time = `${hours % 12 || 12}:${String(inDay % 60).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
  return days === 0 ? time : days === 1 ? `${time} the next day` : `${time} in ${days} days`;
}

/** 1 → "1st", 12 → "12th", 22 → "22nd". */
function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** How many, in words: "12 within 1 hour", or "10 a day" for a limit counted per day. */
function limitAmount(limit: ClickLimit): string {
  return limit.daily_reset_time_zone ? `${limit.max_clicks} a day` : `${limit.max_clicks} within ${timeSpan(limit.per_seconds)}`;
}

/** How long the first pause is: "1 hour", or "Until 12:00 midnight" for a limit counted per day. */
function firstPause(limit: ClickLimit): string {
  return limit.daily_reset_time_zone ? "Until 12:00 midnight" : duration(limit.first_pause_minutes);
}

/** When the count goes back to 0, finishing "the count goes back to 0 …". */
function resetText(limit: ClickLimit): string {
  return limit.daily_reset_time_zone
    ? `every night at 12:00 midnight (${zoneName(limit.daily_reset_time_zone)}), so it's simply ${limit.max_clicks} a day`
    : `${timeSpan(limit.per_seconds)} after that first one`;
}

/** "Asia/Manila" → "Philippine time"; other time zones by their name. */
function zoneName(timeZone: string): string {
  return timeZone === "Asia/Manila" ? "Philippine time" : timeZone;
}

/** 25 → "25 seconds", 3600 → "1 hour", 86400 → "24 hours". */
function timeSpan(seconds: number): string {
  return seconds % 60 === 0 ? duration(seconds / 60) : `${seconds} seconds`;
}

/** "3 sign ups within 1 hour lock the page on that browser for 1 hour; if it happens again within 24 hours, for 24 hours." */
function browserLimitRule(limit: BrowserLimit, what: string): string {
  const minutes = (ms: number) => duration(ms / 60_000);
  return (
    `${limit.max} ${what} within ${minutes(limit.withinMs)} lock the page on that browser for ${minutes(limit.firstLockMs)}; ` +
    `if it happens again within ${minutes(limit.repeatWithinMs)}, for ${minutes(limit.repeatLockMs)}.`
  );
}

/** 10 → "10 minutes", 60 → "1 hour", 120 → "2 hours". */
function duration(minutes: number): string {
  if (minutes % 60 === 0) return minutes === 60 ? "1 hour" : `${minutes / 60} hours`;
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

function Stat({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="rounded-card border border-border-default bg-bg-surface px-5 py-3.5">
      <p className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">{label}</p>
      <p className="mt-1 font-heading text-2xl font-extrabold text-text-primary">{value}</p>
      <p className="text-[13px] text-text-secondary">{note}</p>
    </div>
  );
}

/** A group of protections that opens and closes on a click (closed at first, so the page is easy to scan). */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group/section flex flex-col gap-2">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-2 text-[11px] font-bold tracking-[0.05em] text-text-header uppercase hover:text-text-secondary [&::-webkit-details-marker]:hidden">
        <ChevronDownIcon size={14} className="-rotate-90 transition-transform group-open/section:rotate-0" />
        <h2>{title}</h2>
        <span className="rounded-dropdown bg-bg-page px-2 py-0.5 tracking-normal normal-case">{Children.toArray(children).length}</span>
      </summary>
      <div className="mt-2 flex flex-col divide-y divide-border-default rounded-card border border-border-default bg-bg-surface">
        {children}
      </div>
    </details>
  );
}

/** One protection: its name, where it runs, the rule, what the teacher sees, and its "View more details" box. */
function Item({ name, where, rule, sees, more }: { name: string; where: string; rule: string; sees: string; more?: More | undefined }) {
  return (
    <div className="flex gap-3 px-5 py-3.5">
      <ShieldIcon size={16} className="mt-0.5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-text-primary">{name}</span>
          <span className="rounded-dropdown bg-bg-page px-2.5 py-1 text-[12px] leading-none font-semibold text-text-secondary">
            {where}
          </span>
        </div>
        <p className="mt-1 text-sm text-text-primary">{rule}</p>
        <p className="mt-0.5 text-[13px] text-text-secondary">Teacher sees: {sees}</p>
        {more && <MoreDetails more={more} />}
      </div>
    </div>
  );
}

/**
 * The plain-English explanation behind "View more details": what it does (sentences, or a block of its own), an
 * example of a teacher meeting it, and the bad case it stops.
 */
type More = { what: string[] | ReactNode; example?: string; scenario: string };

/** "View more details" opens it, "View less" closes it: the browser's own <details>, so the page needs no state. */
function MoreDetails({ more }: { more: More }) {
  return (
    <details className="group mt-2">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-[13px] font-semibold text-accent hover:opacity-80 [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">View more details</span>
        <span className="hidden group-open:inline">View less</span>
        <ChevronDownIcon size={14} className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-2 flex flex-col gap-3 rounded-dropdown bg-bg-page px-4 py-3">
        <MorePart title="What it does">
          {Array.isArray(more.what) ? (
            <div className="flex flex-col gap-1.5">
              {more.what.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : (
            more.what
          )}
        </MorePart>
        {more.example && <MorePart title="Example">{more.example}</MorePart>}
        <MorePart title="Scenario: what it stops">{more.scenario}</MorePart>
      </div>
    </details>
  );
}

function MorePart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">{title}</p>
      <div className="mt-1 text-sm text-text-primary">{children}</div>
    </div>
  );
}

/**
 * The new presentations a day limit (the "create" click limit), explained with its numbers. Without its row (the
 * create_limit migration not run yet), it says so.
 */
function NewPresentationsItem({ limit }: { limit?: ClickLimit }) {
  const zone = limit?.daily_reset_time_zone ? zoneName(limit.daily_reset_time_zone) : "";
  return (
    <Item
      name="New presentations per day"
      where="Database"
      rule={
        limit
          ? `${limitAmount(limit)}, counting every new presentation: “+ New presentation”, “Make a copy”, and saving a draft from Claude. ${limit.daily_reset_time_zone ? `Starts again at 12:00 midnight (${zone}).` : ""}`
          : "Not in the database yet: run the migration 20261107000000_create_limit.sql."
      }
      sees="“+ New presentation” and “Make a copy” grey out, and a notice at the bottom says when they work again."
      more={
        limit && {
          what: [
            `Each teacher can make ${limitAmount(limit)}. Each teacher has their own count.`,
            "Every way of making one counts: “+ New presentation”, “Make a copy” on another teacher's presentation, and saving a presentation Claude sent. They all count together.",
            "Saving, editing or deleting a presentation doesn't count. Admins and QuizMatter presentations aren't counted.",
            `The ${ordinal(limit.max_clicks)} still works. After that, making new presentations is paused ${limit.daily_reset_time_zone ? `until 12:00 midnight (${zone}), when the count starts from 0` : `for ${duration(limit.first_pause_minutes)}`}. Everything else keeps working: editing, saving, presenting, publishing.`,
            "Why every new one counts and not only copies: the database can't tell a copy from a new presentation. If only “Make a copy” counted, someone could skip it by making a new presentation and saving the copied slides into it.",
          ],
          example: `Ana prepares for the week. From 1:00 to 3:00 PM she makes 12 new quizzes and copies 8 presentations from other teachers: that's ${limit.max_clicks}. When she clicks “Make a copy” once more, the button is greyed out and the notice says “Making new presentations is paused until 12:00 AM”. She can still edit and present all ${limit.max_clicks}. After midnight she can make ${limit.max_clicks} more.`,
          scenario: `Someone wants to copy every presentation in the app. The limit of 50 presentations doesn't stop them alone: they could copy 50, delete them, and copy 50 more, again and again. With this limit they can only make ${limit.max_clicks} a day, so copying the whole library would take weeks.`,
        }
      }
    />
  );
}

/** What a click limit does, in plain words, with its own numbers (each feature's click_limits row). */
function clickLimitMore(limit: ClickLimit): More {
  const name = limit.label || limit.feature;
  if (limit.daily_reset_time_zone) {
    return {
      what: [
        `The database counts how many times each teacher uses “${name}” each day. Each teacher has their own count, and it starts again at 12:00 midnight (${zoneName(limit.daily_reset_time_zone)}).`,
        `${limit.max_clicks} a day is the limit. The ${ordinal(limit.max_clicks)} time still works; after that, only this feature stops working until midnight. Everything else in the app keeps working.`,
        limit.ban_after_pauses ? banRule(limit.ban_after_pauses) : "It never bans anyone; it only pauses.",
        "Admins aren't counted. An admin can end a pause early with Release (above).",
      ],
      example: `A teacher uses “${name}” ${limit.max_clicks} times between 7:00 and 7:20 AM. The ${ordinal(limit.max_clicks)} time works. The next one is refused, its buttons grey out, and a note at the bottom of the screen says it works again at 12:00 AM.`,
      scenario: `Someone runs a script (a small program that clicks for them) that tries hundreds of times. It's stopped after ${limit.max_clicks}, and has to wait until midnight.`,
    };
  }
  const pause = duration(limit.first_pause_minutes);
  return {
    what: [
      `The database counts how many times each teacher uses “${name}” in a short time. Each teacher has their own count, and it starts again after ${timeSpan(limit.per_seconds)}.`,
      `${limit.max_clicks} times within ${timeSpan(limit.per_seconds)} is the limit. The ${ordinal(limit.max_clicks)} time still works; after that, only this feature stops working for ${pause}. Everything else in the app keeps working.`,
      `If it happens again within ${limit.repeat_within_hours} hours of the last pause, the pause is longer: ${duration(limit.repeat_pause_minutes)}.`,
      limit.ban_after_pauses ? banRule(limit.ban_after_pauses) : "It never bans anyone; it only pauses.",
      "Admins aren't counted. An admin can end a pause early with Release (above).",
    ],
    example: `A teacher uses “${name}” ${limit.max_clicks} times within ${timeSpan(limit.per_seconds)}. The ${ordinal(limit.max_clicks)} time works. The next one is refused, its buttons grey out, and a note at the bottom of the screen says the time it works again (${pause} later).`,
    scenario: `Someone runs a script (a small program that clicks for them) that clicks hundreds of times. It's stopped after ${limit.max_clicks}, and has to wait ${pause}.` + (limit.ban_after_pauses ? ` If it keeps coming back, the account is banned.` : ""),
  };
}
