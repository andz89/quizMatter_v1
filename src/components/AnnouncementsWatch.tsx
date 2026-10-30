"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { z } from "zod";
import {
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
const STORE = "qm:announcements";
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
    const parsed = storedSchema.safeParse(JSON.parse(sessionStorage.getItem(STORE) ?? "null"));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeStored(stored: Stored) {
  try {
    sessionStorage.setItem(STORE, JSON.stringify(stored));
  } catch {
    // Storage blocked: it still works for this page, it just asks again on the next one.
  }
}

/**
 * Shows the logged-in teacher's announcements (root CLAUDE.md, "Announcements"). Only mounted when something is live
 * (`Announcements`, from the maintenance status's key). Asks my_announcements once per key and Philippine day, never
 * on pages that can't show one, and picks what fits each page from the saved list. Nothing shows while presenting
 * fullscreen; a waiting modal shows once fullscreen ends.
 */
export function AnnouncementsWatch({ announcementsKey }: { announcementsKey: string }) {
  const pathname = usePathname() ?? "";
  const group = pageGroup(pathname);
  const canShow = group !== null;
  const [stored, setStored] = useState<Stored | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Worked out on every page change (in-app moves don't re-render the layout), so midnight is noticed without a
  // reload.
  const day = manilaDay(new Date());

  useEffect(() => {
    if (!canShow) return;
    let isCurrent = true;
    const load = async (): Promise<Stored | null> => {
      const supabase = createClient();
      // Read from the browser's cookie, no request. Logged out: nothing to show.
      const userId = (await supabase.auth.getSession()).data.session?.user.id;
      if (!userId) return null;
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
  }, [canShow, announcementsKey, day]);

  useEffect(() => {
    const handleChange = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", handleChange);
    return () => document.removeEventListener("fullscreenchange", handleChange);
  }, []);

  if (!group || !stored || stored.day !== day || isFullscreen) return null;
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
          html={modal.modal_html}
          closeAfter={modal.modal_close_after}
          size={modal.modal_size}
          onClose={() => close(modal, "modal")}
        />
      )}
    </>
  );
}
