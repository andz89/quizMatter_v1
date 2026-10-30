import type { Metadata } from "next";
import { Bricolage_Grotesque, Lexend } from "next/font/google";
import { Toaster } from "sonner";
import { ClickPauseNotice } from "@/components/ClickPauseNotice";
import { DevRequestCounter } from "@/components/DevRequestCounter";
import { Footer } from "@/components/Footer";
import { MaintenanceBar } from "@/components/MaintenanceBar";
import { MaintenanceWatch } from "@/components/MaintenanceWatch";
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
        {/* Maintenance announced ahead (everyone), or on (only the super admin sees the app then). */}
        <MaintenanceBar />
        {children}
        {/* Facebook, the support email, Privacy and Terms; not on the editor pages. */}
        <Footer />
        {/* A feature paused for clicking too fast (e.g. bookmarks): a notice at the bottom. */}
        <ClickPauseNotice />
        {/* Sends an open tab to /maintenance when a request is refused for maintenance. */}
        <MaintenanceWatch />
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
