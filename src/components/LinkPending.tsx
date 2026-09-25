"use client";

import { useLinkStatus } from "next/link";
import { Spinner } from "./Spinner";
import { TopLoadingBar } from "./TopLoadingBar";

/**
 * Put inside a <Link>. Shows at once when the link is clicked, before the server answers:
 * the top loading line, plus a spinner placed by `spinnerClassName` (none if not given).
 */
export function LinkPending({ spinnerClassName }: { spinnerClassName?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <>
      <TopLoadingBar />
      {spinnerClassName && (
        <span className={`z-10 flex items-center justify-center ${spinnerClassName}`}>
          <Spinner size={16} />
        </span>
      )}
    </>
  );
}
