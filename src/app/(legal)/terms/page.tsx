import type { Metadata } from "next";
import { SupportEmail } from "@/components/SupportEmail";

export const metadata: Metadata = { title: "Terms of Use · QuizMatter" };

// A placeholder until the real terms are written.
export default function TermsPage() {
  return (
    <>
      <h1 className="text-2xl font-extrabold text-text-primary">Terms of Use</h1>
      <p className="mt-3 text-sm text-text-secondary">We&apos;re still writing this page.</p>
      <p className="mt-4 text-sm text-text-secondary">
        Questions? Email us: <SupportEmail />
      </p>
    </>
  );
}
