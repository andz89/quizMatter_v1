"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useDndMonitor, useDraggable, useDroppable } from "@dnd-kit/core";
import { toast } from "sonner";
import { ArrowLeftIcon, CheckIcon, EllipsisVerticalIcon, FolderIcon, FolderPlusIcon, ListChecksIcon } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { FOLDER_NAME_MAX, type Folder } from "@/lib/folders";
import { createFolder, deleteFolder, moveToFolder, renameFolder } from "./folderActions";
import type { PresentationCardData } from "./PresentationCard";

// A teacher's folders on the home page's "My presentations" tab (see the folders migration). Cards can be dragged
// onto a folder tile, or onto "← My presentations" to take them out of their folder (PresentationHome's DndContext).

/** The drop spot's id for a folder; "" = no folder ("← My presentations"). */
export function folderDropId(folderId: string): string {
  return `folder:${folderId}`;
}

const inputClass =
  "w-full rounded-input border border-border-default bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-text-secondary";
const buttonClass =
  "flex items-center justify-center gap-2 rounded-button bg-accent btn-press px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60";

const tileClass =
  "flex min-w-0 items-center gap-2 rounded-card border px-4 py-3 text-left text-sm font-semibold text-text-primary transition-colors hover:border-accent";

/**
 * A tile per folder (opens it; a card dropped on it moves there), and "+ New folder". `movingTo`: the folder a
 * dropped card is being moved to, which shows the Spinner.
 */
export function FolderTiles({
  folders,
  movingTo,
  onOpen,
}: {
  folders: Folder[];
  movingTo: string | null;
  onOpen: (id: string) => void;
}) {
  const [isNaming, setIsNaming] = useState(false);

  return (
    <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {folders.map((folder) => (
        <FolderTile key={folder.id} folder={folder} isMoving={movingTo === folder.id} onOpen={() => onOpen(folder.id)} />
      ))}
      <button
        type="button"
        onClick={() => setIsNaming(true)}
        className={`${tileClass} border-dashed border-border-default bg-bg-surface text-text-secondary`}
      >
        <FolderPlusIcon size={18} className="shrink-0" />
        New folder
      </button>

      {isNaming && (
        <FolderNameModal
          title="New folder"
          onSave={async (name) => {
            const result = await createFolder(name);
            return "error" in result ? result.error : null;
          }}
          savedMessage="Folder made."
          onClose={() => setIsNaming(false)}
        />
      )}
    </div>
  );
}

/** One folder's tile. It glows violet while a card is dragged over it. */
function FolderTile({ folder, isMoving, onOpen }: { folder: Folder; isMoving: boolean; onOpen: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: folderDropId(folder.id) });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onOpen}
      className={`${tileClass} ${isOver ? "border-accent bg-accent-soft" : "border-border-default bg-bg-surface"}`}
    >
      <FolderIcon size={18} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate">{folder.name}</span>
      {isMoving ? <Spinner size={14} /> : <span className="text-[11px] text-text-secondary">{folder.count}</span>}
    </button>
  );
}

/**
 * A card that can be dragged onto a folder (mouse: after moving 4px; touch: after pressing and holding). Dragging
 * a checked card takes every checked card along. `isFaded`: it's being dragged, while the copy follows the pointer
 * (PresentationHome's DragOverlay).
 */
