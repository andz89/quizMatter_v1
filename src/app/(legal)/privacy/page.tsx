import type { Metadata } from "next";
import Link from "next/link";
import { SupportEmail } from "@/components/SupportEmail";
import { FACEBOOK_URL } from "@/lib/support";
import { LegalSection, LegalTitle, ShortVersion } from "../LegalParts";

export const metadata: Metadata = { title: "Privacy Policy · QuizMatter" };

// Written to be true to the code (docs/superpowers/specs/2026-10-27-privacy-and-terms-design.md). A change to what the
// app collects, who sees it, how long it's kept, or which outside service holds it changes this page and LEGAL_VERSION
// (src/lib/legal.ts) in the same commit.
export default function PrivacyPage() {
  return (
    <>
      <LegalTitle title="Privacy Policy" />

      <ShortVersion>
        <ul>
          <li>We keep only what we need to run QuizMatter.</li>
          <li>We never sell your information, and we don’t show ads.</li>
          <li>
            Other teachers can see your profile, but never your email or contact number. If you’re an editor, your
            email shows on the QuizMatter lessons you review.
          </li>
          <li>You can see, fix or delete your information.</li>
          <li>Questions? Email us anytime.</li>
        </ul>
      </ShortVersion>

      <LegalSection title="1. Who runs QuizMatter">
        <p>
          QuizMatter is run by its founder, <strong>Andrew Rivero</strong>, a private person in the Philippines.
        </p>
        <p>
          Under the Data Privacy Act of 2012 (Republic Act No. 10173), he is the <em>personal information controller</em>{" "}
          (means: the person who decides how your information is used and answers for it). He is also QuizMatter’s{" "}
          <em>data protection officer</em> (means: the person you contact about your privacy).
        </p>
        <p>
          Contact: <SupportEmail />
        </p>
      </LegalSection>

      <LegalSection title="2. What we collect and why">
        <p>
          <strong>Your account.</strong> Your email, so you can log in and we can send you emails about your account.
          Your password, which our login service (Supabase) keeps scrambled, so nobody can read it, not even us.
        </p>
        <p>
          <strong>Your profile.</strong> Your first and last name, and your display name (made from them, and you can
          change it later). They show on your profile page and on the work you share. Your contact number, so QuizMatter
          can reach you about your account; only QuizMatter’s admins see it. A short bio, if you write one.
        </p>
        <p>
          <strong>Your educational background</strong> (your level, like a master’s degree, and your field or major).
          You must give it to make an account. The law calls it <em>sensitive personal information</em> (Section 3(l)),
          so we ask for your clear consent when you sign up (Section 13(a)). Why we ask: teachers share lessons on
          QuizMatter, so other teachers can see the background of the person who made them. It shows on your profile
          page. You can change it on the Account page, and you can hide it from your profile page (“Show on my
          profile”), unless you’re an editor. To remove it completely, delete your account.
        </p>
        <p>
          <strong>Your profile photo</strong> (editors only, and only if you add one). It shows on your profile page,
          so teachers can see who reviews and makes QuizMatter lessons.
        </p>
        <p>
          <strong>Your work.</strong> Your presentations and slides, folders, bookmarks (Saved), likes and reports. If
          you’re an editor, also your reviews, submissions and the photos you upload.
        </p>
        <p>
          <strong>Your agreement.</strong> Which version of the Terms of Use and this Privacy Policy you agreed to at
          sign up, and when.
        </p>
        <p>
          <strong>Safety records.</strong> The internet address you sign up from (to stop one person making many
          accounts), a check that you’re a person and not a robot (Cloudflare Turnstile), a record when a feature is
          paused because it was clicked too fast, bans, and a log of what admins do. Our login service keeps its own
          records of logins, for security.
        </p>
        <p>
          <strong>Your browser.</strong> Login cookies (small files that keep you logged in), and storage in your
          browser for unsaved work and for the sign up and login speed limits. We use no tracking or analytics tools.
        </p>
        <p>
          <strong>Why the law allows this</strong> (our <em>legal grounds</em>):
        </p>
        <ul>
          <li>your consent (Section 12(a), and Section 13(a) for your educational background);</li>
          <li>running the service you signed up for (Section 12(b));</li>
          <li>
            keeping QuizMatter safe from misuse (Section 12(f), <em>legitimate interests</em>, means: a fair reason
            that doesn’t outweigh your rights).
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. What we don’t do">
        <ul>
          <li>We don’t sell or rent your information to anyone.</li>
          <li>We don’t show ads.</li>
          <li>We don’t use tracking or analytics tools.</li>
          <li>Students don’t make accounts.</li>
          <li>We don’t ask for or keep payment details.</li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Who can see your information">
        <p>
          <strong>Other teachers</strong> (only when logged in; QuizMatter’s pages are closed to everyone else, except
          sign up, log in and these two pages). On your profile page: your display name, your first and last name, your
          educational background and your bio (you can hide these three, unless you’re an editor), an editor’s profile
          photo, the presentations you published, and the QuizMatter lessons you made as an editor. Your display name or
          the Author name shows on the work you share. They never see your email or contact number.
        </p>
        <p>
          <strong>If you’re an editor:</strong> your name, email and the date show on every QuizMatter lesson you
          review, to every logged-in teacher, and they stay there even after your account is deleted. Your full name,
          educational background and bio always show on your profile.
        </p>
        <p>
          <strong>QuizMatter’s admins</strong> see your email, names, contact number and educational background (even
          the ones you hid from your profile). To run and protect QuizMatter, for example to check a report, they can
          open any presentation, private ones too. They can hide or delete presentations, remove an editor’s profile
          photo, and pause or ban accounts.
        </p>
        <p>
          <strong>Likes and reports.</strong> Who liked what is private; only the number of likes shows. Reports are
          private: only admins see them and who sent them.
        </p>
      </LegalSection>

      <LegalSection title="5. Services that help run QuizMatter">
        <p>These companies keep or handle your information for us:</p>
        <ul>
          <li>
            <strong>Supabase</strong>: our database and login. Your account and work are stored in Sydney, Australia.
          </li>
          <li>
            <strong>Cloudflare</strong>: runs the website, stores photos and Claude’s drafts, and runs the “are you
            human” check. Its servers are around the world.
          </li>
          <li>
            <strong>Resend</strong>: sends the sign up emails (from no-reply@quizmatter.com).
          </li>
          <li>
            <strong>Google Workspace</strong>: the support email inbox.
          </li>
          <li>
            <strong>Claude by Anthropic</strong>: an AI used only by QuizMatter’s admins, to make QuizMatter lessons and
            describe shared photos. It reads the admin’s own presentations, published ones and QuizMatter ones, and
            shared photos. It does not read other teachers’ private presentations or account details.
          </li>
        </ul>
        <p>
          So your information is stored outside the Philippines. QuizMatter stays responsible for it wherever it is kept
          (Section 21 of the Act).
        </p>
        <p>
          We share information with the government only when the law requires it, for example a court order.
        </p>
      </LegalSection>

      <LegalSection title="6. If you give through GCash">
        <p>
          The “Keep QuizMatter free” box shows a GCash QR code. Your gift goes through GCash, Maya or your bank, not
          through QuizMatter, and QuizMatter saves nothing about it. GCash shows Andrew the amount and your name (the
          way GCash shares it). He doesn’t link it to your QuizMatter account. Those apps have their own privacy
          policies.
        </p>
      </LegalSection>

      <LegalSection title="7. How long we keep it">
        <div className="overflow-hidden rounded-button border border-border-default">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="bg-accent-soft">
              <tr>
                <th className="w-1/2 px-3 py-2 text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">What</th>
                <th className="w-1/2 px-3 py-2 text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">How long</th>
              </tr>
            </thead>
            <tbody className="align-top [&_td]:border-t [&_td]:border-border-default [&_td]:px-3 [&_td]:py-2">
              <tr>
                <td>Your account, profile, work and agreement</td>
                <td>Until you delete your account</td>
              </tr>
              <tr>
                <td>The internet address you signed up from</td>
                <td>1 day</td>
              </tr>
              <tr>
                <td>An account whose email was never confirmed</td>
                <td>3 days, then deleted</td>
              </tr>
              <tr>
                <td>Photos nothing uses anymore</td>
                <td>Deleted by a weekly cleanup</td>
              </tr>
              <tr>
                <td>An editor’s profile photo</td>
                <td>
                  Until you remove it, the editor role is taken away, or the account is deleted; then the weekly cleanup
                  deletes the file
                </td>
              </tr>
              <tr>
                <td>Pauses, bans and the admins’ log</td>
                <td>1 year from when each was written, also after the account is deleted</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          <strong>What stays after you delete your account, and why:</strong>
        </p>
        <ul>
          <li>
            QuizMatter lessons you made as an editor, with your name as Author. They became QuizMatter’s lessons, and
            teachers use them.
          </li>
          <li>Your name, email and the date on the QuizMatter lessons you reviewed, so the credit stays true.</li>
          <li>The records of your approved submissions to QuizMatter.</li>
          <li>
            Copies other teachers already made of the presentations you published. Those copies are theirs.
          </li>
          <li>For up to 1 year, the pause, ban and admin log records above.</li>
        </ul>
      </LegalSection>

      <LegalSection title="8. How we protect it">
        <ul>
          <li>Every page uses a secure connection (https).</li>
          <li>Passwords are kept scrambled.</li>
          <li>Database rules let each teacher reach only their own private information.</li>
          <li>
            Only admins see contact numbers, and teachers’ emails (except an editor’s, on the lessons they review).
          </li>
        </ul>
        <p>
          If a <em>data breach</em> (means: someone gets your information who shouldn’t) could harm you, we tell you
          and the National Privacy Commission within 72 hours of finding out, as the law requires.
        </p>
      </LegalSection>

      <LegalSection title="9. Your rights">
        <p>The Data Privacy Act gives you these rights:</p>
        <ul>
          <li>
            <strong>To be informed:</strong> to know what we collect and why. This page is how we tell you.
          </li>
          <li>
            <strong>To see your information</strong> (<em>access</em>): most of it is on your Account page.
          </li>
          <li>
            <strong>To fix it</strong> (<em>correction</em>): change your details on the Account page.
          </li>
          <li>
            <strong>To object:</strong> to say no to a use of your information.
          </li>
          <li>
            <strong>To have it erased or blocked:</strong> delete your work anytime, or ask us to delete your account.
          </li>
          <li>
            <strong>To get a copy you can take elsewhere</strong> (<em>data portability</em>): email us.
          </li>
          <li>
            <strong>To be paid for harm</strong> (<em>damages</em>) if your information is misused.
          </li>
          <li>
            <strong>To complain</strong> to the National Privacy Commission.
          </li>
        </ul>
        <p>
          For anything you can’t do on the Account page (a copy of your information, deleting your account), email
          us. We may check that it’s really you, and we reply within 15 days.
        </p>
        <p>
          You can take back your consent at any time. Because QuizMatter needs these details to work, taking it back
          means deleting your account.
        </p>
      </LegalSection>

      <LegalSection title="10. Students and children">
        <p>
          QuizMatter is for teachers 18 and over. Students don’t make accounts. Please don’t put students’ personal
          information in presentations, like full names with grades, photos or addresses. If you think a child’s
          information is on QuizMatter, tell us and we’ll remove it.
        </p>
      </LegalSection>

      <LegalSection title="11. Changes to this policy">
        <p>
          When this policy changes, we post the new version here with a new date. For big changes, we also tell you by
          email or with a notice in QuizMatter.
        </p>
      </LegalSection>

      <LegalSection title="12. Contact us">
        <p>
          Email: <SupportEmail />
        </p>
        <p>
          Facebook:{" "}
          <a href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer">
            QuizMatter on Facebook
          </a>
        </p>
        <p>
          If we don’t fix a privacy problem, you can complain to the National Privacy Commission:{" "}
          <a href="https://privacy.gov.ph" target="_blank" rel="noopener noreferrer">
            privacy.gov.ph
          </a>
          .
        </p>
        <p>
          See also our <Link href="/terms">Terms of Use</Link>.
        </p>
      </LegalSection>
    </>
  );
}
