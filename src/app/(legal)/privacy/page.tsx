import type { Metadata } from "next";
import { SupportEmail } from "@/components/SupportEmail";

export const metadata: Metadata = { title: "Privacy Policy · QuizMatter" };

// A placeholder until the real policy is written.
export default function PrivacyPage() {
  return (
    <>
      <h1 className="text-2xl font-extrabold text-text-primary">Privacy Policy</h1>
      <p className="mt-3 text-sm text-text-secondary">We&apos;re still writing this page.</p>
      <p className="mt-4 text-sm text-text-secondary">
        Questions? Email us: <SupportEmail />
      </p>
    </>
  );
}
