"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { z } from "zod";
import {
  ANNOUNCEMENTS_STORE,
  isSameVisit,
  isWaiting,
  manilaDay,
  myAnnouncementSchema,
  pageGroup,
  pickForPage,
  reopenAt,
  stillClosed,
  type AnnouncementPart,
  type MyAnnouncement,
} from "@/lib/announcements";
import { createClient } from "@/lib/supabase/client";
import { AnnouncementBar, AnnouncementCornerBox, AnnouncementModal } from "./AnnouncementView";
import { isEditorPage } from "./Footer";

// What this tab knows (sessionStorage, so a new tab asks again): the key it was asked under, the Philippine date,
// whose list it is, the caller's announcements, the parts closed in this tab ("<id>:modal" / "<id>:bar") and when
// (`closedAt`, ms, for "Again every N minutes"; missing in a tab from before it = {}), and the tab's clock (`waited`:
// seconds on QuizMatter, for "shows after"; missing in a tab from before it = 0).
const storedSchema = z.object({
  key: z.string(),
  day: z.string(),
  userId: z.string(),
  items: z.array(myAnnouncementSchema),
  closed: z.array(z.string()),
  closedAt: z.record(z.string(), z.number()).catch({}),
  waited: z.number().catch(0),
});
type Stored = z.infer<typeof storedSchema>;

