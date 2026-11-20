import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * The QuizMatter title card that link previews (Facebook, Messenger, Viber, Google) show
 * (docs/superpowers/specs/2026-11-20-public-presentation-preview-design.md). With `content`: a published
 * presentation's title, Author line and details. Without (null): the site's own picture. A picture can't read the
 * app's CSS variables, so the design system's colors are written here as values (same as globals.css).
 */
export const OG_SIZE = { width: 1200, height: 630 };

const PAPER = "#FAF8FF";
const VIOLET = "#6B3DF5";
const SUNNY = "#FFC233";
const INK = "#1B1530";
const MUTED = "#756E8E";
const BORDER = "#E6E1F5";

// Bricolage Grotesque ExtraBold (headings) and Lexend (text), the app's fonts, latin letters (ñ included). Read once
// per server copy. Files and their licenses: src/app/fonts/.
const fonts = Promise.all(
  ["bricolage-grotesque-latin-800-normal.woff", "lexend-latin-400-normal.woff", "lexend-latin-600-normal.woff"].map((file) =>
    readFile(join(process.cwd(), "src/app/fonts", file)),
  ),
);

export async function ogCard(content: { title: string; byline: string; details: string } | null): Promise<ImageResponse> {
  const [bricolage, lexend, lexendSemiBold] = await fonts;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: PAPER,
          borderBottom: `16px solid ${VIOLET}`,
          fontFamily: "Lexend",
          color: INK,
        }}
      >
        {/* The Q-Check mark and the word, as in src/components/Logo.tsx. */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width={72} height={72} viewBox="0 0 64 64">
            <rect width="64" height="64" rx="18" fill={VIOLET} />
            <circle cx="30" cy="30" r="14" fill="none" stroke="#fff" strokeWidth="7" />
            <path d="M36 41 L42 47 L53 33" fill="none" stroke={SUNNY} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ display: "flex", fontFamily: "Bricolage Grotesque", fontSize: 48, letterSpacing: "-0.03em" }}>
            <span>Quiz</span>
            <span style={{ color: VIOLET }}>Matter</span>
          </div>
        </div>

        {content ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div
              style={{
                display: "block",
                lineClamp: 3,
                fontFamily: "Bricolage Grotesque",
                fontSize: 60,
                lineHeight: 1.1,
                letterSpacing: "-0.02em",
              }}
            >
              {content.title}
            </div>
            {content.byline && <div style={{ display: "flex", fontSize: 32, fontWeight: 600 }}>{content.byline}</div>}
            {content.details && <div style={{ display: "flex", fontSize: 28, color: MUTED }}>{content.details}</div>}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", fontFamily: "Bricolage Grotesque", fontSize: 76, lineHeight: 1.1, letterSpacing: "-0.02em" }}>
              Build presentations with quizzes built in.
            </div>
            <div style={{ display: "flex", fontSize: 32, color: MUTED }}>Lessons and quizzes for the classroom, free for teachers.</div>
          </div>
        )}

        <div style={{ display: "flex", alignSelf: "flex-start", padding: "8px 18px", border: `2px solid ${BORDER}`, borderRadius: 14, background: "#fff", fontSize: 26, fontWeight: 600, color: VIOLET }}>
          quizmatter.com
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "Bricolage Grotesque", data: bricolage, weight: 800, style: "normal" },
        { name: "Lexend", data: lexend, weight: 400, style: "normal" },
        { name: "Lexend", data: lexendSemiBold, weight: 600, style: "normal" },
      ],
      // A robot asking again costs nothing: an hour in the browser, a day at Cloudflare. A renamed presentation's
      // card can be a day old.
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
    },
  );
}
