"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { LinkPending } from "@/components/LinkPending";
import { Spinner } from "@/components/Spinner";
import { ConfirmModal } from "@/components/editor/ConfirmModal";
import type { AnnouncementInput } from "@/lib/announcements";
import { deleteAnnouncement, setAnnouncementOn } from "./actions";

/** One row of admin_announcements(). */
export type AnnouncementRow = AnnouncementInput & {
  id: string;
  created_at: string;
  status: "live" | "scheduled" | "ended" | "off";
  matched: number;
  closed_modal: number;
  closed_bar: number;
};

const STATUS: Record<AnnouncementRow["status"], { label: string; className: string }> = {
  live: { label: "Live", className: "bg-success-soft text-success-strong" },
  scheduled: { label: "Scheduled", className: "bg-highlight-soft text-text-primary" },
  ended: { label: "Ended", className: "bg-bg-page text-text-secondary" },
  off: { label: "Off", className: "bg-bg-page text-text-secondary" },
};

const NEW_BUTTON_CLASS =
  "inline-flex items-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover";
const SMALL_BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-dropdown border border-border-default bg-bg-surface px-3 py-1.5 text-[13px] font-semibold text-text-primary transition-colors hover:bg-bg-page disabled:opacity-60";

/** The announcements, newest first, with New, Edit, Turn on/off and Delete. */
export function AnnouncementList({ rows }: { rows: AnnouncementRow[] }) {
  const newButton = (
    <Link href="/admin/announcements/new" className={NEW_BUTTON_CLASS}>
      <PlusIcon size={16} />
      New announcement
      <LinkPending />
    </Link>
  );

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-extrabold text-text-primary">Announcements</h2>
          <p className="mt-1 text-sm text-text-secondary">
            A modal and/or a bar at the top for the teachers you choose, on the pages you choose.
          </p>
        </div>
        {rows.length > 0 && newButton}
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-border-default bg-bg-surface px-5 py-12 text-center">
          <p className="text-sm font-semibold text-text-primary">No announcements yet.</p>
          {newButton}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => (
            <Row key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ row }: { row: AnnouncementRow }) {
  const [isBusy, startTransition] = useTransition();
  const [isConfirming, setIsConfirming] = useState(false);
  const status = STATUS[row.status];
  const parts = [row.show_modal && "Modal", row.show_bar && "Bar"].filter(Boolean).join(" + ");

  const toggle = () =>
    startTransition(async () => {
      const error = await setAnnouncementOn(row.id, !row.is_on);
      if (error) toast.error(error);
      else toast.success(row.is_on ? "Turned off." : "Turned on.");
    });

  const remove = () => {
    setIsConfirming(false);
    startTransition(async () => {
      const error = await deleteAnnouncement(row.id);
      if (error) toast.error(error);
      else toast.success("Announcement deleted.");
    });
  };

  return (
    <div className={`rounded-card border border-border-default bg-bg-surface px-5 py-4 ${isBusy ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-text-primary">{row.name}</span>
            <span className={`rounded-dropdown px-2 py-0.5 text-[12px] font-semibold ${status.className}`}>{status.label}</span>
          </div>
          <p className="mt-0.5 text-[13px] text-text-secondary">
            {parts} · Matches {row.matched} · Closed: modal {row.closed_modal} · bar {row.closed_bar}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isBusy && <Spinner size={16} />}
          <Link href={`/admin/announcements/${row.id}`} className={SMALL_BUTTON_CLASS}>
            <PencilIcon size={14} />
            Edit
            <LinkPending />
          </Link>
          {row.status !== "ended" && (
            <button type="button" onClick={toggle} disabled={isBusy} className={SMALL_BUTTON_CLASS}>
              {row.is_on ? "Turn off" : "Turn on"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsConfirming(true)}
            disabled={isBusy}
            title="Delete announcement"
            aria-label={`Delete ${row.name}`}
            className="rounded-dropdown p-1.5 text-danger-strong transition-colors hover:bg-danger-soft disabled:opacity-60"
          >
            <Trash2Icon size={16} />
          </button>
        </div>
      </div>

      {isConfirming && (
        <ConfirmModal
          title="Delete this announcement?"
          message={`"${row.name}" stops showing, and who closed it is forgotten. This can't be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={remove}
          onCancel={() => setIsConfirming(false)}
        />
      )}
    </div>
  );
}
