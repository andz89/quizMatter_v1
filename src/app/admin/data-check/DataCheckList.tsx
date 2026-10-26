"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { SearchIcon } from "lucide-react";
import { LinkPending } from "@/components/LinkPending";
import { Spinner } from "@/components/Spinner";
import { checkSavedData, type DataProblem } from "./actions";

/** A button that checks every saved presentation and review draft, then lists the ones that can't be opened. */
export function DataCheckList() {
  // The last check's result; null until the button is clicked.
  const [result, setResult] = useState<{ checked: number; problems: DataProblem[] } | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const handleCheck = async () => {
    setIsChecking(true);
    const found = await checkSavedData().catch(() => "Couldn't check the saved data. Please try again.");
    setIsChecking(false);
    if (typeof found === "string") {
      toast.error(found);
      return;
    }
    setResult(found);
  };

  return (
    <>
      <div className="-mb-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleCheck}
          disabled={isChecking}
          className="flex items-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
        >
          {isChecking ? <Spinner size={16} /> : <SearchIcon size={16} />}
          {result ? "Check again" : "Check saved data"}
        </button>
        {result && result.problems.length === 0 && (
          <span className="rounded-dropdown bg-success-soft px-2 py-0.5 text-[13px] font-semibold text-success-strong">
            All {result.checked} presentations and review drafts can be opened.
          </span>
        )}
      </div>
      {result && result.problems.length > 0 && (
        <section className="rounded-card border border-border-default bg-bg-surface px-5 py-4">
          <h2 className="mb-3 text-[15px] font-extrabold text-text-primary">
            Can&apos;t be opened ({result.problems.length} of {result.checked})
          </h2>
          <div className="overflow-hidden rounded-card border border-border-default">
            <div className={`grid ${PROBLEM_COLUMNS} items-center gap-4 border-b border-border-default px-4 py-3 text-[11px] font-bold tracking-[0.05em] text-text-header uppercase`}>
              <span>Presentation</span>
              <span className="hidden sm:block">Owner</span>
              <span className="hidden sm:block">Slide</span>
              <span>Problem</span>
            </div>
            {result.problems.map((problem) => (
              <div
                key={`${problem.id}-${problem.isReviewDraft}`}
                className={`grid min-h-13 ${PROBLEM_COLUMNS} items-center gap-4 border-b border-border-default px-4 py-2 text-sm last:border-b-0`}
              >
                <div className="min-w-0">
                  <Link
                    href={
                      !problem.isReviewDraft
                        ? `/presentation/${problem.id}`
                        : problem.isSubmitted
                          ? `/admin/presentations/reviews/${problem.id}`
                          : "/admin/presentations/reviews"
                    }
                    className="font-semibold text-accent hover:underline"
                  >
                    {problem.title || "Untitled presentation"}
                    <LinkPending />
                  </Link>
                  {problem.isReviewDraft && <span className="ml-2 text-[13px] text-text-secondary">(review draft)</span>}
                </div>
                <span className="hidden truncate text-text-secondary sm:block">{problem.owner}</span>
                <span className="hidden text-text-primary sm:block">{problem.slide ?? "—"}</span>
                <span className="min-w-0 break-words text-text-primary">{problem.message}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// Presentation, owner, slide, problem. On phones: presentation and problem only.
const PROBLEM_COLUMNS = "grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_180px_60px_minmax(0,1.5fr)]";
