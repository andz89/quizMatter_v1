"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Spinner } from "@/components/Spinner";
import { answerConsent } from "./actions";

/** Allow / Deny. On success the server action sends the browser back to Claude, so the spinner stays until then. */
export function ConsentButtons({ authorizationId, canAllow }: { authorizationId: string; canAllow: boolean }) {
  const [answer, setAnswer] = useState<"allow" | "deny" | null>(null);
  const [isPending, startTransition] = useTransition();

  const choose = (allow: boolean) => {
    setAnswer(allow ? "allow" : "deny");
    startTransition(async () => {
      const error = await answerConsent(authorizationId, allow);
      if (error) {
        toast.error(error);
        setAnswer(null);
      }
    });
  };

  const busy = isPending || answer !== null;
  return (
    <div className="flex gap-3">
      <button
        type="button"
        disabled={busy}
        onClick={() => choose(false)}
        className="flex flex-1 items-center justify-center gap-2 rounded-button border border-border-default px-4 py-2.5 text-sm font-semibold text-text-primary hover:bg-accent-soft disabled:opacity-60"
      >
        {answer === "deny" && <Spinner size={16} />}
        {canAllow ? "Deny" : "Back to Claude"}
      </button>
      {canAllow && (
        <button
          type="button"
          disabled={busy}
          onClick={() => choose(true)}
          className="flex flex-1 items-center justify-center gap-2 rounded-button bg-accent btn-press px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
        >
          {answer === "allow" && <Spinner size={16} />}
          Allow
        </button>
      )}
    </div>
  );
}
