import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { NavBar, navLinkClass } from "@/components/NavBar";
import { LinkPending } from "@/components/LinkPending";
import { getAccount } from "@/lib/account";
import { createClient } from "@/lib/supabase/server";
import { GRADES, OTHER_CHOICE, SUBJECTS, isOtherGrade, isOtherSubject } from "@/lib/schema";
import { DEFAULT_SEARCH, homeSearchQuery, type HomeSearch } from "../homeSearch";

const COLUMNS = [...SUBJECTS, OTHER_CHOICE] as const;
const ROWS = [...GRADES, OTHER_CHOICE] as const;

const countsSchema = z.array(z.object({ grade: z.string(), subject: z.string(), count: z.coerce.number() }));

/**
 * Grades down the side, subjects across the top, and in each square how many shared presentations (From QuizMatter
 * and other teachers') fit. A square, grade or subject opens the home page's search for it.
 */
export default async function BrowsePage() {
  // Banned: the home page says so (see page.tsx).
  if ((await getAccount()).isBanned) redirect("/");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("browse_counts");
  if (error) throw error;

  // "Grade|Subject" → how many. Grades and subjects not on their lists add up under "Other".
  const counts = new Map<string, number>();
  for (const row of countsSchema.parse(data)) {
    const key = `${isOtherGrade(row.grade) ? OTHER_CHOICE : row.grade}|${isOtherSubject(row.subject) ? OTHER_CHOICE : row.subject}`;
    counts.set(key, (counts.get(key) ?? 0) + row.count);
  }
  const searchLink = (change: Partial<HomeSearch>) => `/${homeSearchQuery({ ...DEFAULT_SEARCH, ...change })}`;

  return (
    <>
      <NavBar>
        <Link href="/" className={navLinkClass}>
          Home
          <LinkPending />
        </Link>
      </NavBar>

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-extrabold text-text-primary">Browse presentations</h1>
          <p className="mt-1 text-sm text-text-secondary">
            How many shared presentations each grade and subject has. Click a number to see them.
          </p>
        </header>

        {/* Only the table scrolls sideways on small screens, not the page. */}
        <div className="overflow-x-auto rounded-card border border-border-default bg-bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border-default">
                <th className="px-4 py-3" />
                {COLUMNS.map((subject) => (
                  <th key={subject} className="px-2 py-3 align-bottom">
                    <BrowseLink
                      href={searchLink({ subject })}
                      className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase hover:text-accent"
                    >
                      {subject}
                    </BrowseLink>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((grade) => (
                <tr key={grade} className="border-b border-border-default last:border-b-0">
                  <th className="px-4 py-2 text-left whitespace-nowrap">
                    <BrowseLink href={searchLink({ grade })} className="font-semibold text-text-primary hover:text-accent">
                      {grade}
                    </BrowseLink>
                  </th>
                  {COLUMNS.map((subject) => {
                    const count = counts.get(`${grade}|${subject}`) ?? 0;
                    return (
                      <td key={subject} className="px-2 py-2 text-center">
                        {count > 0 ? (
                          <BrowseLink
                            href={searchLink({ grade, subject })}
                            className="inline-flex min-w-9 justify-center rounded-dropdown bg-accent-soft px-2 py-1 font-semibold text-accent hover:bg-accent hover:text-white"
                          >
                            {count}
                          </BrowseLink>
                        ) : (
                          <span className="text-text-secondary">–</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}

function BrowseLink({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  return (
    <Link href={href} className={className}>
      {children}
      <LinkPending />
    </Link>
  );
}
