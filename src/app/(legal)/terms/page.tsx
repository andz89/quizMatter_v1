import type { Metadata } from "next";
import Link from "next/link";
import { SupportEmail } from "@/components/SupportEmail";
import { LegalSection, LegalTitle, ShortVersion } from "../LegalParts";

export const metadata: Metadata = { title: "Terms of Use · QuizMatter" };

// Written to be true to the code (docs/superpowers/specs/2026-10-27-privacy-and-terms-design.md). A change here changes
// LEGAL_VERSION (src/lib/legal.ts) in the same commit.
export default function TermsPage() {
  return (
    <>
      <LegalTitle title="Terms of Use" />

      <ShortVersion>
        <ul>
          <li>QuizMatter is free.</li>
          <li>You own what you make, and you answer for it.</li>
          <li>Credit other people’s work when you use it.</li>
          <li>Be kind, and follow the law.</li>
          <li>We can remove content and accounts that break the rules.</li>
          <li>QuizMatter comes “as is”, with no promise that it always works.</li>
        </ul>
      </ShortVersion>

      <LegalSection title="1. Who we are, and agreeing to these Terms">
        <p>
          QuizMatter is run by its founder (named in our <Link href="/privacy">Privacy Policy</Link>), in the
          Philippines.
        </p>
        <p>
          When you tick the box at sign up, or use QuizMatter, you agree to these Terms and to the Privacy Policy. An
          agreement made online counts like a signed one (the Electronic Commerce Act, Republic Act No. 8792).
        </p>
      </LegalSection>

      <LegalSection title="2. Who can use QuizMatter">
        <ul>
          <li>Teachers who are 18 or older.</li>
          <li>One account per person.</li>
          <li>Your details must be true.</li>
          <li>Keep your password secret. You answer for what is done with your account.</li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Free, and giving">
        <p>QuizMatter is free.</p>
        <p>
          Giving through the “Keep QuizMatter free” box is a voluntary gift. It doesn’t buy anything or give you extra
          features. A gift can’t be refunded, except for a clear mistake (like a wrong amount): email us and we’ll try
          to send it back. QuizMatter isn’t a registered charity, so a gift can’t be deducted from your taxes.
        </p>
        <p>
          Only give through the box in QuizMatter. QuizMatter never asks for money through a QR code in a presentation
          or a message.
        </p>
      </LegalSection>

      <LegalSection title="4. Your content">
        <p>You keep ownership of what you make.</p>
        <p>
          You give QuizMatter a free, worldwide, <em>non-exclusive license</em> (means: a permission that doesn’t stop
          you from giving the same permission to others) to store, copy, show and process your content so QuizMatter
          works: saving, previews, presenting and backups.
        </p>
        <p>
          <strong>When you publish a presentation</strong>, other teachers may view it, present it, save it, make their
          own copy, change it for their teaching, share their copy again and submit it to QuizMatter, as long as they
          credit you. Copies already made stay when you make yours private or delete it.
        </p>
      </LegalSection>

      <LegalSection title="5. Credit and responsibility">
        <p>
          You must have the right to use everything you put in QuizMatter (pictures, text, other people’s work), and
          you answer for it.
        </p>
        <p>
          <strong>
            If you copy or change someone else’s work, put the original author in the Author box or credit them on the
            slides. If you don’t, you alone answer for it; QuizMatter isn’t responsible.
          </strong>
        </p>
        <p>
          QuizMatter doesn’t check everything before it’s published. As far as the law allows, QuizMatter isn’t
          responsible for what teachers make.
        </p>
        <p>
          Using work for teaching can count as <em>fair use</em> (means: using a small part of someone’s work without
          asking, for a fair reason like teaching) under the Intellectual Property Code (Republic Act No. 8293), but
          not always. When in doubt, credit the source or leave it out.
        </p>
      </LegalSection>

      <LegalSection title="6. Editors">
        <p>
          A teacher becomes an editor only after agreeing to it. Editors review QuizMatter lessons and submit their own
          presentations to QuizMatter. Being an editor means:
        </p>
        <ul>
          <li>Your full name, province and city or town, educational background and bio always show on your profile page.</li>
          <li>
            <strong>
              Your name, email and the review date show on every QuizMatter lesson you review, to every logged-in
              teacher, and stay there even after your account is deleted.
            </strong>
          </li>
          <li>
            When an admin approves your submission, QuizMatter may keep, change, publish and share that lesson with
            every teacher for good, even after your account is deleted, with you as Author.
          </li>
          <li>Your changes in a review become part of the lesson.</li>
          <li>Editors don’t publish to other teachers; they submit to QuizMatter instead.</li>
          <li>
            You may add a profile photo. It must be a photo of yourself and suitable for a school. Any admin can remove
            it.
          </li>
          <li>An admin can take the editor role away.</li>
        </ul>
      </LegalSection>

      <LegalSection title="7. Rules">
        <p>Don’t put in, or do, any of these:</p>
        <ul>
          <li>anything illegal;</li>
          <li>other people’s work copied without permission or credit;</li>
          <li>
            anything sexual, violent, hateful, bullying or unsafe for children (content that sexually exploits children
            is reported to the authorities);
          </li>
          <li>students’ personal information;</li>
          <li>spam, ads, scams or payment QR codes;</li>
          <li>
            hacking, bots, <em>scraping</em> (means: copying QuizMatter’s content in bulk with a program), getting around
            limits, or making a new account to get around a ban;
          </li>
          <li>pretending to be someone else.</li>
        </ul>
      </LegalSection>

      <LegalSection title="8. Reports, limits and bans">
        <p>
          Teachers can report a presentation. Admins may hide or delete content, and pause or ban accounts that break
          the rules.
        </p>
        <p>
          Clicking a feature too fast pauses it for a while. Doing it again and again can ban the account
          automatically. If you think a ban is a mistake, email us.
        </p>
      </LegalSection>

      <LegalSection title="9. QuizMatter’s content and credits">
        <p>
          You may use, show and print QuizMatter lessons, the drawing library and the shared photos for teaching,
          including in your presentations. Don’t sell them or claim them as your own, and keep the credits on photos.
        </p>
        <p>
          <strong>Credits:</strong>
        </p>
        <ul>
          <li>Some drawings of children: Designed by gstudioimagen / Freepik.</li>
          <li>Photos: each shared photo’s source is shown with it.</li>
          <li>Icons: Lucide.</li>
          <li>Fonts: Lexend and Bricolage Grotesque.</li>
        </ul>
        <p>
          If you think something on QuizMatter breaks your copyright, email us with the details. We’ll look at it and
          take it down if you’re right.
        </p>
      </LegalSection>

      <LegalSection title="10. “As is”">
        <p>
          QuizMatter is free and comes <em>“as is”</em> (means: the way it is, with no promises). It may change, pause
          or stop, and data may be lost. Keep your own copies of important work. We don’t promise it will always work
          or have no mistakes.
        </p>
      </LegalSection>

      <LegalSection title="11. Limits on liability">
        <p>
          As far as Philippine law allows, QuizMatter isn’t <em>liable</em> (means: doesn’t have to pay) for indirect
          losses or lost content, and the most it has to pay in total is ₱1,000. This never covers fraud, bad faith or
          gross negligence (means: extreme carelessness), which the law doesn’t let anyone excuse (Civil Code, Article
          1171).
        </p>
      </LegalSection>

      <LegalSection title="12. Ending">
        <p>
          You can stop using QuizMatter anytime and ask us to delete your account. We can suspend or close accounts that
          break these Terms. If QuizMatter shuts down, we’ll try to tell you at least 30 days before.
        </p>
      </LegalSection>

      <LegalSection title="13. Changes to these Terms">
        <p>
          When these Terms change, we post the new version here with a new date. For big changes, we also tell you by
          email or with a notice in QuizMatter.
        </p>
      </LegalSection>

      <LegalSection title="14. Law and disputes">
        <p>
          These Terms follow Philippine law. If there’s a problem, email us first, and we’ll try to settle it within 30
          days. If we can’t, it goes to the proper courts of the Philippines.
        </p>
      </LegalSection>

      <LegalSection title="15. Contact">
        <p>
          Email: <SupportEmail />
        </p>
      </LegalSection>
    </>
  );
}
