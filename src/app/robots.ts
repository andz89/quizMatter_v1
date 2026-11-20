import type { MetadataRoute } from "next";

// /robots.txt: robots may read every page they can open logged out (login, sign up, Privacy, Terms, published
// presentations' public previews). The rest redirects them to login anyway; listing it keeps them from trying.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api/", "/account", "/presentation/new", "/presentation/*/edit"],
    },
  };
}
