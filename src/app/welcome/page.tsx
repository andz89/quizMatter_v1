import type { Metadata } from "next";
import Link from "next/link";
import { LinkPending } from "@/components/LinkPending";
import { LoggedOutBar } from "@/components/LoggedOutBar";
import { FEATURES } from "@/components/LoginAbout";
import { getPublicLessons, type PublicLesson } from "@/lib/publicPresentation";
import { LessonCards } from "./LessonCards";

/**
 * The public home page: what logged-out visitors (and Google) see at "/" (docs/superpowers/specs/
 * 2026-11-20-public-home-and-seo-design.md). src/proxy.ts serves it there by a rewrite and sends its own address,
 * /welcome, back to "/", so it only ever has one. Logged in, "/" is the home page as before.
 */
export const metadata: Metadata = {
  title: { absolute: "QuizMatter: presentations with quizzes built in" },
  alternates: { canonical: "/" },
};

const LESSONS_SHOWN = 8;

export default async function WelcomePage() {
  // The lessons are a nice extra: if they can't be read, the page still shows without them.
  const lessons: PublicLesson[] = await getPublicLessons(LESSONS_SHOWN).catch(() => []);

  return (
    <>
      <LoggedOutBar />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-14 px-4 py-12 sm:py-16">
        <section className="mx-auto flex max-w-2xl flex-col items-center gap-5 text-center">
          <h1 className="text-3xl font-extrabold text-text-primary sm:text-5xl">Build presentations with quizzes built in</h1>
          <p className="text-base text-text-secondary">
            QuizMatter helps teachers make bright, simple lessons and quizzes that kids love to play.
          </p>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Link
              href="/signup"
              className="flex items-center justify-center rounded-button bg-accent btn-press px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover"
            >
              Sign up free
              <LinkPending />
            </Link>
            <Link
              href="/login"
              className="flex items-center justify-center rounded-button border border-border-default bg-bg-surface px-5 py-2.5 text-sm font-semibold text-text-primary hover:bg-accent-soft"
            >
              Log in
              <LinkPending />
            </Link>
          </div>
        </section>

        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ Icon, title, text }) => (
            <li key={title} className="flex flex-col gap-3 rounded-card border border-border-default bg-bg-surface px-5 py-4">
              <span className="flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent">
                <Icon size={20} />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
                <p className="mt-1 text-sm text-text-secondary">{text}</p>
              </div>
            </li>
          ))}
        </ul>

        {lessons.length > 0 && (
          <section className="flex flex-col gap-4">
            <h2 className="text-xl font-extrabold text-text-primary">Ready-made lessons from QuizMatter</h2>
            <LessonCards lessons={lessons} />
          </section>
        )}
      </main>
    </>
  );
}
