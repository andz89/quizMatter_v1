import { OG_SIZE, ogCard } from "./ogCard";

// The site's own link picture (login, sign up, every page without its own), made once at build time.
export const alt = "QuizMatter: build presentations with quizzes built in";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return ogCard(null);
}