function readStored(): Stored | null {
  try {
    const parsed = storedSchema.safeParse(JSON.parse(sessionStorage.getItem(ANNOUNCEMENTS_STORE) ?? "null"));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The tab's state with `key` closed now (its time is what "Again every N minutes" counts from). */
function withClosed(stored: Stored, key: string): Stored {
  return { ...stored, closed: [...stored.closed, key], closedAt: { ...stored.closedAt, [key]: Date.now() } };
}

function writeStored(stored: Stored) {
  try {
    sessionStorage.setItem(ANNOUNCEMENTS_STORE, JSON.stringify(stored));
  } catch {
    // Storage blocked: it still works for this page, it just asks again on the next one.
  }
}

/**
 * Shows the logged-in teacher's announcements (root CLAUDE.md, "Announcements"). Only mounted when something is live
 * (`Announcements`, from the maintenance status's key). Asks my_announcements once per key and Philippine day, never
 * on pages that can't show one, and picks what fits each page from the saved list. A list shows only to the account
 * it was asked for. Nothing shows while presenting; a waiting modal shows once the presentation ends. A modal or
 * corner box with "shows after" waits for the tab's clock, which counts the seconds on any page in a group while one
 * still waits, the tab is in front and nobody is presenting. An "Again every N minutes" part comes back N minutes
 * (real time) after it was closed in this tab: one timer waits for the next one due.
 */
export function AnnouncementsWatch({ announcementsKey }: { announcementsKey: string }) {
  const pathname = usePathname() ?? "";
  const group = pageGroup(pathname);
  const canShow = group !== null;
  const [userId, setUserId] = useState<string | null>(null);
  const [stored, setStored] = useState<Stored | null>(null);
  const [isPresenting, setIsPresenting] = useState(false);
  // Worked out on every page change (in-app moves don't re-render the layout), so midnight is noticed without a
  // reload.
  const day = manilaDay(new Date());

  // Who is logged in, read again on every page change (from the browser's cookie, no request): logging out and in
  // moves between pages without a reload, so this tab may now belong to another teacher.
  useEffect(() => {
    let isCurrent = true;
    void createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (isCurrent) setUserId(data.session?.user.id ?? null);
      });
    return () => {
      isCurrent = false;
    };
  }, [pathname]);

  useEffect(() => {
    // Logged out: nothing to show.
    if (!canShow || !userId) return;
    let isCurrent = true;
    const load = async (): Promise<Stored | null> => {
      const supabase = createClient();
      const saved = readStored();
      // Closed parts, their times and the clock stay for this visit: the same account, until a new day ("once a day"
      // shows again).
      const sameVisit = isSameVisit(saved, { day, userId });
      if (saved && sameVisit && saved.key === announcementsKey) return saved;
      const { data, error } = await supabase.rpc("my_announcements");
      const items = z.array(myAnnouncementSchema).safeParse(data);
      if (error || !items.success) return null;
      const next = {
        key: announcementsKey,
        day,
        userId,
        items: items.data,
        closed: saved && sameVisit ? saved.closed : [],
        closedAt: saved && sameVisit ? saved.closedAt : {},
        waited: saved && sameVisit ? saved.waited : 0,
      };
      writeStored(next);
      return next;
    };
    void load().then((next) => {
      if (isCurrent) setStored(next);
    });
    return () => {
      isCurrent = false;
    };
  }, [canShow, announcementsKey, day, userId]);

  // Presenting: fullscreen, or PresentationView's data-presenting mark on <html> (Present still opens when the
  // browser refuses fullscreen, e.g. on an iPhone, and the modal must not cover the class's slides).
  useEffect(() => {
    const root = document.documentElement;
    const handleChange = () => setIsPresenting(document.fullscreenElement !== null || root.dataset.presenting !== undefined);
    const observer = new MutationObserver(handleChange);
    observer.observe(root, { attributes: true, attributeFilter: ["data-presenting"] });
    document.addEventListener("fullscreenchange", handleChange);
    return () => {
      observer.disconnect();
      document.removeEventListener("fullscreenchange", handleChange);
    };
  }, []);

  const isShowing = group !== null && stored !== null && userId !== null && isSameVisit(stored, { day, userId }) && !isPresenting;
  const isClockRunning = isShowing && isWaiting(stored.items, new Set(stored.closed), stored.waited);

  // The tab's clock for "shows after": one tick a second, only while something waits; a tab in the background
  // doesn't count (nobody would see it show).
  useEffect(() => {
    if (!isClockRunning) return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      setStored((current) => {
        if (!current) return current;
        const next = { ...current, waited: current.waited + 1 };
        writeStored(next);
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isClockRunning]);

  // "Again every N minutes": wait for the next closed part due back, then take every part that's back off the closed
  // list (also at once after a reload or a background tab, when the time has already passed). No timer when none is
  // due. The clock's ticks don't restart it (they keep these three as they are).
  const items = stored?.items;
  const closedKeys = stored?.closed;
  const closedAt = stored?.closedAt;
  useEffect(() => {
    if (!items || !closedKeys || !closedAt) return;
    const times = closedKeys.map((key) => reopenAt(items, key, closedAt)).filter((time) => time !== null);
    if (times.length === 0) return;
    const timer = setTimeout(() => {
      setStored((current) => {
        if (!current) return current;
        const still = stillClosed(current.items, current.closed, current.closedAt, Date.now());
        const next = {
          ...current,
          closed: current.closed.filter((key) => still.has(key)),
          closedAt: Object.fromEntries(Object.entries(current.closedAt).filter(([key]) => still.has(key))),
        };
        writeStored(next);
        return next;
      });
    }, Math.max(0, Math.min(...times) - Date.now()));
    return () => clearTimeout(timer);
  }, [items, closedKeys, closedAt]);

  if (!isShowing) return null;
  const { modals, bars, boxes } = pickForPage(stored.items, group, new Set(stored.closed), stored.waited);
  const isFloating = isEditorPage(pathname);

  // Gone at once in this tab, with the time ("Again every N minutes" counts from it). "Once" and "once a day" also
  // tell the database (a failure is ignored: it stays hidden for this visit and may come back later; nothing is lost).
  const close = (announcement: MyAnnouncement, part: AnnouncementPart) => {
    const next = withClosed(stored, `${announcement.id}:${part}`);
    writeStored(next);
    setStored(next);
    if (announcement.repeat === "once" || announcement.repeat === "daily") {
      void createClient()
        .rpc("dismiss_announcement", { target: announcement.id, part })
        .then(() => undefined);
    }
  };

  const modal = modals[0];
  const box = boxes[0];

  return (
    <>
      {bars.length > 0 && (
        // The editor fills the screen, so its bars float at the bottom instead of pushing it down. The same div on
        // every page, so moving to or from the editor keeps the bars (their countdown and HTML box don't restart).
        <div className={isFloating ? "fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2" : undefined}>
          {bars.map((bar) => (
            <AnnouncementBar
              key={bar.id}
              html={bar.bar_html}
              format={bar.bar_format}
              height={bar.bar_height}
              closeAfter={bar.bar_close_after}
              isFloating={isFloating}
              onClose={() => close(bar, "bar")}
            />
          ))}
        </div>
      )}
      {/* The corner box doesn't block the page; closing itself counts like the close button (part "modal"). */}
      {box && (
        <AnnouncementCornerBox
          key={box.id}
          text={box.modal_text}
          attachment={box.modal_attachment}
          format={box.modal_format}
          html={box.modal_html}
          height={box.modal_height}
          closeAfter={box.modal_close_after}
          autoClose={box.modal_auto_close}
          size={box.modal_size}
          onClose={() => close(box, "modal")}
        />
      )}
      {modal && (
        <AnnouncementModal
          key={modal.id}
          text={modal.modal_text}
          attachment={modal.modal_attachment}
          format={modal.modal_format}
          html={modal.modal_html}
          height={modal.modal_height}
          closeAfter={modal.modal_close_after}
          size={modal.modal_size}
          onClose={() => close(modal, "modal")}
        />
      )}
    </>
  );
}
