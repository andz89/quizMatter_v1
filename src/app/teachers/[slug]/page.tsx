import Link from "next/link";
import { notFound } from "next/navigation";
import { PhotoThumbnail } from "@/components/editor/PhotoTile";
import { LinkPending } from "@/components/LinkPending";
import { NavBar, navLinkClass } from "@/components/NavBar";
import { loadEditorPresentationIds } from "@/lib/lessons";
import { educationLine, loadSharedPresentationIds, loadTeacherProfile } from "@/lib/profiles";
import { DAYS, GRADES, SUBJECTS, TERMS, WEEKS, listOrder } from "@/lib/schema";
import { createClient } from "@/lib/supabase/server";
import { loadCardRows, toSavableCards, type CardPresentation } from "../../(home)/cards";
import type { PresentationCardData } from "../../PresentationCard";
import { SavableCardGrid } from "../../SavableCardGrid";

/**
 * A teacher's profile, at /teachers/<link name> (made from their display name): an editor's photo, display name, full
 * name, educational background and bio. Any logged-in user can open it with the link (the proxy sends logged-out people to log in
 * first). Never the contact number or email: see loadTeacherProfile. Below it, the QuizMatter presentations they made
 * as an editor, by subject, then grade (see the lesson_week migration), and the presentations they published, last
 * changed first (see the teacher_shared_presentations migration; editors can't publish, so they have none).
 */
export default async function TeacherProfilePage({ params }: PageProps<"/teachers/[slug]">) {
  const { slug } = await params;
  const supabase = await createClient();
  const [profile, lessonIds, sharedIds] = await Promise.all([
    loadTeacherProfile(supabase, slug),
    loadEditorPresentationIds(supabase, slug),
    loadSharedPresentationIds(supabase, slug),
  ]);
  if (!profile) notFound();
  // Both lists' cards in one go (loadCardRows keeps the ids' order), then split.
  const rows = await loadCardRows(supabase, [...lessonIds, ...sharedIds]);
  const cards = await toSavableCards(supabase, rows);
  const isShared = new Set(sharedIds);
  const groups = groupLessons(rows.filter((row) => !isShared.has(row.id)), cards);
  const sharedCards = cards.filter((card) => isShared.has(card.id));

  const fullName = `${profile.firstName} ${profile.lastName}`.trim();
  const heading = profile.displayName || fullName || "QuizMatter teacher";
  const education = educationLine(profile.educationLevel, profile.educationField);

  return (
    <>
      <NavBar>
        <Link href="/" className={navLinkClass}>
          Home
          <LinkPending />
        </Link>
      </NavBar>

      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-10">
        <article className="mx-auto flex w-full max-w-2xl flex-col gap-5 rounded-card border border-border-default bg-bg-surface px-5 py-6">
          <header className="flex items-center gap-4">
            {/* An editor's photo, round (see the profile_photos migration); none = the name alone. */}
            {profile.photoSrc && (
              <PhotoThumbnail
                src={profile.photoSrc}
                alt=""
                className="h-[88px] w-[88px] shrink-0 rounded-full border border-border-default bg-bg-page object-cover"
              />
            )}
            <div>
              <h1 className="text-2xl font-extrabold text-text-primary">{heading}</h1>
              {fullName && fullName !== heading && <p className="mt-1 text-sm text-text-secondary">{fullName}</p>}
            </div>
          </header>

          {education && (
            <section>
              <h2 className={labelClass}>Educational background</h2>
              <p className="mt-1 text-sm text-text-primary">{education}</p>
            </section>
          )}

          <section>
            <h2 className={labelClass}>Bio</h2>
            {profile.bio ? (
              <p className="mt-1 text-sm whitespace-pre-line text-text-primary">{profile.bio}</p>
            ) : (
              <p className="mt-1 text-sm text-text-secondary">No bio yet.</p>
            )}
          </section>
        </article>

        {groups.length > 0 && (
          <section className="mt-8 flex flex-col gap-6">
            <h2 className="text-xl font-extrabold text-text-primary">QuizMatter presentations</h2>
            {groups.map((group) => (
              <div key={group.subject} className="flex flex-col gap-4">
                <h3 className={labelClass}>{group.subject || "No subject"}</h3>
                {group.grades.map((grade) => (
                  <div key={grade.grade} className="flex flex-col gap-2">
                    <p className="text-sm font-semibold text-text-secondary">{grade.grade || "No grade"}</p>
                    <SavableCardGrid cards={grade.cards} />
                  </div>
                ))}
              </div>
            ))}
          </section>
        )}

        {sharedCards.length > 0 && (
          <section className="mt-8 flex flex-col gap-4">
            <h2 className="text-xl font-extrabold text-text-primary">Shared presentations</h2>
            <SavableCardGrid cards={sharedCards} />
          </section>
        )}
      </main>
    </>
  );
}

const labelClass = "font-sans text-[11px] font-bold tracking-[0.05em] text-text-header uppercase";

type LessonGroup = { subject: string; grades: { grade: string; cards: PresentationCardData[] }[] };

/**
 * By subject (the list's order, a teacher's own after them A–Z, none last), then by first grade (a lesson with
 * several grades shows once), then term, week, day and title.
 */
function groupLessons(rows: CardPresentation[], cards: PresentationCardData[]): LessonGroup[] {
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const by = (list: readonly string[], a: string, b: string) => listOrder(list, a) - listOrder(list, b) || a.localeCompare(b);
  const sorted = [...rows].sort(
    (a, b) =>
      by(SUBJECTS, a.subject, b.subject) ||
      by(GRADES, a.grades[0] ?? "", b.grades[0] ?? "") ||
      by(TERMS, a.term, b.term) ||
      by(WEEKS, a.week, b.week) ||
      by(DAYS, a.day, b.day) ||
      a.title.localeCompare(b.title),
  );
  const groups: LessonGroup[] = [];
  for (const row of sorted) {
    const card = cardsById.get(row.id)!;
    const grade = row.grades[0] ?? "";
    let group = groups.at(-1);
    if (group?.subject !== row.subject) groups.push((group = { subject: row.subject, grades: [] }));
    const last = group.grades.at(-1);
    if (last?.grade === grade) last.cards.push(card);
    else group.grades.push({ grade, cards: [card] });
  }
  return groups;
}
