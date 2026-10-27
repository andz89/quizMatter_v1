"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CopyIcon, HeartIcon, LifeBuoyIcon, LogOutIcon, SettingsIcon, ShieldIcon } from "lucide-react";
import type { Account } from "@/lib/account";
import { createClient } from "@/lib/supabase/client";
import { SUPPORT_EMAIL } from "@/lib/support";
import { KeepFreeModal } from "./KeepFree";
import { LinkPending } from "./LinkPending";
import { Spinner } from "./Spinner";
import { copySupportEmail } from "./SupportEmail";

const itemClass =
  "flex w-full items-center gap-3 rounded-dropdown px-3 py-2 text-left text-sm text-text-primary transition-colors hover:bg-accent-soft hover:text-accent";

/** The round button in the top bar (first letter of the name or email), opening a menu with an "Admin" or "Editor" label, Admin, Account settings, Help & support (copies the support email), Keep QuizMatter free and Log out. */
export function AccountMenu({ account }: { account: Account }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isKeepFreeOpen, setIsKeepFreeOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const name = account.displayName || account.email;
  const role = account.isAdmin ? "Admin" : account.isEditor ? "Editor" : null;

  // Closes on a click outside the menu, or on Esc.
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  const logOut = async () => {
    setIsLoggingOut(true);
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label="Account menu"
        aria-expanded={isOpen}
        title={name}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-accent font-heading text-base font-extrabold text-white transition-colors hover:bg-accent-hover"
      >
        {name.charAt(0).toUpperCase() || "?"}
      </button>

      {isOpen && (
        <div className="absolute top-11 right-0 z-50 w-64 rounded-card border border-border-default bg-bg-surface p-2">
          <div className="flex flex-col gap-1 px-3 pt-2 pb-3">
            {role && <span className="text-[11px] leading-none font-semibold tracking-[0.06em] text-accent uppercase">{role}</span>}
            {account.displayName && <p className="truncate font-heading text-[15px] font-extrabold text-text-primary">{account.displayName}</p>}
            <p className="truncate text-xs text-text-secondary">{account.email}</p>
          </div>
          <div className="mb-1 h-[1.5px] bg-border-default" />

          {/* Links stay open on click, so their top line keeps showing until the page opens. */}
          {account.isAdmin && (
            <Link href="/admin" className={itemClass}>
              <ShieldIcon size={16} />
              Admin
              <LinkPending />
            </Link>
          )}
          <Link href="/account" className={itemClass}>
            <SettingsIcon size={16} />
            Account settings
            <LinkPending />
          </Link>
          <button type="button" onClick={copySupportEmail} title="Copy the support email" className={itemClass}>
            <LifeBuoyIcon size={16} />
            <span className="min-w-0 flex-1">
              Help & support
              <span className="block truncate text-xs text-text-secondary">{SUPPORT_EMAIL}</span>
            </span>
            <CopyIcon size={14} />
          </button>
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              setIsKeepFreeOpen(true);
            }}
            className={itemClass}
          >
            <HeartIcon size={16} />
            Keep QuizMatter free
          </button>
          <button type="button" onClick={logOut} disabled={isLoggingOut} className={itemClass}>
            {isLoggingOut ? <Spinner size={16} /> : <LogOutIcon size={16} />}
            Log out
          </button>
        </div>
      )}
      {/* Outside the menu, which closes when the box opens. */}
      {isKeepFreeOpen && <KeepFreeModal onClose={() => setIsKeepFreeOpen(false)} />}
    </div>
  );
}
