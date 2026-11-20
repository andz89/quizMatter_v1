import type { MetadataRoute } from "next";

// /robots.txt: robots may read every page they can open logged out (login, sign up, Privacy, Terms, published
// presentations' public previews, the public home). The rest redirects them to login anyway; listing it keeps them
// from trying. The sitemap lists the public pages and QuizMatter lessons (src/app/sitemap.ts).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api/", "/account", "/presentation/new", "/presentation/*/edit"],
    },
    sitemap: "https://quizmatter.com/sitemap.xml",
  };
}