export function DraggableCard({ card, isFaded, children }: { card: PresentationCardData; isFaded: boolean; children: ReactNode }) {
  const { setNodeRef, listeners } = useDraggable({ id: card.id, data: { card } });
  // Dropped back on itself, the release would also count as a click on the card's link and open it. The click
  // comes right after the drop, so the flag is cleared just after that.
  const wasDragged = useRef(false);
  const clearSoon = () => setTimeout(() => (wasDragged.current = false));
  useDndMonitor({
    onDragStart: ({ active }) => {
      if (active.id === card.id) wasDragged.current = true;
    },
    onDragEnd: clearSoon,
    onDragCancel: clearSoon,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      onClickCapture={(e) => {
        if (!wasDragged.current) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      // The card is a link with a picture: the browser's own link dragging would get in the way of this one.
      onDragStart={(e) => e.preventDefault()}
      className={`min-w-0 select-none [-webkit-touch-callout:none] ${isFaded ? "opacity-40" : ""}`}
    >
      {children}
    </div>
  );
}

/** The copy that follows the pointer while cards are dragged: the title, or "3 presentations". */
export function DraggedCards({ cards }: { cards: PresentationCardData[] }) {
  return (
    <div className="flex max-w-60 items-center gap-2 rounded-button border border-accent bg-bg-surface px-3 py-2 text-sm font-semibold text-text-primary">
      <FolderIcon size={16} className="shrink-0 text-accent" />
      <span className="truncate">{cards.length === 1 ? cards[0].title : `${cards.length} presentations`}</span>
    </div>
  );
}

/**
 * The row between the folders and the cards: "Select multiple" on the right ("Done" while selecting), and while
 * cards are picked, "3 selected · Clear · Move to folder…" on the left.
 */
export function SelectRow({
  count,
  isSelecting,
  onStart,
  onDone,
  onClear,
  onMove,
}: {
  count: number;
  isSelecting: boolean;
  onStart: () => void;
  onDone: () => void;
  onClear: () => void;
  onMove: () => void;
}) {
  return (
    <div className="mb-3 flex min-h-9 flex-wrap items-center gap-3">
      {count > 0 && (
        <>
          <span className="text-sm font-semibold text-text-primary">{count} selected</span>
          <button type="button" onClick={onClear} className="text-sm text-text-secondary transition-colors hover:text-text-primary">
            Clear
          </button>
          <button type="button" onClick={onMove} className={buttonClass}>
            <FolderIcon size={16} />
            Move to folder…
          </button>
        </>
      )}
      <button
        type="button"
        onClick={isSelecting ? onDone : onStart}
        aria-pressed={isSelecting}
        className={`ml-auto flex items-center gap-2 rounded-dropdown px-2.5 py-1 text-[13px] font-semibold transition-colors ${
          isSelecting ? "bg-accent-soft text-accent" : "text-text-secondary hover:text-text-primary"
        }`}
      >
        <ListChecksIcon size={16} />
        {isSelecting ? "Done" : "Select multiple"}
      </button>
    </div>
  );
}

/** What a move's toast says, e.g. "Moved 3 presentations to Week 1." */
export function movedMessage(count: number, folderName: string | undefined): string {
  const what = count === 1 ? "" : ` ${count} presentations`;
  return folderName ? `Moved${what} to ${folderName}.` : `Taken${what} out of the folder.`;
}

/**
 * "← My presentations / name" over an open folder, with ⋮ Rename and Delete folder. A card dropped on
 * "← My presentations" leaves the folder (`isMovingOut` shows the Spinner meanwhile).
 */
export function FolderHeader({ folder, isMovingOut, onBack }: { folder: Folder; isMovingOut: boolean; onBack: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: folderDropId("") });
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDeleting, startDeleting] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);

  // Closes on a click outside the menu, or on Esc.
  useEffect(() => {
    if (!isMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setIsMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isMenuOpen]);

  const remove = () => {
    setIsMenuOpen(false);
    if (!confirm(`Delete the folder "${folder.name}"? Its presentations are kept: they go back to My presentations.`)) return;
    startDeleting(async () => {
      const error = await deleteFolder(folder.id);
      if (error) toast.error(error);
      else {
        toast.success("Folder deleted. Its presentations are in My presentations.");
        onBack();
      }
    });
  };

  const itemClass = "block w-full px-3 py-1.5 text-left text-sm text-text-primary transition-colors hover:bg-bg-page";

  return (
    <div className="mb-4 flex items-center gap-2">
      <button
        ref={setNodeRef}
        type="button"
        onClick={onBack}
        className={`flex items-center gap-2 rounded-dropdown border px-2 py-1 text-sm font-semibold transition-colors ${
          isOver ? "border-accent bg-accent-soft text-accent" : "border-transparent text-text-secondary hover:text-text-primary"
        }`}
      >
        {isMovingOut ? <Spinner size={16} /> : <ArrowLeftIcon size={16} />}
        My presentations
      </button>
      <span className="text-text-secondary">/</span>
      <FolderIcon size={18} className="shrink-0 text-accent" />
      <h3 className="min-w-0 truncate text-base font-extrabold text-text-primary">{folder.name}</h3>

      <div ref={menuRef} className="relative">
        {isDeleting ? (
          <span className="flex h-7 w-7 items-center justify-center">
            <Spinner size={14} />
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setIsMenuOpen((open) => !open)}
            aria-label={`Options for the folder ${folder.name}`}
            aria-expanded={isMenuOpen}
            className="flex h-7 w-7 items-center justify-center rounded-full text-text-primary transition-colors hover:bg-bg-surface"
          >
            <EllipsisVerticalIcon size={16} />
          </button>
        )}
        {isMenuOpen && (
          <div className="absolute top-8 left-0 z-20 w-40 overflow-hidden rounded-dropdown border border-border-default bg-bg-surface py-1">
            <button
              type="button"
              onClick={() => {
                setIsMenuOpen(false);
                setIsRenaming(true);
              }}
              className={itemClass}
            >
              Rename
            </button>
            <button type="button" onClick={remove} className={itemClass}>
              Delete folder
            </button>
          </div>
        )}
      </div>

      {isRenaming && (
        <FolderNameModal
          title="Rename folder"
          initialName={folder.name}
          onSave={(name) => renameFolder(folder.id, name)}
          savedMessage="Folder renamed."
          onClose={() => setIsRenaming(false)}
        />
      )}
    </div>
  );
}

