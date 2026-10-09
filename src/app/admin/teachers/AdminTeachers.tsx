"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BanIcon, ShieldCheckIcon, UndoIcon } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { BAN_REASON_MAX_LENGTH } from "@/lib/schema";
import { banTeacher, setEditor, unbanTeacher } from "./actions";

export type TeacherRow = {
  id: string;
  email: string;
  // Display name ("" if not set).
  name: string;
  // "Ana Cruz · +63 917 123 4567 · Master's degree in English" ("" if none given).
  details: string;
  // False until they click the link in the sign up email.
  isConfirmed: boolean;
  // "Joined 3 days ago · Last login 1 hr ago".
  meta: string;
  isAdmin: boolean;
  // Can review QuizMatter presentations.
  isEditor: boolean;
  // isAutomatic: banned for clicking too fast, not by an admin.
  ban: { reason: string; when: string; isAutomatic: boolean } | null;
};

/** Every teacher (banned ones first), with Ban / Unban and Make editor / Remove editor. */
export function AdminTeachers({ rows }: { rows: TeacherRow[] }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-secondary">
        A banned teacher can&apos;t save, add photos or use Claude from that moment, and can&apos;t log in again. Their
        presentations stay as they are. Editors can review QuizMatter presentations.
      </p>
      {rows.map((row) => (
        <Row key={row.id} row={row} />
      ))}
    </div>
  );
}

function Row({ row }: { row: TeacherRow }) {
  const [isBusy, startTransition] = useTransition();
  // The reason being typed, while the ban form is open (null = closed).
  const [reason, setReason] = useState<string | null>(null);

  const ban = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const error = await banTeacher(row.id, reason ?? "");
      if (error) return void toast.error(error);
      toast.success(`${row.email} is banned.`);
      setReason(null);
    });
  };

  const toggleEditor = () => {
    if (row.isEditor && !confirm(`Remove ${row.email} as editor? A review they have open is canceled.`)) return;
    startTransition(async () => {
      const error = await setEditor(row.id, !row.isEditor);
      if (error) toast.error(error);
      else toast.success(row.isEditor ? `${row.email} is no longer an editor.` : `${row.email} is an editor now.`);
    });
  };

  const unban = () => {
    if (!confirm(`Unban ${row.email}? They can log in and save again.`)) return;
    startTransition(async () => {
      const error = await unbanTeacher(row.id);
      if (error) toast.error(error);
      else toast.success(`${row.email} can use QuizMatter again.`);
    });
  };

  return (
    <div className={`rounded-card border border-border-default bg-bg-surface px-5 py-3.5 ${isBusy ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-text-primary">{row.email}</span>
            {row.name && <span className="text-sm text-text-secondary">{row.name}</span>}
            {!row.isConfirmed && <span className={`${pillClass} bg-highlight-soft text-highlight-strong`}>Not confirmed</span>}
            {row.isAdmin && <span className={`${pillClass} bg-accent-soft text-accent`}>Admin</span>}
            {row.isEditor && <span className={`${pillClass} bg-accent-soft text-accent`}>Editor</span>}
            {row.ban && <span className={`${pillClass} bg-danger-soft text-danger-strong`}>Banned</span>}
            {row.ban?.isAutomatic && <span className={`${pillClass} bg-bg-page text-text-secondary`}>Automatic</span>}
          </div>
          {row.details && <p className="mt-0.5 text-[13px] text-text-primary">{row.details}</p>}
          <p className="mt-0.5 text-[13px] text-text-secondary">{row.meta}</p>
        </div>

        <div className="flex items-center gap-2">
          {isBusy && <Spinner size={16} />}
          {/* Also on banned rows: removing a banned editor ends the review they left open. */}
          {reason === null && (row.isEditor || !row.ban) && (
            <button type="button" onClick={toggleEditor} disabled={isBusy} className={smallButtonClass}>
              <ShieldCheckIcon size={14} />
              {row.isEditor ? "Remove editor" : "Make editor"}
            </button>
          )}
          {row.ban ? (
            <button type="button" onClick={unban} disabled={isBusy} className={smallButtonClass}>
              <UndoIcon size={14} />
              Unban
            </button>
          ) : (
            !row.isAdmin &&
            reason === null && (
              <button type="button" onClick={() => setReason("")} disabled={isBusy} className={banButtonClass}>
                <BanIcon size={14} />
                Ban
              </button>
            )
          )}
        </div>
      </div>

      {row.ban && (
        <p className="mt-3 border-t border-border-default pt-3 text-sm text-text-primary">
          <span className="font-semibold">Why:</span> {row.ban.reason}
          <span className="text-text-secondary"> · {row.ban.when}</span>
        </p>
      )}

      {reason !== null && (
        <form onSubmit={ban} className="mt-3 flex flex-col gap-2 border-t border-border-default pt-3">
          <label className="text-[11px] font-bold tracking-[0.05em] text-text-header uppercase" htmlFor={`ban-${row.id}`}>
            Why are you banning this teacher?
          </label>
          <input
            id={`ban-${row.id}`}
            autoFocus
            required
            maxLength={BAN_REASON_MAX_LENGTH}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Spam presentations, reported 3 times"
            className="w-full rounded-input border border-border-default px-3 py-2 text-sm text-text-primary outline-none focus:border-text-secondary"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setReason(null)} disabled={isBusy} className={smallButtonClass}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={isBusy || !reason.trim()}
              className={confirmBanButtonClass}
            >
              <BanIcon size={14} />
              Ban teacher
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

const pillClass = "rounded-dropdown px-2.5 py-1 text-[13px] leading-none font-semibold";

const buttonClass =
  "inline-flex items-center gap-2 rounded-dropdown border px-2.5 py-1.5 text-[13px] font-semibold transition-colors disabled:opacity-60";
const smallButtonClass = `${buttonClass} border-border-default bg-bg-surface text-text-primary hover:bg-bg-page`;
const banButtonClass = `${buttonClass} border-border-default bg-bg-surface text-danger-strong hover:bg-danger-soft`;
const confirmBanButtonClass = `${buttonClass} border-danger-soft bg-danger-soft text-danger-strong`;
