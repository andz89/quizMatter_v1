"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { WrenchIcon, XIcon } from "lucide-react";
import { isEditorPage } from "./Footer";
import { LinkPending } from "./LinkPending";

/**
 * MaintenanceBar's drawing. A bar on top of the page; in the editor (it fills the screen) a card floating at the
 * bottom that can be closed instead. Coral while maintenance is on (only the super admin sees it), Sunny for an
 * announcement.
 */
export function MaintenanceNotice({ isOn, plannedLabel, message }: { isOn: boolean; plannedLabel?: string; message?: string }) {
  const pathname = usePathname();
  const [isClosed, setIsClosed] = useState(false);
  const isFloating = isEditorPage(pathname ?? "");
  if (isClosed) return null;

  const text = isOn ? (
    <span>
      <span className="font-semibold">Maintenance is ON.</span> Everyone else is stopped.{" "}
      <Link href="/admin/maintenance" className="font-semibold underline">
        Turn it off
        <LinkPending />
      </Link>
    </span>
  ) : (
    <span>
      <span className="font-semibold">QuizMatter will be down for maintenance on {plannedLabel}</span> (Philippine
      time).{message && ` ${message}`} Save your work before then.
    </span>
  );
  const colors = isOn ? "bg-danger-soft text-danger-strong" : "bg-highlight-soft text-text-primary";

  if (!isFloating) {
    return (
      <div className={`flex items-center justify-center gap-2 px-4 py-2 text-center text-sm ${colors}`}>
        <WrenchIcon size={16} className="shrink-0" />
        {text}
      </div>
    );
  }
  return (
    <div
      className={`fixed bottom-4 left-1/2 z-50 flex w-[min(560px,calc(100vw-32px))] -translate-x-1/2 items-start gap-2 rounded-card border border-border-default px-4 py-3 text-sm ${colors}`}
    >
      <WrenchIcon size={16} className="mt-0.5 shrink-0" />
      <div className="flex-1">{text}</div>
      <button type="button" onClick={() => setIsClosed(true)} aria-label="Close" className="shrink-0 rounded-dropdown p-0.5 hover:bg-bg-surface">
        <XIcon size={16} />
      </button>
    </div>
  );
}