/** A box to type a folder's name. `onSave` returns what went wrong, or null when it's saved (the box then closes). */
function FolderNameModal({
  title,
  initialName = "",
  onSave,
  savedMessage,
  onClose,
}: {
  title: string;
  initialName?: string;
  onSave: (name: string) => Promise<string | null>;
  savedMessage: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [isSaving, startSaving] = useTransition();

  const save = () =>
    startSaving(async () => {
      const error = await onSave(name);
      if (error) toast.error(error);
      else {
        toast.success(savedMessage);
        onClose();
      }
    });

  return (
    <Modal title={title} onClose={onClose} isBusy={isSaving}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="flex flex-col gap-3"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Week 3, or Grade 4 – Fractions"
          maxLength={FOLDER_NAME_MAX}
          autoFocus
          aria-label="Folder name"
          className={inputClass}
        />
        <button type="submit" disabled={isSaving || name.trim() === ""} className={`${buttonClass} self-end`}>
          {isSaving && <Spinner size={14} />}
          {isSaving ? "Saving…" : "Save"}
        </button>
      </form>
    </Modal>
  );
}

/**
 * "Move to folder…" (a card's ⋮ menu, or the selection bar for the checked cards): No folder, each folder, or a
 * new folder to move them into. `onMoved` runs after a move (then the box closes).
 */
export function MoveToFolderModal({
  cards,
  folders,
  onMoved,
  onClose,
}: {
  cards: PresentationCardData[];
  folders: Folder[];
  onMoved: () => void;
  onClose: () => void;
}) {
  const ids = cards.map((card) => card.id);
  const [newName, setNewName] = useState("");
  // Which choice is saving ("" = No folder, "new" = the new folder), so only that one shows the Spinner.
  const [savingId, setSavingId] = useState<string | null>(null);

  const move = async (id: string | null, save: () => Promise<string | null>, message: string) => {
    setSavingId(id ?? "");
    const error = await save();
    setSavingId(null);
    if (error) toast.error(error);
    else {
      toast.success(message);
      onMoved();
      onClose();
    }
  };
  const moveTo = (folder: Folder | null) =>
    move(folder?.id ?? null, () => moveToFolder(ids, folder?.id ?? null), movedMessage(ids.length, folder?.name));
  const moveToNew = () =>
    move(
      "new",
      async () => {
        const result = await createFolder(newName, ids);
        return "error" in result ? result.error : null;
      },
      movedMessage(ids.length, newName.trim())
    );

  const rowClass =
    "flex w-full items-center gap-2 rounded-dropdown px-3 py-2 text-left text-sm text-text-primary transition-colors hover:bg-bg-page disabled:opacity-60";
  const choices = [{ id: "", name: "No folder", folder: null }, ...folders.map((folder) => ({ id: folder.id, name: folder.name, folder }))];

  return (
    <Modal title={cards.length === 1 ? `Move “${cards[0].title}”` : `Move ${cards.length} presentations`} onClose={onClose} isBusy={savingId !== null}>
      <div className="flex flex-col gap-1">
        {choices.map(({ id, name, folder }) => {
          // Already where they all are.
          const isCurrent = cards.every((card) => (card.folderId ?? "") === id);
          return (
            <button key={id} type="button" onClick={() => moveTo(folder)} disabled={savingId !== null || isCurrent} className={rowClass}>
              <FolderIcon size={16} className={folder ? "shrink-0 text-accent" : "shrink-0 text-text-secondary"} />
              <span className="min-w-0 flex-1 truncate">{name}</span>
              {savingId === id ? <Spinner size={14} /> : isCurrent && <CheckIcon size={16} className="text-accent" />}
            </button>
          );
        })}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          moveToNew();
        }}
        className="mt-4 flex gap-2 border-t border-border-default pt-4"
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New folder name"
          maxLength={FOLDER_NAME_MAX}
          aria-label="New folder name"
          className={inputClass}
        />
        <button type="submit" disabled={savingId !== null || newName.trim() === ""} className={`${buttonClass} shrink-0`}>
          {savingId === "new" ? <Spinner size={14} /> : <FolderPlusIcon size={16} />}
          Make and move
        </button>
      </form>
    </Modal>
  );
}
