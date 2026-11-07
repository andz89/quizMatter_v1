"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Spinner } from "@/components/Spinner";
import { TopLoadingBar } from "@/components/TopLoadingBar";
import { forgetAnnouncements } from "@/lib/announcements";
import { createClient } from "@/lib/supabase/client";

/** The email link page's Continue: sends its form (openEmailLink), with the Spinner and top line while it works. */
export function ContinueButton() {
  const { pending } = useFormStatus();
  return (
    <>
      <button
        type="submit"
        disabled={pending}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-button bg-accent btn-press px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
      >
        {pending && <Spinner size={14} />}
        Continue
      </button>
      {pending && <TopLoadingBar />}
    </>
  );
}

/** Logs out like the account menu does, then shows the same page again (now with Continue). */
export function LogOutButton() {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const logOut = async () => {
    setIsLoggingOut(true);
    const { error } = await createClient().auth.signOut();
    if (error) {
      toast.error("Couldn't log out. Please try again.");
      setIsLoggingOut(false);
      return;
    }
    forgetAnnouncements();
    router.refresh();
  };
  return (
    <>
      <button
        type="button"
        onClick={logOut}
        disabled={isLoggingOut}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-button border border-border-default bg-bg-surface px-4 py-2.5 text-sm font-semibold text-text-primary hover:bg-accent-soft disabled:opacity-60"
      >
        {isLoggingOut && <Spinner size={14} />}
        Log out
      </button>
      {isLoggingOut && <TopLoadingBar />}
    </>
  );
}
