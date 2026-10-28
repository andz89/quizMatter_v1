# Privacy Policy, Terms of Use and consent at sign up

Date: 2026-10-27 (decisions finished 2026-10-28)

## Why

`/privacy` and `/terms` (`src/app/(legal)/`) are placeholders ("We're still writing this page"). QuizMatter is about
to open to teachers, so it needs real pages that follow Philippine law, mainly the **Data Privacy Act of 2012
(Republic Act No. 10173)**. The user asked for them to be written the way a licensed Philippine lawyer would write
them. They are drafts, not legal advice: a real Philippine lawyer should read them before launch (say so to the user,
not on the pages).

Writing them showed gaps between what a lawful policy must say and what the app does. The user decided each one
(below). The pages must be **true to the code**: where the code and a fair promise disagreed, either the code
changes here or the page says plainly what happens.

## The user's decisions

- **Who runs it:** the Privacy Policy names **Andrew Rivero**, founder and only developer, a private person in the
  Philippines (not a registered business) as the one responsible for the data. The Terms just say "run by its
  founder". Location: only "Philippines" (no city, address or phone). Disputes: the courts of the Philippines.
- **Only teachers sign up** (adults). Students never make accounts. **Nobody has signed up yet**, so there is no
  "agree again" step for old accounts.
- **An agree box at sign up**, saving which version was agreed to and when.
- **Every sign up field stays required**, educational background included. Why QuizMatter needs it, in the user's
  words: teachers share educational resources, so other teachers can be sure a resource was made by a person with an
  educational background. Later, **the user will add a private / public choice for each field** (not part of this
  work; when it ships, the Privacy Policy changes in the same commit).
- **Editors are always public:** an editor's name, **email** and the date always show on every QuizMatter lesson they
  review ("Reviewer: name · email · date", `PresentationPreview.tsx`), to every logged-in teacher, with no hide
  option, and they stay after the editor's account is deleted. The Terms explain what being an editor means. For
  now the super admin asks the teacher, outside the app, and gets a yes before giving the role. An in-app "Accept
  editor role" box is **its own project, right after this one**.
- **Author credit is the copier's job, not the code's:** no code change. The Terms say a teacher who copies, adapts,
  shares again or submits someone else's work must credit the original author (the Author box or on the slides). If
  they don't, they alone answer for it; QuizMatter isn't responsible.
- **Safety records last 1 year:** the record of click pauses and bans (`click_history`) and the Admin log
  (`admin_actions`), which keep teachers' emails, are deleted after 1 year by the daily cleanup.
- Teachers own what they make and answer for it; QuizMatter isn't liable for their content. Graphics made by others
  are credited. QuizMatter is free; giving through the GCash box is voluntary.

## Facts the pages are built on (from the code, 2026-10-27)

- **Contact:** `SUPPORT_EMAIL` (support@quizmatter.com) and `FACEBOOK_URL`, in `src/lib/support.ts`. Reuse
  `SupportEmail` on the pages.
- **Asked at sign up (all required):** email, password (kept by Supabase, hashed), first and last name, contact
  number, educational background (level + field or major). The display name is made from first + last name. Later,
  on the Account page: display name (30-day wait between changes), bio, the same details, password.
- **A hidden second copy:** `signUp` sends those details as login metadata. `handle_new_user` copies them into
  `user_settings`, but the originals stay in `auth.users.raw_user_meta_data` (and in login tokens). Nothing in the app
  reads them from there (only `handle_new_user`, and the sign up hook reads `display_name`, before the account
  exists). This work removes that copy (see "Code changes").
- **Public to logged-in teachers:** the profile page (`/teachers/<link>`, from `teacher_profile`): display name,
  first and last name, educational background, bio, the presentations they published, QuizMatter lessons they made
  as an editor. The Author line on presentations. On QuizMatter lessons, each reviewer's name, email and date. A
  plain teacher's email and contact number are never shown. Logged-out visitors see only login, sign up, the email
  confirm link, Privacy and Terms (`src/proxy.ts`).
