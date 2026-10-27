"use client";

import { useState } from "react";
import { DownloadIcon, HeartIcon } from "lucide-react";
import { Modal } from "./Modal";
import gcashQr from "./gcash-qr.png";

// The owner's GCash QR, cropped to the code only (no phone number). It lives in the code on purpose: only a deploy
// can change it, never the database or an Admin page. A new QR needs a new GCASH_NAME too (the name as GCash shows it).
const GCASH_NAME = "DA*N AN***W R.";

/** The "Keep QuizMatter free" box: the GCash QR, a download for phones, the name to check and a scam warning. */
export function KeepFreeModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keep QuizMatter free" onClose={onClose} isNarrow>
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm text-text-secondary">
          QuizMatter is free for every teacher. Your support helps pay for the servers and photo storage that keep it
          running. If it helps your class, you can chip in any amount. Thank you!
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element -- a small file of ours; nothing for next/image to do. */}
        <img
          src={gcashQr.src}
          width={190}
          height={190}
          alt="GCash QR code for supporting QuizMatter"
          className="rounded-button border border-border-default"
        />
        <p className="text-xs text-text-secondary">Scan with GCash (free), Maya or your bank app (they may charge a small fee).</p>
        <a
          href={gcashQr.src}
          download="QuizMatter-GCash-QR.png"
          className="inline-flex items-center gap-2 rounded-button border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-accent-soft hover:text-accent"
        >
          <DownloadIcon size={16} />
          Save QR image
        </a>
        <p className="text-xs text-text-secondary">
          On a phone? Save it, then in GCash tap <b className="text-text-primary">Scan QR → Upload QR</b>.
        </p>
        <div className="w-full rounded-button bg-accent-soft px-3 py-2.5 text-left text-xs text-text-primary">
          <span className="mb-0.5 block text-[11px] font-bold tracking-[0.05em] text-text-header uppercase">Before you pay</span>
          Check that GCash shows the name <b>{GCASH_NAME}</b>. If it shows a different name, stop. Don&apos;t send.
        </div>
        <p className="w-full rounded-button bg-highlight-soft px-3 py-2.5 text-left text-xs text-highlight-strong">
          QuizMatter only asks for support in this box. Never pay a QR code inside a presentation or a message.
        </p>
      </div>
    </Modal>
  );
}

/** The small "Support" button in the top bar (only the heart on phones), opening the box. */
export function KeepFreeButton() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        title="Keep QuizMatter free"
        aria-label="Keep QuizMatter free"
        className="inline-flex items-center gap-1.5 rounded-dropdown bg-highlight-soft px-2.5 py-1.5 text-sm font-semibold text-highlight-strong transition-colors hover:bg-highlight/30"
      >
        <HeartIcon size={16} />
        <span className="hidden sm:inline">Support</span>
      </button>
      {isOpen && <KeepFreeModal onClose={() => setIsOpen(false)} />}
    </>
  );
}
