"use client";

import { ANNOUNCEMENT_LIMITS as L, REPEATS, REPEAT_LABELS, type AnnouncementInput } from "@/lib/announcements";
import { Section, checkClass, inputClass } from "./formParts";

// "Again every N minutes" starts here when picked.
const DEFAULT_REPEAT_MINUTES = 15;

// What each "show again" choice means, under its name in the form (how it works: AnnouncementsWatch and
// my_announcements).
const REPEAT_HELP: Record<(typeof REPEATS)[number], { when: string; goodFor: string }> = {
  once: {
    when:
      "It shows until the teacher closes it, then never again for that teacher, on this computer or any other, even after they log out and back in.",
    goodFor: "news they only need to see once, e.g. \"New Grade 5 lessons are here.\"",
  },
  daily: {
    when:
      "It shows once a day. After the teacher closes it, it stays closed for the rest of that day, on any computer, and comes back after midnight (Philippine time).",
    goodFor: "a reminder during a short event, e.g. \"Training this week: sign up by Friday.\"",
  },
  every_visit: {
    when:
      "It shows each time the teacher opens QuizMatter in a new browser tab or window, or after they close and open the browser again. After they close it, it stays closed while they move between pages or reload in that same tab. It's remembered only in that tab, not on their account.",
    goodFor: "something important they should see every time they come back, e.g. \"QuizMatter will be down on Saturday night.\"",
  },
  interval: {
    when:
      "It shows again N minutes after the teacher closes it, in the same browser tab, while they move between pages or reload. A new tab or window shows it again at once. It's remembered only in that tab, not on their account.",
    goodFor: "a reminder that must not be missed during an event, e.g. \"Sign-ups close at 5 pm today.\"",
  },
};

/**
 * The form's "show it again" section: once / once a day / every visit / again every N minutes, each with what it
 * means and a "Good for"; the last one has its minutes box while it's picked.
 */
export function RepeatSection({
  value,
  onChange,
  minutes,
  onMinutes,
}: {
  value: AnnouncementInput["repeat"];
  onChange: (repeat: AnnouncementInput["repeat"]) => void;
  minutes: number;
  onMinutes: (n: number) => void;
}) {
  return (
    <Section title="After a teacher closes it, show it again">
      <p className="mb-3 text-sm text-text-secondary">
        This decides when a teacher sees the announcement again after closing it.
      </p>
      <div className="flex flex-col gap-3">
        {REPEATS.map((repeat) => (
          <label key={repeat} className="flex items-start gap-2 text-sm text-text-primary">
            <input
              type="radio"
              name="repeat"
              checked={value === repeat}
              onChange={() => {
                onChange(repeat);
                if (repeat === "interval" && minutes === 0) onMinutes(DEFAULT_REPEAT_MINUTES);
              }}
              className={`${checkClass} mt-0.5 shrink-0`}
            />
            <span>
              <span className="font-semibold">{REPEAT_LABELS[repeat]}</span>
              <span className="mt-0.5 block text-text-secondary">{REPEAT_HELP[repeat].when}</span>
              <span className="mt-0.5 block text-text-secondary">
                <span className="font-semibold">Good for:</span> {REPEAT_HELP[repeat].goodFor}
              </span>
              {repeat === "interval" && value === "interval" && (
                <span className="mt-2 flex flex-wrap items-center gap-2">
                  Every
                  <input
                    type="number"
                    aria-label="Minutes"
                    min={1}
                    max={L.repeatMinutesMax}
                    value={minutes}
                    // An emptied box (while typing a new number) keeps the last number.
                    onChange={(e) => e.target.value !== "" && onMinutes(Number(e.target.value))}
                    className={`${inputClass} w-24`}
                  />
                  minutes (1–{L.repeatMinutesMax.toLocaleString("en-US")})
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </Section>
  );
}
