import Link from "next/link";
import { LinkPending } from "@/components/LinkPending";
import { NavBar, navLinkClass } from "@/components/NavBar";
import { getAccount } from "@/lib/account";
import { PasswordForm, PersonalDetailsForm, ProfileForm } from "./AccountForms";

/** Account settings: display name, personal details and password. */
export default async function AccountPage() {
  const account = await getAccount();

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
        </header>

        <div className="flex flex-col gap-5">
          <ProfileForm email={account.email} displayName={account.displayName} />
          <PersonalDetailsForm profile={account.profile} />
          <PasswordForm />
        </div>
      </main>
    </>
  );
}
