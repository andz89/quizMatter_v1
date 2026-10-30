"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmModal } from "@/components/editor/ConfirmModal";
import { Spinner } from "@/components/Spinner";
import { MAINTENANCE_MESSAGE_MAX, type MaintenanceStatus } from "@/lib/maintenance";
import { announceMaintenance, setMaintenance } from "./actions";

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });

const labelClass = "mb-1 block text-[11px] font-bold tracking-[0.05em] text-text-header uppercase";
const inputClass =
  "w-full rounded-input border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary";

/** The status, the note teachers read, the on/off button (asks first) and the announcement. */
export function MaintenanceControls({ status }: { status: MaintenanceStatus }) {
  const [note, setNote] = useState(status.message);
  // The datetime-local box's value (the computer's own time), "" = not picked.
  const [planned, setPlanned] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [busy, setBusy] = useState<"switch" | "announce" | "unannounce" | null>(null);
  const [, startTransition] = useTransition();

  const run = (kind: NonNullable<typeof busy>, step: () => Promise<string | null>, done: string) => {
    setBusy(kind);
    startTransition(async () => {
      const error = await step();
      setBusy(null);
      if (error) toast.error(error);
      else toast.success(done);
    });
  };

  const switchMaintenance = () => {
    setIsAsking(false);
    run("switch", () => setMaintenance(!status.isOn, note), status.isOn ? "Maintenance is off." : "Maintenance is on.");
  };

  const announce = () => {
    if (!planned) return toast.error("Pick when maintenance starts.");
    run("announce", () => announceMaintenance(new Date(planned).toISOString(), note), "Announced. Everyone sees the bar now.");
  };

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <section className="rounded-card border border-border-default bg-bg-surface px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-[15px] font-extrabold text-text-primary">Maintenance</h2>
          <span
            className={`rounded-dropdown px-2 py-0.5 text-[12px] font-semibold ${
              status.isOn ? "bg-danger-soft text-danger-strong" : "bg-success-soft text-success-strong"
            }`}
          >
            {status.isOn ? "On" : "Off"}
          </span>
          {status.isOn && status.startedAt && <span className="text-sm text-text-secondary">since {formatTime(status.startedAt)}</span>}
        </div>
        <p className="mt-1 text-sm text-text-secondary">
          While it&apos;s on, everyone but you (teachers, editors and the other admins) is stopped: every page goes to the
          maintenance page, nothing can be saved, nobody new can sign up, Claude&apos;s connector is closed, and the cleanup
          timers wait. Open tabs move to the maintenance page on their next click, and unsaved editor work is kept in
          their browser.
        </p>

        <label htmlFor="maintenance-note" className={`${labelClass} mt-4`}>
          Note for teachers (optional)
        </label>
        <textarea
          id="maintenance-note"
          rows={3}
          maxLength={MAINTENANCE_MESSAGE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. We're adding new lessons. Back in about 30 minutes."
          className={`${inputClass} resize-none`}
        />
        <p className="mt-1 text-right text-[12px] text-text-secondary">
          {note.length}/{MAINTENANCE_MESSAGE_MAX}
        </p>

        <button
          type="button"
          disabled={busy !== null}
          onClick={() => setIsAsking(true)}
          className={`mt-2 inline-flex items-center gap-2 rounded-button px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
            status.isOn ? "bg-accent btn-press hover:bg-accent-hover" : "bg-danger hover:bg-danger-strong"
          }`}
        >
          {busy === "switch" && <Spinner size={14} />}
          {status.isOn ? "Turn off maintenance" : "Turn on maintenance"}
        </button>
      </section>

      {!status.isOn && (
        <section className="rounded-card border border-border-default bg-bg-surface px-5 py-4">
          <h2 className="text-[15px] font-extrabold text-text-primary">Announce ahead</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Everyone sees a yellow bar with the time and the note above until then, so they can save and finish. It
            doesn&apos;t start maintenance by itself: turn it on when you&apos;re ready.
          </p>
          {status.plannedAt && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-input bg-highlight-soft px-3 py-2 text-sm text-text-primary">
              <span>
                Announced for <span className="font-semibold">{formatTime(status.plannedAt)}</span> (Philippine time)
              </span>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => run("unannounce", () => announceMaintenance(null, note), "The announcement is gone.")}
                className="inline-flex items-center gap-2 rounded-dropdown border border-border-default bg-bg-surface px-3 py-1 text-[13px] font-semibold text-text-primary hover:bg-bg-page disabled:opacity-60"
              >
                {busy === "unannounce" && <Spinner size={12} />}
                Take it away
              </button>
            </div>
          )}
          <label htmlFor="maintenance-planned" className={`${labelClass} mt-4`}>
            Starts at (your computer&apos;s time)
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="maintenance-planned"
              type="datetime-local"
              value={planned}
              onChange={(e) => setPlanned(e.target.value)}
              className={`${inputClass} w-auto`}
            />
            <button
              type="button"
              disabled={busy !== null}
              onClick={announce}
              className="inline-flex items-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {busy === "announce" && <Spinner size={14} />}
              {status.plannedAt ? "Change announcement" : "Announce"}
            </button>
          </div>
        </section>
      )}

      {isAsking && (
        <ConfirmModal
          title={status.isOn ? "Turn off maintenance?" : "Turn on maintenance?"}
          message={
            status.isOn
              ? "Everyone can use QuizMatter again. Open maintenance pages send people home within about a minute."
              : "Everyone but you (teachers, editors and the other admins) will be stopped and sent to the maintenance page. Their next save is refused."
          }
          confirmLabel={status.isOn ? "Turn off" : "Turn on"}
          danger={!status.isOn}
          onConfirm={switchMaintenance}
          onCancel={() => setIsAsking(false)}
        />
      )}
    </div>
  );
}
