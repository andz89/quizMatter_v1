"use client";

import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlertIcon } from "lucide-react";
import { LinkPending } from "@/components/LinkPending";

// Shown when a page breaks while it loads. "Try again" loads it once more.
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-16">
      <div className="rounded-card border border-border-default bg-bg-surface px-5 py-8 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger-strong">
          <TriangleAlertIcon size={24} />
        </span>
        <h1 className="text-xl font-extrabold text-text-primary">Something went wrong</h1>
        <p className="mt-2 text-sm text-text-secondary">This page didn&apos;t load. Please try again.</p>
        <div className="mt-5 flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => retry()}
            className="rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            Try again
          </button>
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-accent hover:underline">
            Go to home
            <LinkPending />
          </Link>
        </div>
      </div>
    </main>
  );
}