- **Admins see more:** Admin → Teachers shows email, names, contact number and educational background. Admins can
  open **every** presentation, private ones too (`20261210000100_plain_admin_limits.sql`), see reports with who
  reported, hide or delete presentations, pause and ban. The Admin log keeps the email of a teacher an admin acted on
  (ban, unban, editor role, pause release).
- **Teachers' work:** presentations, slides, folders, bookmarks (Saved), likes (who liked what is private; the count
  is public), reports. Editors: reviews and submissions. Photo uploads: editors and admins only for now, stored in
  Cloudflare R2; unused photos are deleted by a weekly cleanup.
- **Sharing:** Published makes a shared copy other teachers can see, present, save, like, report and **Make a copy**
  of. The Author box is free text: a copy may change or empty it, and an editor's copy gets the editor as Author
  (`set_editor_author`). Copies can be published again, and an editor's can be submitted. An editor's approved
  submission becomes a QuizMatter lesson owned by an admin, with the editor as Author, and **stays after the
  editor's account is deleted**. "Reviewed by" rows (name, email, date) stay too.
- **Safety records:** the internet address used at sign up (`sign_up_attempts`, deleted after 1 day), Cloudflare
  Turnstile ("are you human") on sign up, click pauses and bans in `click_history` (with the email, kept after the
  account is deleted; this work limits it to 1 year), the Admin log, `banned_users`, Supabase's own login records.
  Unconfirmed accounts are deleted after 3 days (`cleanupAccounts.ts`, daily at 4:00 AM UTC from `worker.ts`).
- **What goes when an account is deleted** (only the super admin does it, from the Supabase dashboard, so teachers
  ask by email): the account, settings, presentations and slides, folders, bookmarks, likes, reports they made,
  their open submissions, their `banned_users` row. What stays: QuizMatter lessons they made as an editor, "Reviewed
  by" rows, approved submission receipts, and for up to 1 year the click history and Admin log rows.
- **Browser:** Supabase login cookies; local storage for unsaved work (`keptWork.ts`) and the sign up / login speed
  bumps (`browserLimits.ts`). **No analytics, no ads, no tracking.**
- **Outside services that hold data:** Supabase (database and login; region `ap-southeast-2`, **Sydney,
  Australia**), Cloudflare (hosting on Workers, photo storage R2, Claude drafts D1, Turnstile; worldwide), Resend
  (sends the sign up emails as no-reply@quizmatter.com), Google Workspace (the support inbox). Anthropic's Claude:
  only admins use the connector (`src/pages/api/mcp.ts`) to make QuizMatter lessons and fill in shared photo details.
  Its `read_presentation` runs as the admin, so today it can read any teacher's private presentation; this work
  limits it (see "Code changes").
- **Giving:** the "Keep QuizMatter free" box (`src/components/KeepFree.tsx`) shows Andrew's GCash QR. The app saves
  nothing about who gave. But GCash itself shows the receiver the sender's name (as GCash shares it) and the amount.
- **Credits for others' graphics:** `src/lib/clipartKids.tsx`: the four girls are "Designed by gstudioimagen /
  Freepik" (their free license asks for the credit). Shared photos each carry a `source` / credit. Icons are Lucide;
  fonts are Lexend and Bricolage Grotesque.

## Goals

- A real **Privacy Policy** at `/privacy` and **Terms of Use** at `/terms`, in plain English (short words, short
  sentences; teachers are not lawyers), following Philippine law, and true to what the code does.
- An **agree box** on the sign up form; the account saves the version agreed to and when.
- The **hidden copy** of the sign up details removed from the login record.
- **Click history and the Admin log** deleted after 1 year.
- **Claude's `read_presentation`** limited to what its own description says.

## Non-goals

