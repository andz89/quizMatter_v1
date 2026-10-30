import type { Metadata } from "next";
import Link from "next/link";
import { WrenchIcon } from "lucide-react";
import { LinkPending } from "@/components/LinkPending";
import { Logo } from "@/components/Logo";
import { SupportEmail } from "@/components/SupportEmail";
import { getMaintenanceStatus } from "@/lib/maintenance";

export const metadata: Metadata = { title: "Under maintenance · QuizMatter" };

/**
 * Where everyone but the super admin goes during maintenance (src/proxy.ts sends them, and MaintenanceWatch sends a
 * tab that was already open). Open without a login. The proxy sends it to / once maintenance is off; it doesn't
 * redirect by itself, so the two can't bounce between each other while their remembered status differs (up to 60
 * seconds): it says "QuizMatter is back" instead.
 */
export default async function MaintenancePage() {
  const status = await getMaintenanceStatus();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-16">
      <Logo size={44} />
      <div className="w-full max-w-xl rounded-card border border-border-default bg-bg-surface px-5 py-8 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
          <WrenchIcon size={24} />
        </span>
        <h1 className="text-xl font-extrabold text-text-primary">
          {status.isOn ? "We're making QuizMatter better" : "QuizMatter is back"}
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          {status.isOn
            ? "QuizMatter is under maintenance right now. Your saved work is safe. Please come back in a little while."
            : "Maintenance is over. You can use QuizMatter again."}
        </p>
        {status.isOn && status.message && (
          <p className="mt-4 rounded-input bg-bg-page px-4 py-3 text-sm break-words whitespace-pre-line text-text-primary">{status.message}</p>
        )}
        <Link
          href="/"
          className="mt-5 inline-flex items-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
        >
          {status.isOn ? "Try again" : "Go to home"}
          <LinkPending />
        </Link>
        <p className="mt-6 text-sm text-text-secondary">
          Need help? <SupportEmail />
        </p>
      </div>
    </main>
  );
}
