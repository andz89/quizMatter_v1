"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOutIcon, SettingsIcon, ShieldIcon } from "lucide-react";
import type { Account } from "@/lib/account";
import { createClient } from "@/lib/supabase/client";
import { LinkPending } from "./LinkPending";
import { Spinner } from "./Spinner";

const itemClass =
  "flex w-full items-center gap-3 rounded-dropdown px-3 py-2 text-left text-sm text-text-primary transition-colors hover:bg-accent-soft hover:text-accent";

/** The round button in the top bar (first letter of the name or email), opening a menu with Admin, Account settings and Log out. */
export function AccountMenu({ account }: { account: Account }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const name = account.displayName || account.email;

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
            {account.isAdmin && <span className="text-[11px] leading-none font-semibold tracking-[0.06em] text-accent uppercase">Admin</span>}
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
          <button type="button" onClick={logOut} disabled={isLoggingOut} className={itemClass}>
            {isLoggingOut ? <Spinner size={16} /> : <LogOutIcon size={16} />}
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
