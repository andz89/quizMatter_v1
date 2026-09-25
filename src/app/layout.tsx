import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "quizMatter",
  description: "Build lessons with quizzes built in.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        {/* Pop-up messages (toast() from "sonner"), styled like the app's cards. */}
        <Toaster
          position="bottom-center"
          toastOptions={{
            style: {
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
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
