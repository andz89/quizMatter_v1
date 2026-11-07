import Link from "next/link";
import { redirect } from "next/navigation";
import { LinkPending } from "@/components/LinkPending";
import { Logo } from "@/components/Logo";
import { BAD_LINK_DESTINATION, claimEmail, emailLinkSchema } from "@/lib/emailLinks";
import { createClient } from "@/lib/supabase/server";
import { openEmailLink } from "./actions";
import { ContinueButton, LogOutButton } from "./ConfirmButtons";

/**
 * The link in our two emails opens this (Supabase dashboard → Authentication → Emails, and locally
 * supabase/templates/recovery.html): {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email (sign up) or
 * type=recovery (Forgot password). Opening it uses nothing up: mail scanners (Outlook's Safe Links, school mail
 * filters) open every link before the teacher does, so only the Continue button (openEmailLink) uses the link.
 * Logged in, it says to log out first, so a link never swaps the browser into another account.
 */
export default async function EmailLinkPage({ searchParams }: PageProps<"/auth/confirm">) {
  const { token_hash, type, retry } = await searchParams;
  const link = emailLinkSchema.safeParse({ token_hash, type });
  if (!link.success) redirect(BAD_LINK_DESTINATION);

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = Boolean(data?.claims);
  const email = claimEmail(data?.claims);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
      <Logo size={44} />
      <div className="w-full max-w-sm rounded-card border border-border-default bg-bg-surface px-5 py-6 text-center">
        <h1 className="text-base font-extrabold text-text-primary">One more step</h1>
        {isLoggedIn ? (
          <>
            <p className="mt-2 text-sm text-text-primary">
              You&apos;re logged in{email && (
                <>
                  {" "}
                  as <span className="font-semibold">{email}</span>
                </>
              )}
              . To use this link, log out first.
            </p>
            <LogOutButton />
            <Link href="/" className="mt-4 inline-block text-sm font-semibold text-accent hover:underline">
              Go to home
              <LinkPending />
            </Link>
          </>
        ) : (
          <form action={openEmailLink}>
            <p className="mt-2 text-sm text-text-primary">
              {link.data.type === "recovery"
                ? "Click Continue to set a new password."
                : "Click Continue to finish making your account."}
            </p>
            {/* openEmailLink sends it back here when Supabase can't be reached. */}
            {retry === "1" && (
              <p className="mt-3 text-sm text-danger-strong">
                Something went wrong on our side. Your link still works, so click Continue to try again.
              </p>
            )}
            <input type="hidden" name="token_hash" value={link.data.token_hash} />
            <input type="hidden" name="type" value={link.data.type} />
            <ContinueButton />
          </form>
        )}
      </div>
    </main>
  );
}
