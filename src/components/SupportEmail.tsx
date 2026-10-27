"use client";

import { CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { SUPPORT_EMAIL } from "@/lib/support";

/** Copies the support address and says so in a toast. */
export async function copySupportEmail() {
  try {
    await navigator.clipboard.writeText(SUPPORT_EMAIL);
    toast.success("Support email copied.");
  } catch {
    toast.error("Couldn't copy the email. Please try again.");
  }
}

/** The support address with a Copy button. Inline, so it can sit inside a sentence ("Need help? …"). */
export function SupportEmail() {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-semibold text-text-primary select-all">{SUPPORT_EMAIL}</span>
      <button
        type="button"
        onClick={copySupportEmail}
        title="Copy the support email"
        className="inline-flex items-center gap-1 rounded-dropdown border border-border-default bg-bg-surface px-2 py-0.5 text-xs font-semibold text-text-primary transition-colors hover:bg-accent-soft hover:text-accent"
      >
        <CopyIcon size={12} />
        Copy
      </button>
    </span>
  );
}
