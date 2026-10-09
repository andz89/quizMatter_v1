"use client";

import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CopyIcon, UserIcon } from "lucide-react";
import { LinkPending } from "@/components/LinkPending";
import { Spinner } from "@/components/Spinner";
import {
  BIO_MAX_LENGTH,
  changePassword,
  CONTACT_NUMBER_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  EDUCATION_FIELD_MAX_LENGTH,
  EDUCATION_LEVEL_LABELS,
  EDUCATION_LEVELS,
  NAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  profileSchema,
  saveDisplayName,
  saveProfile,
  type ProfileFields,
} from "@/lib/userSettings";

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

/** First and last name, contact number and educational background (given at sign up), and the bio for the profile page. */
export function PersonalDetailsForm({ profile }: { profile: ProfileFields }) {
  const router = useRouter();
  const [fields, setFields] = useState(profile);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const isChanged = (Object.keys(profile) as (keyof ProfileFields)[]).some((key) => fields[key].trim() !== profile[key]);

  const update = (name: keyof ProfileFields) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setFields((old) => ({ ...old, [name]: e.target.value }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const checked = profileSchema.safeParse(fields);
    if (!checked.success) return setError(checked.error.issues[0].message);
    setError("");
    setIsSaving(true);
    try {
      await saveProfile(fields);
      toast.success("Details saved.");
      router.refresh();
    } catch {
      toast.error("Couldn't save your details. Please try again.");
    }
    setIsSaving(false);
  };

  return (
    <Card title="Personal details" onSubmit={save}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="firstName" className={labelClass}>First name</label>
          <input
            id="firstName"
            type="text"
            required
            maxLength={NAME_MAX_LENGTH}
            autoComplete="given-name"
            value={fields.firstName}
            onChange={update("firstName")}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="lastName" className={labelClass}>Last name</label>
          <input
            id="lastName"
            type="text"
            required
            maxLength={NAME_MAX_LENGTH}
            autoComplete="family-name"
            value={fields.lastName}
            onChange={update("lastName")}
            className={inputClass}
          />
        </div>
      </div>
      <div>
        <label htmlFor="contactNumber" className={labelClass}>Contact number</label>
        <input
          id="contactNumber"
          type="tel"
          required
          maxLength={CONTACT_NUMBER_MAX_LENGTH}
          autoComplete="tel"
          placeholder="e.g. +63 917 123 4567"
          value={fields.contactNumber}
          onChange={update("contactNumber")}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="educationLevel" className={labelClass}>Educational background</label>
        <select id="educationLevel" required value={fields.educationLevel} onChange={update("educationLevel")} className={inputClass}>
          <option value="" disabled>
            Pick one
          </option>
          {EDUCATION_LEVELS.map((level) => (
            <option key={level} value={level}>
              {EDUCATION_LEVEL_LABELS[level]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="educationField" className={labelClass}>Field or major</label>
        <input
          id="educationField"
          type="text"
          required
          maxLength={EDUCATION_FIELD_MAX_LENGTH}
          placeholder="e.g. Secondary Education, major in English"
          value={fields.educationField}
          onChange={update("educationField")}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="bio" className={labelClass}>Bio</label>
        <textarea
          id="bio"
          rows={3}
          maxLength={BIO_MAX_LENGTH}
          placeholder="e.g. Grade 5 science teacher who loves hands-on experiments."
          value={fields.bio}
          onChange={update("bio")}
          className={`${inputClass} resize-y`}
        />
        <p className="mt-1 text-xs text-text-secondary">
          Optional. Shown on your profile page, up to {BIO_MAX_LENGTH} characters. Your contact number and email are never shown there.
        </p>
      </div>
      {error && <p className="text-sm text-danger-strong">{error}</p>}
      <button type="submit" disabled={isSaving || !isChanged} className={buttonClass}>
        {isSaving && <Spinner size={14} />}
        Save details
      </button>
    </Card>
  );
}

/** "View my profile" and "Copy profile link", so teachers can share their profile with other logged-in users. */
export function ProfileLinks({ href }: { href: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(new URL(href, window.location.origin).href);
      toast.success("Profile link copied.");
    } catch {
      toast.error("Couldn't copy the link.");
    }
  };

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Link href={href} className={smallButtonClass}>
        <UserIcon size={14} />
        View my profile
        <LinkPending />
      </Link>
      <button type="button" onClick={copy} className={smallButtonClass}>
        <CopyIcon size={14} />
        Copy profile link
      </button>
    </div>
  );
}

const smallButtonClass =
  "inline-flex items-center gap-2 rounded-dropdown border border-border-default bg-bg-surface px-2.5 py-1.5 text-[13px] font-semibold text-text-primary transition-colors hover:bg-bg-page";

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