- The per-field private / public choice (the user adds it later).
- The in-app "Accept editor role" box (the next project).
- An "agree again" step for existing accounts (there are none yet).
- A "Delete my account" button: teachers ask by email, and the pages say so.
- Locking or checking the Author box on copies.
- A Filipino version of the pages. English only.
- Showing the consent record in Admin → Teachers (it's in the database if ever needed).

## Anti-goals (a failure even if it works)

- A page that promises something the code doesn't do: "we never show your email" (editors' emails show), "we
  delete everything when you delete your account" (some things stay, listed above), "data stays in the
  Philippines", "you can remove your educational background" (it's required).
- Copied boilerplate about things the app doesn't have (ad cookies, payments, subscriptions, children's accounts,
  GDPR-only wording).
- Legal words with no plain explanation. Where a legal term is needed, explain it right after.
- A sign up the form allows without the box ticked.

## The Privacy Policy (`/privacy`)

Title "Privacy Policy", then "Last updated: <date from `LEGAL_VERSION`>". Sections, in this order:

1. **The short version:** 5–7 lines. We keep only what we need to run QuizMatter; we never sell your data or show
   ads; other teachers see your profile, but not your email or contact number (editors: your email shows on lessons
   you review); you can see, fix or delete your data; email us anytime.
2. **Who runs QuizMatter:** run by its founder, **Andrew Rivero**, a private person in the Philippines. Under the
   Data Privacy Act he is the *personal information controller* (means: the person who decides how your data is
   used and answers for it). He is also the data protection officer. Contact: the support email.
3. **What we collect and why:** for each kind, what and why.
   - Account: email (log in, emails about your account); password (Supabase keeps it scrambled; we never see it).
   - Profile: names and display name (shown on your profile and on your work); contact number (so QuizMatter can
     reach you about your account; only admins see it); bio.
   - **Educational background:** required. *Sensitive personal information* under the law (Section 3(l)), so we
     ask for your clear consent at sign up (Section 13(a)). Why: "so that when you share lessons, other teachers can
     see the background of the person who made them". It shows on your profile page. You can change it on the
     Account page; to remove it completely, delete your account.
   - Your work; your agreement record (which version, when); safety records; browser storage.
   - Legal grounds in plain words: your consent (Section 12(a), Section 13(a) for educational background), running
     the service you signed up for (Section 12(b)), keeping QuizMatter safe from misuse (Section 12(f), legitimate
     interests).
4. **What we don't do:** no selling or renting data, no ads, no tracking or analytics tools, no student accounts, no
   payment details.
5. **Who can see your information:** other logged-in teachers (the public list above); **editors: your name, email
   and the date show on every QuizMatter lesson you review, and stay there even after your account is deleted**;
   admins (what they see, and that they can open any presentation, private ones too, to run and protect QuizMatter,
   for example to check a report); likes private, counts public; reports private.
