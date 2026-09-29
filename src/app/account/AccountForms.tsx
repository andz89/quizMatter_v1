"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Spinner } from "@/components/Spinner";
import { changePassword, DISPLAY_NAME_MAX_LENGTH, PASSWORD_MIN_LENGTH, saveDisplayName } from "@/lib/userSettings";

const labelClass = "mb-1 block text-[11px] font-bold tracking-[0.05em] text-text-header uppercase";
const inputClass =
  "w-full rounded-input border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-accent disabled:bg-bg-page disabled:text-text-secondary";
const buttonClass =
  "flex items-center justify-center gap-2 self-start rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60";

/** Email (read only) and display name. */
export function ProfileForm({ email, displayName }: { email: string; displayName: string }) {
  const router = useRouter();
  const [name, setName] = useState(displayName);
  const [isSaving, setIsSaving] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await saveDisplayName(name);
      toast.success("Name saved.");
      // Reloads the server parts, so the account menu shows the new name.
      router.refresh();
    } catch {
      toast.error("Couldn't save your name. Please try again.");
    }
    setIsSaving(false);
  };

  return (
    <Card title="Profile" onSubmit={save}>
      <div>
        <label className={labelClass}>Email</label>
        <input type="email" value={email} disabled className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Display name</label>
        <input
          type="text"
          value={name}
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Ms. Cruz"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-text-secondary">Shown in your account menu, and filled in as the Author of new presentations.</p>
      </div>
      <button type="submit" disabled={isSaving || name.trim() === displayName} className={buttonClass}>
        {isSaving && <Spinner size={14} />}
        Save name
      </button>
    </Card>
  );
}

/** A new password, typed twice. */
export function PasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < PASSWORD_MIN_LENGTH) return setError(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
    if (password !== confirmation) return setError("The two passwords don't match.");
    setError("");
    setIsSaving(true);
    try {
      await changePassword(password);
      toast.success("Password changed.");
      setPassword("");
      setConfirmation("");
    } catch (err) {
      // Supabase's reason (e.g. "New password should be different from the old password.") helps more than a guess.
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't change your password. Please try again.");
    }
    setIsSaving(false);
  };

  return (
    <Card title="Password" onSubmit={save}>
      <div>
        <label className={labelClass}>New password</label>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>Type it again</label>
        <input
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          className={inputClass}
        />
      </div>
      {error && <p className="text-sm text-danger-strong">{error}</p>}
      <button type="submit" disabled={isSaving || !password} className={buttonClass}>
        {isSaving && <Spinner size={14} />}
        Change password
      </button>
    </Card>
  );
}

function Card({ title, onSubmit, children }: { title: string; onSubmit: (e: FormEvent) => void; children: ReactNode }) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-card border border-border-default bg-bg-surface p-5">
      <h2 className="text-lg font-extrabold text-text-primary">{title}</h2>
      {children}
    </form>
  );
}
