import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { getAccount } from "@/lib/account";
import { createClient } from "@/lib/supabase/server";
import { ConsentButtons } from "./ConsentButtons";

/**
 * The OAuth consent page: when someone clicks Connect on the QuizMatter connector in claude.ai, Supabase (our OAuth
 * server) sends them here with an `authorization_id`. They're logged in first (the proxy sends them to /login and
 * back), then they choose Allow or Deny, and Supabase sends them back to Claude. For now only admins can allow.
 */
export default async function ConsentPage({ searchParams }: PageProps<"/oauth/consent">) {
  const { authorization_id: authorizationId } = await searchParams;
  const supabase = await createClient();
  const [{ data, error }, account] = await Promise.all([
    typeof authorizationId === "string"
      ? supabase.auth.oauth.getAuthorizationDetails(authorizationId)
      : Promise.resolve({ data: null, error: true }),
    getAccount(),
  ]);

  // They already allowed this app before: straight back to it.
  if (data && "redirect_url" in data) redirect(data.redirect_url);

  if (error || !data || typeof authorizationId !== "string") {
    return (
      <ConsentCard title="This link doesn't work anymore">
        <p className="text-sm text-text-secondary">Go back to Claude and click Connect again.</p>
      </ConsentCard>
    );
  }

  const appName = data.client.name || "An app";
  if (!account.isAdmin) {
    return (
      <ConsentCard title={`Connect ${appName}`}>
        <p className="mb-5 text-sm text-text-secondary">
          Only QuizMatter admins can connect Claude right now. You can go back without connecting.
        </p>
        <ConsentButtons authorizationId={authorizationId} canAllow={false} />
      </ConsentCard>
    );
  }

  return (
    <ConsentCard title={`Connect ${appName}`}>
      <p className="mb-3 text-sm text-text-primary">
        <span className="font-semibold">{appName}</span> wants to use your QuizMatter account
        {account.email && <span className="text-text-secondary"> ({account.email})</span>}.
      </p>
      <p className="mb-5 text-sm text-text-secondary">
        It can search the photo library and send you presentations as drafts. Nothing is saved until you click Save.
      </p>
      <ConsentButtons authorizationId={authorizationId} canAllow />
    </ConsentCard>
  );
}

function ConsentCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4">
      <Logo size={36} />
      <div className="w-full max-w-sm rounded-card border border-border-default bg-bg-surface px-5 py-6">
        <h1 className="mb-3 text-base font-extrabold text-text-primary">{title}</h1>
        {children}
      </div>
    </main>
  );
}