6. **Services that help run QuizMatter:** Supabase (Sydney, Australia), Cloudflare (worldwide), Resend, Google
   Workspace; Claude by Anthropic, used only by QuizMatter's admins to make QuizMatter lessons and describe shared
   photos (it reads the admin's own presentations, published ones and QuizMatter ones, and shared photos; not other
   teachers' private presentations or account details). Data is stored outside the Philippines; QuizMatter stays
   responsible for it (Section 21). We share data with the government only when the law requires it (for example,
   a court order).
7. **If you give through GCash:** the gift goes through GCash, Maya or your bank. QuizMatter saves nothing about it.
   GCash shows Andrew the amount and your name as GCash shares it; he doesn't link it to your account. Those apps
   have their own privacy policies.
8. **How long we keep it:** a short table: account and work (until you delete the account); sign up internet address
   (1 day); unconfirmed accounts (3 days); unused photos (the weekly cleanup); pauses and bans, and the Admin log (1
   year, also after an account is deleted); what stays after deletion and why (QuizMatter lessons you made as an
   editor, with your name as Author; "Reviewed by" names and emails; approved submission records).
9. **How we protect it:** secure connections (https), scrambled passwords, database rules that let each teacher reach
   only their own data, only admins see contact details. If a data breach could harm you, we tell you and the
   National Privacy Commission within 72 hours of finding out, as the law requires.
10. **Your rights:** the Act's rights in plain words, each with how to use it: to be informed, to see your data
    (access), to fix it, to object, to have it erased or blocked, to get a copy you can take elsewhere (portability),
    to be paid for harm (damages), and to complain to the National Privacy Commission. Most you can do on the Account
    page; for the rest (a copy, deleting your account), email us. We may check it's really you, and we reply within
    15 days. Taking back your consent means deleting your account (the details are needed to use QuizMatter).
11. **Students and children:** QuizMatter is for teachers 18 and over. Students don't make accounts. Don't put
    students' personal information in presentations (full names with grades, photos, addresses, …). If you think a
    child's information is on QuizMatter, tell us and we'll remove it.
12. **Changes to this policy:** we post the new version with a new date; for big changes we tell you by email or a
    notice in the app.
13. **Contact us:** support email; Facebook page; the National Privacy Commission (privacy.gov.ph) if we don't fix a
    problem.

## The Terms of Use (`/terms`)

Title "Terms of Use", then "Last updated: <date from `LEGAL_VERSION`>". Sections:

1. **The short version:** QuizMatter is free; you own what you make and answer for it; credit others' work; be kind
   and legal; we can remove content and accounts that break the rules; it comes "as is".
2. **Who we are and agreeing:** QuizMatter is run by its founder (named in the Privacy Policy), in the Philippines.
   Ticking the box at sign up, or using QuizMatter, means you agree to these Terms and the Privacy Policy. An
   electronic agreement counts like a signed one (Electronic Commerce Act, Republic Act No. 8792).
3. **Who can use it:** teachers 18 and over. One account per person; true details; keep your password secret; you
   answer for what's done with your account.
4. **Free, and giving:** QuizMatter is free. Giving through the "Keep QuizMatter free" box is a voluntary gift: it
   buys nothing and gives no extra features; it can't be refunded, except a clear mistake (like a wrong amount),
   which we'll try to return if you email us; QuizMatter isn't a registered charity, so a gift isn't tax-deductible.
   Only give through the box in the app; QuizMatter never asks for money through a QR in a presentation or a
   message.
5. **Your content:** you keep ownership. You give QuizMatter a free, worldwide, non-exclusive permission (license) to
   store, copy, show and process it so QuizMatter works (saving, previews, presenting, backups). **When you
   publish**, other teachers may view, present, save, make their own copy, adapt it for teaching, share their copy
   again and submit it to QuizMatter, as long as they credit you. Copies already made stay when you make yours
   private or delete it.
6. **Credit and responsibility:** you must have the right to use everything you put in (pictures, text, others'
   work), and you answer for it. **If you copy or adapt someone else's work, put the original author in the Author
   box or credit them on the slides. If you don't, you alone answer for it; QuizMatter isn't responsible.**
   QuizMatter doesn't check everything before it's published and, as far as the law allows, isn't responsible for
   what teachers make. Teaching use can count as *fair use* under the Intellectual Property Code (Republic Act No.
   8293), but not always; when in doubt, credit the source or leave it out.
7. **Editors:** a teacher becomes an editor only after agreeing to it. Editors review and submit QuizMatter lessons.
   Being an editor means: your profile details are always public, and **your name, email and the review date show
   on every QuizMatter lesson you review, to every logged-in teacher, and stay there even after your account is
   deleted**. When an admin approves your submission, QuizMatter may keep, edit, publish and share that lesson with
   every teacher for good, even after your account is deleted, with you as Author. Your edits in reviews become part
   of the lesson. Editors don't publish to other teachers; they submit to QuizMatter instead. An admin can take the
   role away.
8. **Rules:** nothing illegal; nothing that copies others' work without permission or credit; nothing sexual,
   violent, hateful, bullying or unsafe for children (content that sexually exploits children is reported to the
   authorities); no students' personal information; no spam, ads, scams or payment QR codes; no hacking, bots,
   scraping, getting around limits, or new accounts to get around a ban; don't pretend to be someone else.
9. **Reports, limits and bans:** teachers can report a presentation; admins may hide or delete content and pause or
   ban accounts that break the rules. Clicking too fast pauses a feature for a while; doing it again and again can
   ban the account automatically. If you think a ban is a mistake, email us.
10. **QuizMatter's content and credits:** QuizMatter lessons, the drawing library and shared photos: use, show and
    print them for teaching, including in your presentations; don't sell them or claim them as your own; keep the
    credits on photos. A **Credits** list: every credit the code names (at least "Some drawings of children:
    Designed by gstudioimagen / Freepik"; "Photos: each shared photo's source is shown with it"; "Icons: Lucide";
    "Fonts: Lexend and Bricolage Grotesque"). The builder greps the drawing files (`src/lib/*.tsx`,
    `src/lib/svgLibrary.tsx`) for any other credit and lists it too. Copyright complaints: email us with the details;
    we look at it and take it down if it's right.
11. **"As is":** free, may change, pause or stop, may lose data; keep your own copies of important work; no promise
    it will always work or have no mistakes.
12. **Limits on liability:** as far as Philippine law allows, QuizMatter isn't liable for indirect losses or lost
    content, and its total liability is at most ₱1,000. This never covers fraud, bad faith or gross negligence,
    which the law doesn't let anyone waive (Civil Code, Article 1171).
13. **Ending:** you can stop anytime and ask us to delete your account. We can suspend or close accounts that break
    these Terms. If QuizMatter shuts down, we'll try to tell you at least 30 days before.
14. **Changes to these Terms:** same as the Privacy Policy.
15. **Law and disputes:** Philippine law. Email us first; we'll try to settle it within 30 days. If not, the proper
    courts of the Philippines.
16. **Contact:** support email.

## Code changes

- **One version string:** a new `src/lib/legal.ts` holds `LEGAL_VERSION = "2026-10-28"` (the day the pages go in);
  both pages show their "Last updated" date from it. Change it whenever either page changes.
- **Agree box** on `src/app/signup/SignUpForm.tsx`, below the fields and above Turnstile: a required checkbox, "I
  agree to the Terms of Use and Privacy Policy, including how QuizMatter keeps and shows my educational
  background." The two names are links that open in a new tab (so the filled form isn't lost). The zod sign up
  schema refuses an unticked box with "Please agree to the Terms of Use and Privacy Policy to make an account."
  `signUp` sends `terms_version: LEGAL_VERSION` in the user metadata.
- **A hint under educational background** on the sign up form and the Account page: "Shows on your profile page, so
  teachers can see who made the lessons they use." The field stays required.
- **Database, one new migration** (after `20261213000000_click_history_keeps_email.sql`):
  - `user_settings` gets `terms_version` and `terms_accepted_at`. Teachers can't change these two themselves (the
    Account page upserts `user_settings`).
  - The newest `handle_new_user` copies `terms_version` and sets `terms_accepted_at = now()` when it's there, then
    **removes the copied keys** (names, contact number, educational background, `terms_version`) from the new
    account's `raw_user_meta_data`.
  - The 1-year delete of `click_history` and `admin_actions` rows (a function the daily cleanup calls, or the
    cleanup deletes them itself with the secret key; builder's choice).
- **The daily cleanup** (`cleanupAccounts.ts`, run by `worker.ts`) also deletes those rows older than 1 year.
- **Claude's `read_presentation`** (`src/pages/api/mcp.ts`) reads only the admin's own presentations, other
  teachers' published ones (shared copies) and QuizMatter ones, as its description already says. Any other gets the
  same "someone else's private one" answer it gives today.
- **Admin → Safety** (`src/app/admin/safety/page.tsx`, `history/page.tsx`): the words that say click history is
  kept after deletion now say "for 1 year", and the new cleanup is listed next to "Unconfirmed accounts deleted".
- **Tests:** a SQL test in `supabase/tests/` (local Docker only): sign up saves the consent and leaves no details in
  the metadata; a teacher can't change the consent columns; the cleanup deletes only rows older than 1 year.

## Calls I made (the user can overrule)

- The age limit is 18 and over.
- Privacy requests answered within 15 days; liability cap ₱1,000; shut-down notice 30 days; dispute talk 30 days.
- One agree box covers the Terms, the Privacy Policy and educational background.
- The consent record is saved but not checked by the database's sign up hook: refusing sign ups without it could
  also refuse accounts an admin invites from the Supabase dashboard. Those are QuizMatter's own team, covered by the
  Terms without an agree step. The form's zod check is what stops an unticked box.
- "1 year" counts from when a row was written, for every row (not from when an account was deleted).
- Editors' profile photos: see "Build order" below.

## Build order: after editors' profile photos

Another session is building editors' profile photos
(`docs/superpowers/specs/2026-10-27-editor-profile-photo-design.md`,
`docs/superpowers/plans/2026-10-28-editor-profile-photo.md`); the user said it's done later on 2026-10-28. This work
starts **only after that feature is committed**, so the two don't edit the same files at once (`AccountForms.tsx`,
the `CLAUDE.md` notes, `teacher_profile`, the next migration number) and so the policy describes the real code.

