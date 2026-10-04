import type { Metadata } from "next";
import { Bricolage_Grotesque, Lexend } from "next/font/google";
import { Toaster } from "sonner";
import { ClickPauseNotice } from "@/components/ClickPauseNotice";
import { DevRequestCounter } from "@/components/DevRequestCounter";
import "./globals.css";

// Lexend for text (made for easy reading, good for young readers); Bricolage Grotesque for headings.
const lexend = Lexend({
  variable: "--font-lexend",
  subsets: ["latin"],
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "QuizMatter",
  description: "Build presentations with quizzes built in.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${lexend.variable} ${bricolage.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        {/* A feature paused for clicking too fast (e.g. bookmarks): a notice at the bottom. */}
        <ClickPauseNotice />
        {/* On localhost only: how many requests the page sends (bottom-left). */}
        <DevRequestCounter />
        {/* Pop-up messages (toast() from "sonner"), styled like the app's cards. */}
        <Toaster
          position="bottom-center"
          toastOptions={{
            style: {
              background: "var(--bg-surface)",
              border: "1.5px solid var(--border-default)",
              borderRadius: "var(--radius-card)",
              color: "var(--text-primary)",
              fontFamily: "inherit",
              fontSize: "14px",
              boxShadow: "none",
            },
          }}
        />
      </body>
    </html>
  );
}
