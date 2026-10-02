import { LibraryIcon, MessagesSquareIcon, PresentationIcon, SparklesIcon } from "lucide-react";

const features = [
  { Icon: PresentationIcon, title: "Build slides fast", text: "Make lessons and quizzes in one simple editor. Drag and drop to get slides from other work or presentations." },
  { Icon: SparklesIcon, title: "Made for kids", text: "Bright, playful pictures and clear right/wrong feedback." },
  { Icon: LibraryIcon, title: "1,000+ ready-to-use quizzes", text: "Pick a quiz and play it in class right away." },
  { Icon: MessagesSquareIcon, title: "Lessons ready to discuss", text: "A prepared lesson discussion for every quiz, all in one place." },
];

/** The "About QuizMatter" section shown next to the login form. */
export function LoginAbout() {
  return (
    <section className="w-full max-w-sm">
      <h2 className="text-2xl font-extrabold text-text-primary">Fun quizzes for the classroom</h2>
      <p className="mt-2 text-sm text-text-secondary">
        QuizMatter helps teachers make bright, simple lessons and quizzes that kids love to play.
      </p>

      <ul className="mt-5 flex flex-col gap-4">
        {features.map(({ Icon, title, text }) => (
          <li key={title} className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
              <Icon size={20} />
            </span>
            <div>
              <p className="text-sm font-semibold text-text-primary">{title}</p>
              <p className="text-sm text-text-secondary">{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
