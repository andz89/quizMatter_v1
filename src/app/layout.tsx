import type { Metadata } from "next";
import { Bricolage_Grotesque, Lexend } from "next/font/google";
import { Toaster } from "sonner";
import { Announcements } from "@/components/Announcements";
import { ClickPauseNotice } from "@/components/ClickPauseNotice";
import { DevRequestCounter } from "@/components/DevRequestCounter";
import { Footer } from "@/components/Footer";
import { MaintenanceBar } from "@/components/MaintenanceBar";
import { MaintenanceWatch } from "@/components/MaintenanceWatch";
import { PresentationModalProvider } from "./PresentationModal";
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
  // Link pictures (opengraph-image) need full addresses; shared links always point to the live site.
  metadataBase: new URL("https://quizmatter.com"),
  // Each page sets a short title ("Saved"), shown as "Saved · QuizMatter"; pages without one show "QuizMatter".
  title: { default: "QuizMatter", template: "%s · QuizMatter" },
  description: "Build presentations with quizzes built in.",
  openGraph: { siteName: "QuizMatter", type: "website" },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${lexend.variable} ${bricolage.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {/* Maintenance announced ahead (everyone), or on (only the super admin sees the app then). */}
        <MaintenanceBar />
        {/* The super admin's announcements for chosen teachers: bars on top, a modal (only when one is live). */}
        <Announcements />
        {/* A card of someone else's presentation opens it in a modal over the page (PresentationModal.tsx). */}
        <PresentationModalProvider>{children}</PresentationModalProvider>
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