Before writing the photo lines, read the committed photo code. As designed: only **editors** can add one; it shows,
round, on their profile page to every logged-in teacher; any admin can remove it (written in the Admin log); it's
deleted when the editor role is taken away or the account is deleted; the file is stored in Cloudflare R2. Then:

- Privacy Policy §3 (what we collect): "Profile photo (editors only, optional)" with why.
- §5 (who can see): every logged-in teacher, on the profile page; admins can remove it.
- §8 (how long): until you remove it, the role is taken away, or the account is deleted. Check whether the R2 file
  itself is deleted then or by the weekly photo cleanup, and say the true one.
- Terms §7 (Editors): the photo must be of yourself and suitable for a school.

If the committed code differs from the design (for example, every teacher can add one), write what the code does.

## Notes to update (same commit)

- Root `CLAUDE.md`: the code map line "`(legal)/` Privacy and Terms (placeholders)"; in Click Limits, the click
  history keeps the email **for 1 year**; and a new short rule: **a change to what the app collects, who sees it,
  how long it's kept, or which outside service holds it must update the Privacy Policy (and `LEGAL_VERSION`) in the
  same commit.**
- `src/app/CLAUDE.md`, "Account, profiles, sign up, login": the `(legal)/` line (real pages, `LEGAL_VERSION`) and the
  sign up agree box.
- `src/lib/CLAUDE.md`: `legal.ts`; `userSettings.ts` (the agree field); `cleanupAccounts.ts` (the 1-year delete).
- `src/pages/api/CLAUDE.md`: what `read_presentation` may read.
- `src/app/admin/CLAUDE.md`: Safety → History keeps rows for 1 year.

## Left to the builder

- The page layout inside the existing `(legal)/layout.tsx` card, using the design system (h1/h2 headings, labels, a
  soft box for "The short version", lists, and a small table where it helps).
- The exact sentences, within the outline and the plain-English rule.
- How the migration stops teachers changing the consent columns (a trigger or column privileges), and where the
  1-year delete lives.

## After launch (for the user, not code)

- Have a Philippine lawyer read both pages.
- Before giving someone the editor role, ask them and get a yes (until the "Accept editor role" box exists).
- Once 1,000 or more teachers have given their educational background (sensitive information), QuizMatter may have
  to register with the National Privacy Commission (its registration rules cover sensitive information of 1,000+
  people). Check then.
