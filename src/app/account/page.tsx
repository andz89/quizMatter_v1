import Link from "next/link";
import { LinkPending } from "@/components/LinkPending";
import { NavBar, navLinkClass } from "@/components/NavBar";
import { getAccount } from "@/lib/account";
import { profileHref } from "@/lib/profiles";
import { createClient } from "@/lib/supabase/server";
import { PasswordForm, PersonalDetailsForm, ProfileForm, ProfileLinks } from "./AccountForms";
import { ProfilePhotoForm } from "./ProfilePhotoForm";

/**
 * Account settings: the profile photo (editors only), display name, personal details (with the bio), password, and
 * links to your profile page.
 */
export default async function AccountPage() {
  const account = await getAccount();
  const photo = account.isEditor ? await loadMyProfilePhoto() : null;

  return (
    <>
      <NavBar>
        <Link href="/" className={navLinkClass}>
          Home
          <LinkPending />
        </Link>
      </NavBar>

      <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-extrabold text-text-primary">Account settings</h1>
          <p className="mt-1 text-sm text-text-secondary">Your name, details and password.</p>
          {/* Teachers can't open an admin's profile, so admins get no link to share. The link comes from the display name. */}
          {!account.isAdmin &&
            (account.profileSlug ? (
              <ProfileLinks href={profileHref(account.profileSlug)} />
            ) : (
              <p className="mt-3 text-sm text-text-secondary">Add a display name to get a profile link.</p>
            ))}
        </header>

        <div className="flex flex-col gap-5">
          {photo && <ProfilePhotoForm src={photo.src} leftToday={photo.left_today} />}
          <ProfileForm email={account.email} displayName={account.displayName} nextNameChangeAt={account.nextNameChangeAt} />
          <PersonalDetailsForm profile={account.profile} />
          <PasswordForm />
        </div>
      </main>
    </>
  );
}

/** My profile photo ('' when none) and how many changes are left today; null if the read failed (no box then). */
async function loadMyProfilePhoto() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_profile_photo").maybeSingle<{ src: string; left_today: number }>();
  if (error) console.error("Couldn't read the profile photo:", error);
  return data;
}
