"use client";

import { useEffect, useState, type ReactNode } from "react";
import { isPeopleArtLoaded, loadPeopleArt } from "@/lib/peopleArt";
import { Spinner } from "./Spinner";
import { TopLoadingBar } from "./TopLoadingBar";

/**
 * Holds back a presentation until the people art it uses has downloaded (see peopleArt.ts), so it never opens
 * with pictures missing. `needed` = it uses them; without them it shows right away. `fill`: the wait fills its box
 * (e.g. one slide in a card) instead of the whole screen.
 */
export function PeopleArtGate({ needed, fill = false, children }: { needed: boolean; fill?: boolean; children: ReactNode }) {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(() => (needed && !isPeopleArtLoaded() ? "loading" : "ready"));

  useEffect(() => {
    if (status === "loading") loadPeopleArt().then(() => setStatus("ready"), () => setStatus("failed"));
  }, [status]);

  if (status === "ready") return children;

  return (
    <div className={`flex ${fill ? "h-full" : "min-h-screen"} flex-col items-center justify-center gap-4 bg-bg-page px-4`}>
      {status === "loading" ? (
        <>
          <TopLoadingBar />
          <Spinner size={32} />
        </>
      ) : (
        <>
          <p className="text-sm text-text-primary">Couldn&apos;t load this presentation.</p>
          <button
            type="button"
            onClick={() => setStatus("loading")}
            className="rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            Try again
          </button>
        </>
      )}
    </div>
  );
}
