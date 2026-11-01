"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { z } from "zod";
import {
  ANNOUNCEMENTS_STORE,
  isSameVisit,
  manilaDay,
  myAnnouncementSchema,
  pageGroup,
  pickForPage,
  type AnnouncementPart,
  type MyAnnouncement,
} from "@/lib/announcements";
import { createClient } from "@/lib/supabase/client";
import { AnnouncementBar, AnnouncementModal } from "./AnnouncementView";
import { isEditorPage } from "./Footer";

// What this tab knows (sessionStorage, so a new tab asks again): the key it was asked under, the Philippine date,
// whose list it is, the caller's announcements and the parts closed in this tab ("<id>:modal" / "<id>:bar").
const storedSchema = z.object({
  key: z.string(),
  day: z.string(),
  userId: z.string(),
  items: z.array(myAnnouncementSchema),
  closed: z.array(z.string()),
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
 * it was asked for. Nothing shows while presenting; a waiting modal shows once the presentation ends.
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
      // Closed parts stay closed for this visit: the same account, until a new day ("once a day" shows again).
      const sameVisit = isSameVisit(saved, { day, userId });
      if (saved && sameVisit && saved.key === announcementsKey) return saved;
      const { data, error } = await supabase.rpc("my_announcements");
      const items = z.array(myAnnouncementSchema).safeParse(data);
      if (error || !items.success) return null;
      const next = { key: announcementsKey, day, userId, items: items.data, closed: saved && sameVisit ? saved.closed : [] };
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

  if (!group || !stored || !userId || !isSameVisit(stored, { day, userId }) || isPresenting) return null;
  const { modals, bars } = pickForPage(stored.items, group, new Set(stored.closed));
  const isFloating = isEditorPage(pathname);

  // Gone at once in this tab. "Once" and "once a day" also tell the database (a failure is ignored: it stays
  // hidden for this visit and may come back later; nothing is lost).
  const close = (announcement: MyAnnouncement, part: AnnouncementPart) => {
    const next = { ...stored, closed: [...stored.closed, `${announcement.id}:${part}`] };
    writeStored(next);
    setStored(next);
    if (announcement.repeat !== "every_visit") {
      void createClient()
        .rpc("dismiss_announcement", { target: announcement.id, part })
        .then(() => undefined);
    }
  };

  const modal = modals[0];
  const barList = bars.map((bar) => (
    <AnnouncementBar
      key={bar.id}
      html={bar.bar_html}
      format={bar.bar_format}
      height={bar.bar_height}
      closeAfter={bar.bar_close_after}
      isFloating={isFloating}
      onClose={() => close(bar, "bar")}
    />
  ));

  return (
    <>
      {bars.length > 0 &&
        (isFloating ? (
          // The editor fills the screen, so its bars float at the bottom instead of pushing it down.
          <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2">{barList}</div>
        ) : (
          barList
        ))}
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
