import Link from "next/link";
import { notFound } from "next/navigation";
import { LinkPending } from "@/components/LinkPending";
import { NavBar, navLinkClass } from "@/components/NavBar";
import { educationLine, loadTeacherProfile } from "@/lib/profiles";
import { createClient } from "@/lib/supabase/server";

/**
 * A teacher's profile: display name, full name, educational background and bio. Any logged-in user can open it with
 * the link (the proxy sends logged-out people to log in first). Never the contact number or email: see
 * loadTeacherProfile.
 */
export default async function TeacherProfilePage({ params }: PageProps<"/teachers/[id]">) {
  const { id } = await params;
  const profile = await loadTeacherProfile(await createClient(), id);
  if (!profile) notFound();

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

      <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-10">
        <article className="flex flex-col gap-5 rounded-card border border-border-default bg-bg-surface px-5 py-6">
          <header>
            <h1 className="text-2xl font-extrabold text-text-primary">{heading}</h1>
            {fullName && fullName !== heading && <p className="mt-1 text-sm text-text-secondary">{fullName}</p>}
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
      </main>
    </>
  );
}

const labelClass = "font-sans text-[11px] font-bold tracking-[0.05em] text-text-header uppercase";
